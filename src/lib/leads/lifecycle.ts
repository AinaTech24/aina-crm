/**
 * Deleting and restoring a lead — one implementation for the single DELETE,
 * the bulk action and the Restore button (audit L4, L14, L20).
 *
 * Leads have no deleted_at: a deleted lead is `lost_reason = '__deleted__'`
 * (lib/metrics leadWhere hides it everywhere). Deleting:
 *   - ends its journey (no SLA alerts, no automatic moves) WITHOUT moving the
 *     journey's step, so a restore knows where it was;
 *   - cancels its follow-up / call-back tasks and its onboarding step tasks;
 *   - is refused for a lead that is already a client (the person is the
 *     client's now — their record is where they are removed).
 * Restoring puts the lead back on the board at the step it was on, with its
 * journey running again. Both are audited and emit their events.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { eventsOutbox } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { cancelJourneyTasks } from "@/lib/blueprints/journey-task";
import { startJourneyAt } from "@/lib/blueprints/journey-access";
import { LEAD_PHASE_STAGES } from "./normalize";
import { closeLeadTasks } from "./open-tasks";

export const DELETED_MARKER = "__deleted__";

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const refuse = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Delete (soft) one lead the caller has already been allowed to edit. */
export async function softDeleteLead(
  tx: Tx,
  p: { tenantId: string; actorUserId: string; lead: { id: string; name: string; stage: string | null; convertedInvestorId: string | null; lostReason?: string | null }; source?: string },
  meta: Meta = {},
): Promise<void> {
  const { tenantId, lead } = p;
  if (lead.convertedInvestorId) throw refuse(409, "This lead is a client now — open the client record instead of deleting the lead.");
  if (lead.lostReason === DELETED_MARKER) return;
  await tx.execute(sql`
    UPDATE leads SET stage = 'not_qualified', stage_changed_at = now(), lost_reason = ${DELETED_MARKER},
                     lost_at = now(), next_follow_up_at = NULL, updated_at = now()
     WHERE id = ${lead.id}::uuid AND tenant_id = ${tenantId}::uuid
  `);
  // The journey ends with the lead. Its step is kept (restore reads it).
  await tx.execute(sql`
    UPDATE lead_blueprint_instances SET status = 'lost', is_delayed = false, delayed_since = NULL, updated_at = now()
     WHERE lead_id = ${lead.id}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'in_progress'
  `);
  await cancelJourneyTasks(tx, { tenantId, leadId: lead.id, reason: "Lead deleted — onboarding step no longer needed." });
  await closeLeadTasks(tx, tenantId, lead.id, { reason: "Lead deleted.", scope: "all" });
  await tx.insert(eventsOutbox).values({
    tenantId,
    kind: "lead.deleted",
    entityType: "lead",
    entityId: lead.id,
    meta: { userId: p.actorUserId, source: p.source ?? "single" } as any,
  } as any);
  await recordAudit(tx, {
    tenantId,
    actorUserId: p.actorUserId,
    action: "lead.delete",
    entityType: "lead",
    entityId: lead.id,
    before: { name: lead.name, stage: lead.stage } as any,
    ...meta,
  });
}

/** Bring a deleted lead back to the step it was on. Returns the stage. */
export async function restoreLead(
  tx: Tx,
  p: { tenantId: string; actorUserId: string; leadId: string },
  meta: Meta = {},
): Promise<string> {
  const { tenantId, leadId } = p;
  const row = (await tx.execute(sql`
    SELECT l.name, l.lost_reason, i.current_stage_key
      FROM leads l LEFT JOIN lead_blueprint_instances i ON i.lead_id = l.id AND i.tenant_id = l.tenant_id
     WHERE l.id = ${leadId}::uuid AND l.tenant_id = ${tenantId}::uuid LIMIT 1
  `)).rows[0] as { name: string; lost_reason: string | null; current_stage_key: string | null } | undefined;
  if (!row) throw refuse(404, "lead not found");
  if (row.lost_reason !== DELETED_MARKER) throw refuse(409, "This lead is not deleted.");

  const phase = LEAD_PHASE_STAGES as readonly string[];
  let stage: string;
  await tx.execute(sql`
    UPDATE leads SET lost_reason = NULL, lost_at = NULL, updated_at = now()
     WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
  `);
  if (row.current_stage_key && phase.includes(row.current_stage_key)) {
    // The journey kept its step: run it again from there.
    stage = row.current_stage_key;
    await tx.execute(sql`
      UPDATE lead_blueprint_instances
         SET status = ${stage === "not_qualified" ? "lost" : "in_progress"}, stage_entered_at = now(), updated_at = now()
       WHERE lead_id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
    `);
    await tx.execute(sql`
      UPDATE leads SET stage = ${stage}, stage_changed_at = now() WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
    `);
  } else {
    // No journey yet: the stage it had when it was deleted (the audit trail),
    // else New.
    const prev = (await tx.execute(sql`
      SELECT before->>'stage' AS stage FROM audit_log
       WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'lead' AND entity_id = ${leadId}::uuid AND action = 'lead.delete'
       ORDER BY at DESC LIMIT 1
    `)).rows[0] as { stage?: string | null } | undefined;
    stage = prev?.stage && phase.includes(prev.stage) && prev.stage !== "not_qualified" ? prev.stage : "new";
    await tx.execute(sql`
      UPDATE leads SET stage = 'new', stage_changed_at = now() WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
    `);
    await startJourneyAt(tx, tenantId, leadId, stage, p.actorUserId);
  }
  await tx.insert(eventsOutbox).values({
    tenantId,
    kind: "lead.restored",
    entityType: "lead",
    entityId: leadId,
    meta: { userId: p.actorUserId } as any,
  } as any);
  await recordAudit(tx, {
    tenantId,
    actorUserId: p.actorUserId,
    action: "lead.restore",
    entityType: "lead",
    entityId: leadId,
    after: { name: row.name, stage } as any,
    ...meta,
  });
  return stage;
}
