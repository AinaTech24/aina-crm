import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/service-requests/bulk — apply one action to many tickets.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"  value = userId (uuid) | null   → reassign
 *          = "status"  value = status enum            → set status
 *          = "close"   (no value)                     → status='closed'
 *            (resolved / closed skip a complaint with no resolution notes, and report it;
 *             escalated stamps escalated_at and tells the same people the ticket page does)
 *          = "delete"  (no value)                     → delete for good
 *            (service_request.delete; complaints are skipped and reported)
 *
 * Tenant isolation via RLS (withTenant); scoped by id only, like the
 * single-record + other bulk routes. Audited as one bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { serviceRequests } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { serviceRequestScopeSql } from "@/lib/service-requests/access";
import { deleteServiceRequests } from "@/lib/service-requests/delete";
import { announceServiceRequestEscalation } from "@/lib/service-requests/escalate";

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
      // Tickets escalated for the first time — stamped and announced once, as
      // when "Escalated" is chosen on the ticket itself.
      const escalating = patch.status === "escalated"
        ? await tx
            .select({
              id: serviceRequests.id, ticketNo: serviceRequests.ticketNo, type: serviceRequests.type,
              assignedToUserId: serviceRequests.assignedToUserId, investorId: serviceRequests.investorId,
              timeline: serviceRequests.timeline,
            })
            .from(serviceRequests)
            .where(and(inArray(serviceRequests.id, ids), sql`${scope}`, sql`${serviceRequests.escalatedAt} IS NULL`))
        : [];
      const updated = await tx
        .update(serviceRequests)
        .set(patch as any)
        .where(and(inArray(serviceRequests.id, ids), sql`${scope}`, closing ? sql`NOT ${needsNotes}` : undefined))
        .returning({ id: serviceRequests.id });
      for (const sr of escalating) {
        const timeline = [...(sr.timeline ?? []), { at: now.toISOString(), by: session.userId, event: "escalated", note: "Escalated by hand" }];
        await tx
          .update(serviceRequests)
          .set({ escalatedAt: now, timeline })
          .where(and(eq(serviceRequests.id, sr.id), eq(serviceRequests.tenantId, session.tenantId)));
        await announceServiceRequestEscalation(tx, {
          tenantId: session.tenantId,
          sr: { id: sr.id, ticketNo: sr.ticketNo, type: sr.type, assignedToUserId: sr.assignedToUserId, investorId: sr.investorId },
          why: "escalated by hand",
          eventMeta: { userId: session.userId, source: "manual", bulk: true },
        });
      }
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
