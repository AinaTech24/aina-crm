/**
 * A lead's open work, closed when the lead stops being a lead.
 *
 * Follow-up and call-back tasks (the lead form's first follow-up, call-outcome
 * "call later", the journey's call-back / re-engage reminders) exist to move a
 * LEAD along. Once the lead is converted, lost, deleted or handed to someone
 * else they are noise in somebody's queue — and each loop used to add another.
 *
 * `closeLeadTasks` is the one place that closes them. A task reaches a lead
 * through two links (`related_lead_id`, or `subject_type = 'lead'` +
 * `subject_id`) — both are read. Client onboarding step tasks (meta
 * `journeyStageKey`) and opportunity tasks (meta `opportunityId`) are never
 * touched: they belong to the client, not the lead.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** Task types that only make sense while someone is a lead. */
export const LEAD_FOLLOW_UP_TYPES = ["follow_up", "call", "call_back", "callback"] as const;

export interface CloseLeadTasksOptions {
  /** cancelled (default) or completed. */
  status?: "cancelled" | "completed";
  /** Written into the task's remarks, newest first. */
  reason: string;
  /** "follow_up" (default): only follow-up / call-back tasks. "all": every
   *  open task about the lead (still never journey or opportunity tasks). */
  scope?: "follow_up" | "all";
  /** Also clear the lead's next_follow_up_at (default true — converted, lost
   *  or deleted leads have nothing due; pass false on a reassignment). */
  clearFollowUpDate?: boolean;
}

export async function closeLeadTasks(
  tx: Tx,
  tenantId: string,
  leadId: string,
  opts: CloseLeadTasksOptions,
): Promise<{ closed: number; ids: string[] }> {
  const status = opts.status ?? "cancelled";
  const typeFilter =
    (opts.scope ?? "follow_up") === "follow_up"
      ? sql`AND t.type IN (${sql.join(LEAD_FOLLOW_UP_TYPES.map((x) => sql`${x}`), sql`, `)})`
      : sql``;
  const r = await tx.execute(sql`
    UPDATE tasks t
       SET status = ${status}, updated_at = now(),
           remarks = CASE WHEN t.remarks IS NULL OR t.remarks = '' THEN ${opts.reason}
                          ELSE ${opts.reason} || E'\n' || t.remarks END
     WHERE t.tenant_id = ${tenantId}::uuid
       AND t.deleted_at IS NULL
       AND t.status NOT IN ('completed', 'cancelled')
       AND (t.related_lead_id = ${leadId}::uuid OR (t.subject_type = 'lead' AND t.subject_id = ${leadId}::uuid))
       AND NOT (COALESCE(t.meta, '{}'::jsonb) ? 'journeyStageKey')
       AND NOT (COALESCE(t.meta, '{}'::jsonb) ? 'opportunityId')
       ${typeFilter}
    RETURNING t.id::text AS id
  `);
  const ids = (r.rows as Array<{ id: string }>).map((x) => x.id);
  // Nothing is due any more: the lead's own follow-up date goes too.
  if (opts.clearFollowUpDate !== false) {
    await tx.execute(sql`
      UPDATE leads SET next_follow_up_at = NULL, updated_at = now()
       WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid AND next_follow_up_at IS NOT NULL
    `);
  }
  return { closed: ids.length, ids };
}

/** Open tasks about the lead, counted the same way (both links). For the lead
 *  page's "Open tasks" tile, which also counts onboarding step tasks. */
export function leadTaskLinkSql(alias: string, leadId: string) {
  const a = sql.raw(alias);
  return sql`(${a}.related_lead_id = ${leadId}::uuid
              OR (${a}.subject_type = 'lead' AND ${a}.subject_id = ${leadId}::uuid)
              OR ${a}.meta->>'journeyLeadId' = ${leadId})`;
}

/** A conversation with a converted lead is a conversation with the client:
 *  move the client's last contact too (never backwards). */
export async function touchClientContact(tx: Tx, tenantId: string, investorId: string, at: Date): Promise<void> {
  await tx.execute(sql`
    UPDATE investors SET last_contact_at = ${at.toISOString()}::timestamptz, updated_at = now()
     WHERE id = ${investorId}::uuid AND tenant_id = ${tenantId}::uuid
       AND (last_contact_at IS NULL OR last_contact_at < ${at.toISOString()}::timestamptz)
  `);
}
