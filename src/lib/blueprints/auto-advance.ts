/**
 * Smart blueprint auto-advance.
 *
 * Every action a user takes in the CRM has a logical "next stage" in the
 * lead-to-client journey. Rather than asking the user to manually click
 * "Advance" after each step, this module maps event → target stage and
 * fires the existing `transitionTo()` engine with `systemBypass: true` so
 * the user sees the lead/client progress in real-time without extra clicks.
 *
 * Wired into the *create* / *complete* / *send* endpoints across the app
 * (target stages are the 30-stage SOP keys in lead_to_client.ts):
 *   - POST /api/review-meetings (lead-side)            → meeting_scheduled
 *   - PATCH /api/review-meetings/[id] status=completed → meeting_done
 *   - POST /api/leads/[id]/call-outcome                → call_done
 *   - POST /api/leads/[id]/convert                     → request_documents (client phase)
 *   - POST /api/public/docs/submit                     → documents_received
 *   - POST /api/investors/[id]/kyc/verify (verified)   → kyc_validated
 *   - POST /api/proposals/[id]/send                    → proposal_sent
 *   - POST /api/public/proposals/accept                → won_lead
 *
 * Direction: `autoAdvance` always calls `transitionTo` with systemBypass, and
 * systemBypass permits ANY jump — including backwards. Most events are
 * naturally forward, and some legitimately loop (a follow-up meeting after a
 * proposal takes a lead from Proposal Sent back through Meeting Done). Proposal
 * events are different: they fire on leads at every point in the journey,
 * including clients already mid-onboarding, so they pass `forwardOnly` and
 * never pull a journey back. Failures are silently swallowed so a blueprint
 * hiccup doesn't break the main flow (proposal save, meeting schedule, etc.).
 */

import { sql } from "drizzle-orm";
import { transitionTo } from "@/lib/blueprints/engine";
import type { Tx } from "@/db/client";

export type BlueprintEvent =
  | "call.logged"
  | "call.completed"
  | "meeting.scheduled.lead"
  | "meeting.scheduled.client"
  | "meeting.completed"
  | "lead.won"
  | "lead.not_qualified"
  | "client.converted"
  | "docs.requested"
  | "docs.received"
  | "kyc.validated"
  | "ucc.activated"
  | "mandate.activated"
  | "mandate.rejected"
  | "transaction.successful"
  | "transaction.failed"
  | "proposal.created"
  | "proposal.sent"
  | "proposal.accepted"
  // Legacy events from the previous 15-stage blueprint — kept for
  // back-compat but remapped to the closest new SOP stage.
  | "risk_profile.sent"
  | "risk_profile.submitted"
  | "call.completed.positive";

/** Mapping table — event → target stage key (new 30-stage SOP). */
const EVENT_TO_STAGE: Record<BlueprintEvent, string | null> = {
  // ── Lead phase ──
  "call.logged": "call_done",                  // a call activity was logged
  "call.completed": "call_done",
  "meeting.scheduled.lead": "meeting_scheduled",
  "meeting.scheduled.client": null,
  "meeting.completed": "meeting_done",
  "lead.won": "won_lead",
  "lead.not_qualified": "not_qualified",
  // ── Boundary ──
  "client.converted": "request_documents",
  // ── Client phase ──
  "docs.requested": "documents_pending",
  "docs.received": "documents_received",
  "kyc.validated": "kyc_validated",
  "ucc.activated": "ucc_activated",
  "mandate.activated": "mandate_activated",
  "mandate.rejected": "mandate_reject",
  "transaction.successful": "transaction_successful",
  "transaction.failed": "transaction_failed",
  // ── Proposals ──
  // These all used to map to won_lead, so a lead was "won" the moment an RM
  // opened a blank draft — before the client had seen anything — and every
  // conversion rate counted drafts as wins. The Proposal Sent stage (migration
  // 0222) was never entered. A draft now moves nothing; sending reaches
  // Proposal Sent; only the CLIENT'S acceptance makes the lead Won.
  "proposal.created": null,
  "proposal.sent": "proposal_sent",
  "proposal.accepted": "won_lead",
  // ── Legacy back-compat (mapped to closest new SOP stage) ──
  "risk_profile.sent": "won_lead",
  "risk_profile.submitted": "won_lead",
  "call.completed.positive": "call_done",
};

