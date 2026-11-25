/**
 * Deleting an opportunity (2026-11-25) — the same two ways Business Entries has: one from its own
 * page (DELETE /api/opportunities/[id]) and many from the list (POST /api/opportunities/bulk).
 *
 * The row goes for good; what it leaves behind is tidied rather than orphaned:
 *   - its open tasks (follow-ups, the "later" reminder, the RTA check) are cancelled;
 *   - the money it waited for (expected inflow) is cancelled with its reminder task;
 *   - a proposal made for it stays, no longer pointing at it;
 *   - its journey (blueprint instance + stage history) is removed.
 * The Cross-sell flag is NOT touched (that is the client's own record, editable on the card), and
 * what was removed stays in the audit trail.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { canWorkOpportunities, loadViewableOpportunity } from "@/lib/opportunities/access";

export type DeleteResult = { deleted: Array<{ id: string; product: string; status: string; investorId: string }>; skipped: number };

/** Firm-wide viewers (and owners) may delete any they can see; everyone else only what they own or opened. */
function mayDelete(session: SessionUser, opp: { ownerId: string | null; createdBy: string | null }): boolean {
  if (!canWorkOpportunities(session)) return false;
  if (can(session.roles, "investor.view.all", session.permissions) || session.roles.includes("owner")) return true;
  return opp.ownerId === session.userId || opp.createdBy === session.userId;
}

export async function deleteOpportunities(
  tx: Tx,
  session: SessionUser,
  ids: string[],
  meta: Record<string, unknown> = {},
): Promise<DeleteResult> {
  const deleted: DeleteResult["deleted"] = [];
  let skipped = 0;
  for (const id of [...new Set(ids)]) {
    let opp;
    try {
      opp = await loadViewableOpportunity(tx, session, id);
    } catch {
      skipped++; // not found, or a client outside the viewer's book
      continue;
    }
    if (!mayDelete(session, opp)) { skipped++; continue; }
    const tenant = session.tenantId;

    // Tasks it put on people's lists end here (every open one, the RTA check included).
    await tx.execute(sql`
      UPDATE tasks SET status = 'cancelled', updated_at = now()
       WHERE tenant_id = ${tenant}::uuid AND meta ->> 'opportunityId' = ${id}
         AND status IN ('open', 'in_progress', 'blocked')
    `);
    // The money it waited for, and that inflow's own reminder.
    if (opp.expectedInflowId) {
      await tx.execute(sql`
        UPDATE tasks SET status = 'cancelled', updated_at = now()
         WHERE tenant_id = ${tenant}::uuid AND status IN ('open', 'in_progress', 'blocked')
           AND id = (SELECT reminder_task_id FROM expected_inflows WHERE id = ${opp.expectedInflowId}::uuid AND tenant_id = ${tenant}::uuid)
      `);
      await tx.execute(sql`
        UPDATE expected_inflows SET status = 'cancelled', updated_at = now()
         WHERE id = ${opp.expectedInflowId}::uuid AND tenant_id = ${tenant}::uuid AND status IN ('expected', 'confirmed')
      `);
    }
    // A proposal made for it stays; it just no longer points at a record that is gone.
    await tx.execute(sql`UPDATE proposals SET opportunity_id = NULL WHERE opportunity_id = ${id}::uuid AND tenant_id = ${tenant}::uuid`);
    // Its journey (stage history goes with the instance).
    await tx.execute(sql`
      DELETE FROM blueprint_instances
       WHERE tenant_id = ${tenant}::uuid AND subject_type = 'opportunity' AND subject_id = ${id}::uuid
    `);
    await tx.execute(sql`DELETE FROM client_opportunities WHERE id = ${id}::uuid AND tenant_id = ${tenant}::uuid`);

    await recordAudit(tx, {
      tenantId: tenant,
      actorUserId: session.userId,
      action: "opportunity.delete",
      entityType: "opportunity",
      entityId: id,
      before: { investorId: opp.investorId, product: opp.product, pipeline: opp.pipeline, status: opp.status, expectedValue: opp.expectedValue, ownerId: opp.ownerId } as never,
      ...meta,
    } as never);
    deleted.push({ id, product: opp.product, status: opp.status, investorId: opp.investorId });
  }
  return { deleted, skipped };
}
