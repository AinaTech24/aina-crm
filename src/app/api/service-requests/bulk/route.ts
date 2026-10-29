import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/service-requests/bulk — apply one action to many tickets.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"  value = userId (uuid) | null   → reassign
 *          = "status"  value = status enum            → set status
 *          = "close"   (no value)                     → status='closed'
 *            (resolved / closed skip a complaint with no resolution notes, and report it)
 *          = "delete"  (no value)                     → delete for good
 *            (service_request.delete; complaints are skipped and reported)
 *
 * Tenant isolation via RLS (withTenant); scoped by id only, like the
 * single-record + other bulk routes. Audited as one bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { serviceRequests } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { serviceRequestScopeSql } from "@/lib/service-requests/access";
import { deleteServiceRequests } from "@/lib/service-requests/delete";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"] as const;

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(["assign", "status", "close", "delete"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const { ids, action, value } = parsed.data;
    requireCap(session.roles, action === "delete" ? "service_request.delete" : "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const meta = clientMetaFromHeaders(req.headers);

    if (action === "delete") {
      const r = await withTenant(session.tenantId, (tx) => deleteServiceRequests(tx, session, ids, meta));
      return NextResponse.json({ ok: true, deleted: r.deleted.length, complaintsSkipped: r.complaints.length });
    }

    const now = new Date();
    const patch: Record<string, any> = { updatedAt: now };
    switch (action) {
      case "assign":
        patch.assignedToUserId = value && value.length > 0 ? value : null;
        break;
      case "status":
        if (!value || !(STATUSES as readonly string[]).includes(value)) {
          return NextResponse.json({ error: "invalid status" }, { status: 400 });
        }
        patch.status = value;
        if (value === "resolved" || value === "closed") patch.resolvedAt = now;
        break;
      case "close":
        patch.status = "closed";
        patch.resolvedAt = now;
        break;
    }

    // A complaint is resolved or closed only with resolution notes (the
    // Complaint Register's rule) — such tickets are left as they are.
    const closing = patch.status === "resolved" || patch.status === "closed";
    const needsNotes = sql`(${serviceRequests.type} = 'complaint' AND COALESCE(btrim(${serviceRequests.resolutionNotes}), '') = '')`;

    const { count, complaintsSkipped } = await withTenant(session.tenantId, async (tx) => {
      // Only tickets the caller can see — an id outside their scope is skipped.
      const scope = await serviceRequestScopeSql(tx, session, "service_requests");
      const skipped = closing
        ? await tx
            .select({ id: serviceRequests.id })
            .from(serviceRequests)
            .where(and(inArray(serviceRequests.id, ids), sql`${scope}`, needsNotes))
        : [];
      const updated = await tx
        .update(serviceRequests)
        .set(patch as any)
        .where(and(inArray(serviceRequests.id, ids), sql`${scope}`, closing ? sql`NOT ${needsNotes}` : undefined))
        .returning({ id: serviceRequests.id });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `service_request.bulk_${action}`,
        entityType: "service_request",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids, complaintsSkipped: skipped.map((r) => r.id) } as any,
        ...meta,
      });
      return { count: updated.length, complaintsSkipped: skipped.length };
    });

    return NextResponse.json({ ok: true, updated: count, complaintsSkipped });
  } catch (err: any) {
    return handleApiError(err);
  }
}