/**
 * Best-effort blueprint advance for a lead. Never throws — if the transition
 * isn't defined or the lead has no blueprint, returns silently.
 *
 * Use the `remarks` field to leave a breadcrumb in `lead_stage_history`
 * (e.g. "Auto: meeting scheduled via Meetings module").
 */
export async function autoAdvance(
  tx: Tx,
  tenantId: string,
  leadId: string,
  event: BlueprintEvent,
  opts: {
    remarks?: string;
    /** Skip the move when the journey is already at or past the target.
     *  See the header: required for events that fire on clients already
     *  further along, or a fresh proposal drags an onboarding client back. */
    forwardOnly?: boolean;
  } = {}
): Promise<void> {
  const targetStage = EVENT_TO_STAGE[event];
  if (!targetStage) return;
  try {
    if (opts.forwardOnly && !(await isAheadOf(tx, leadId, targetStage))) return;
    // Run inside a SAVEPOINT (Drizzle nested transaction) so a DB-level error
    // — deadlock, constraint, statement timeout — rolls back ONLY the blueprint
    // advance, not the parent transaction. Without this, a thrown SQL error
    // here aborts the whole Postgres tx; the catch below would swallow the JS
    // error but the parent's COMMIT would then fail and roll back EVERYTHING
    // (e.g. the entire lead → client conversion). The savepoint keeps the
    // "additive, never fails the parent" promise true even for DB errors.
    await tx.transaction(async (sp) => {
      await transitionTo(sp as unknown as Tx, tenantId, leadId, targetStage, {
        systemBypass: true,
        remarks:
          opts.remarks ??
          `Auto-advanced by CRM after ${event.replace(/\./g, " ")} event.`,
      });
    });
  } catch (err) {
    // Blueprint advance is *additive* — never fail the parent transaction
    // because the smart progression couldn't compute a path. The audit log
    // and the main side-effect (meeting created, proposal saved, etc.) are
    // far more important.
    console.warn(
      `[autoAdvance] failed to advance lead ${leadId} on ${event}:`,
      (err as Error)?.message
    );
  }
}

/**
 * True when moving to `targetStage` is forward progress for this lead's
 * journey — or when there is no journey yet (the transition creates one).
 *
 * Compares the blueprint's own stage ORDER (per firm, so a firm that reordered
 * its stages in the designer is respected). A lead sitting in a dead end — the
 * terminal-failure stage, i.e. Lost — counts as "before" everything: a lost
 * lead who comes back and accepts a proposal should become Won.
 */
async function isAheadOf(tx: Tx, leadId: string, targetStage: string): Promise<boolean> {
  const r = await tx.execute(sql`
    SELECT cur.stage_order AS cur_order, tgt.stage_order AS tgt_order, i.current_stage_key AS cur_key
      FROM lead_blueprint_instances i
      JOIN blueprint_stages cur ON cur.blueprint_id = i.blueprint_id AND cur.stage_key = i.current_stage_key
      JOIN blueprint_stages tgt ON tgt.blueprint_id = i.blueprint_id AND tgt.stage_key = ${targetStage}
     WHERE i.lead_id = ${leadId}::uuid
     LIMIT 1
  `);
  const row = r.rows[0] as { cur_order: number; tgt_order: number; cur_key: string } | undefined;
  if (!row) return true;
  if (row.cur_key === "not_qualified") return true;
  return Number(row.tgt_order) > Number(row.cur_order);
}

/**
 * Resolve a lead's blueprint context starting from either a leadId or an
 * investorId (= the converted lead). Used by APIs that act on the
 * investor side (post-conversion meetings, fresh proposals against a
 * converted client) but want to keep advancing the same blueprint
 * instance.
 *
 * Returns the leadId of the source lead, or null if the investor wasn't
 * born from a converted lead.
 */
export async function resolveLeadIdForInvestor(
  tx: Tx,
  investorId: string
): Promise<string | null> {
  const r = await tx.execute(sql`
    SELECT id FROM leads WHERE converted_investor_id = ${investorId}::uuid LIMIT 1
  `);
  return ((r.rows[0] as any)?.id as string | undefined) ?? null;
}
