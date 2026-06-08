import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/bulk — apply one action to many leads at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"     value = ownerId (uuid) | null   → reassign RM
 *          = "follow_up"  value = ISO date string         → set next follow-up
 *          = "stage"      value = stage key               → move stage (override)
 *          = "lost"       value = lost reason (optional)  → mark not_qualified
 *
 * Tenant-scoped via withTenant + RLS; only leads in the caller's tenant are
 * touched. Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { leads } from "@/db/schema";
import { scoreFields } from "@/lib/leads/score";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["assign", "follow_up", "stage", "lost"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Bulk acts on arbitrary lead ids (no per-row ownership re-check), so it's a
    // manager-level capability — RMs do single-lead edits via their own routes.
    requireCap(session.roles, "lead.edit.all", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const patch: Record<string, any> = { updatedAt: new Date() };
    switch (action) {
      case "assign":
        patch.ownerId = value && value.length > 0 ? value : null;
        break;
      case "follow_up":
        if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
        patch.nextFollowUpAt = new Date(value);
        break;
      case "stage":
        if (!value) return NextResponse.json({ error: "value (stage) required" }, { status: 400 });
        patch.stage = value;
        patch.stageChangedAt = new Date();
        break;
      case "lost":
        patch.stage = "not_qualified";
        patch.lostAt = new Date();
        patch.lostReason = value || "Bulk-marked not qualified";
        break;
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      // Tenant isolation is enforced by RLS (withTenant sets app.tenant_id);
      // matching the single-lead route convention — scope by id only, never
      // add a redundant tenant_id predicate. RLS guarantees only the caller's
      // tenant's leads are visible/updatable.
      const updated = await tx
        .update(leads)
        .set(patch as any)
        .where(inArray(leads.id, ids))
        .returning({ id: leads.id });

      // Re-score affected leads when the action changed a scoring input (stage,
      // follow-up momentum, or marking lost). Owner reassignment doesn't move
      // the score, so we skip the recompute there.
      if (action === "stage" || action === "lost" || action === "follow_up") {
        const touchedIds = updated.map((u) => u.id);
        if (touchedIds.length) {
          const rows = await tx.select().from(leads).where(inArray(leads.id, touchedIds));
          for (const l of rows) {
            const sf = scoreFields({
              source: l.source,
              stage: l.stage,
              intendedAmount: l.intendedAmount,
              lastContactAt: l.lastContactAt,
              nextFollowUpAt: l.nextFollowUpAt,
              stageChangedAt: l.stageChangedAt,
              email: l.email,
              phone: l.phone,
              pan: l.pan,
              interestProducts: l.interestProducts,
            });
            await tx.update(leads).set(sf as any).where(eq(leads.id, l.id));
          }
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `lead.bulk_${action}`,
        entityType: "lead",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({ ok: true, updated: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
