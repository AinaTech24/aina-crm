/**
 * Smart blueprint auto-advance.
 *
 * Every action a user takes in the CRM has a logical "next stage" in the
 * lead-to-client journey. Rather than asking the user to manually click
 * "Advance" after each step, this module maps event → target stage and
 * fires the existing `transitionTo()` engine with `systemBypass: true` so
 * the user sees the lead/client progress in real-time without extra clicks.
 *
 * Wired into the *create* / *complete* / *send* endpoints across the app:
 *   - POST /api/review-meetings (lead-side)           → appointment_scheduled
 *   - PATCH /api/review-meetings/[id] status=completed → meeting_done
 *   - POST /api/proposals (new)                       → proposal_drafted
 *   - POST /api/proposals/[id]/send                   → proposal_sent
 *   - POST /api/proposal-approvals/capture            → proposal_approved
 *   - POST /api/risk-profiles (manual capture)        → risk_profiled
 *   - POST /api/share-tokens kind=risk_profile         → risk_profile_sent
 *   - POST /api/share-tokens kind=document_collection  → docs_requested
 *   - POST /api/public/docs/submit                    → docs_received
 *   - POST /api/leads/[id]/call-outcome positive       → post_meeting_qualified
 *
 * Each event ONLY advances forward, never sideways or backward — the
 * `transitionTo` engine refuses if no transition is defined from current →
 * target (unless systemBypass=true). Failures are silently swallowed so a
 * blueprint hiccup doesn't break the main flow (proposal save, meeting
 * schedule, etc.).
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
  // Legacy events from the previous 15-stage blueprint — kept for
  // back-compat but remapped to the closest new SOP stage.
  | "risk_profile.sent"
  | "risk_profile.submitted"
  | "proposal.created"
  | "proposal.sent"
  | "proposal.accepted"
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
  // ── Legacy back-compat (mapped to closest new SOP stage) ──
  "risk_profile.sent": "won_lead",
  "risk_profile.submitted": "won_lead",
  "proposal.created": "won_lead",
  "proposal.sent": "won_lead",
  "proposal.accepted": "won_lead",
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
  opts: { remarks?: string } = {}
): Promise<void> {
  const targetStage = EVENT_TO_STAGE[event];
  if (!targetStage) return;
  try {
    await transitionTo(tx, tenantId, leadId, targetStage, {
      systemBypass: true,
      remarks:
        opts.remarks ??
        `Auto-advanced by CRM after ${event.replace(/\./g, " ")} event.`,
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
