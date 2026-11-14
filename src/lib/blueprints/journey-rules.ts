/**
 * Direction rules for the Lead → Client journey (pure, tested).
 *
 * The journey is a graph, not a line: the call-back loops sit "before" Call
 * Done although their stored order is after it; KYC Registered / Pending /
 * Modify / Physical / Online all lead INTO KYC Validated; Mandate Rejected and
 * Transaction Failed are retries of the step before them; the physical route
 * runs beside the exchange one; insurance onboarding beside MF. Comparing the
 * stored `stage_order` (what auto-advance used to do) gets every one of those
 * wrong, so progress is ranked here, by key.
 *
 * Two rules every AUTOMATIC move obeys (the firm's rule; audit L1):
 *   1. Forward only — a move never takes the journey back to an earlier step.
 *      Moving between the members of one loop (call back ↔ not connected,
 *      order placed ↔ failed …) is sideways, and allowed.
 *   2. A client stays a client — once the journey is in the client phase (or
 *      the lead was converted) nothing automatic puts it back in a lead stage,
 *      Lost included. Nor does an automatic move change the onboarding branch
 *      (MF ↔ insurance) or route (exchange ↔ physical).
 */

import {
  LEAD_PHASE_LAST_ORDER,
  LEAD_TO_CLIENT_STAGES,
  onboardingBranchOf,
  routeOfStage,
} from "./lead_to_client";

const CODE_ORDER = new Map(LEAD_TO_CLIENT_STAGES.map((s) => [s.key, s.order] as const));

/** Progress rank where the stored order misleads. Equal ranks = one loop. */
const RANK_OVERRIDE: Record<string, number> = {
  // Lead phase: the three "not yet reached" loops come before Call Done.
  call_back_later: 1.5,
  call_not_connected: 1.5,
  contact_in_future: 1.5,
  meeting_pending: 6, // = meeting_scheduled
  // KYC: every branch leads into KYC Validated (15).
  kyc_registered: 14.5,
  kyc_pending: 14.5,
  modify_kyc: 14.5,
  physical_kyc: 14.5,
  online_kyc: 14.5,
  // Retries sit level with the step they retry.
  mandate_reject: 23, // = mandate_create
  transaction_failed: 26, // = make_transaction
  // The physical route runs level with the exchange route.
  rta_forms_ready: 21,
  rta_client_signed: 22,
  rta_submitted: 26,
  rta_rejected: 26,
  rta_processed: 27,
  // Insurance onboarding runs level with MF onboarding; issued = Active Client.
  insurance_needs_analysis: 12,
  insurance_quote: 13,
  insurance_proposal: 14,
  insurance_underwriting: 15,
  insurance_policy_issued: 36,
  insurance_lost: 36,
};

/** A stage's progress rank. Unknown (designer-made) stages fall back to their
 *  stored order. */
export function journeyRank(stageKey: string, storedOrder?: number | null): number {
  return RANK_OVERRIDE[stageKey] ?? CODE_ORDER.get(stageKey) ?? storedOrder ?? 0;
}

/** Client onboarding (after the lead phase)? Decided by the SOP in code. */
export function isClientPhaseStage(stageKey: string, storedOrder?: number | null): boolean {
  const order = CODE_ORDER.get(stageKey) ?? storedOrder ?? 0;
  return order > LEAD_PHASE_LAST_ORDER;
}

export const LOST_STAGE = "not_qualified";
export const WON_STAGE = "won_lead";

export interface MoveContext {
  /** The lead became a client (or the journey's subject is a client). */
  converted: boolean;
  currentOrder?: number | null;
  targetOrder?: number | null;
}

/**
 * May an AUTOMATIC source move the journey from `current` to `target`?
 * Returns null when it may, else a short reason (for logs / tests).
 */
export function automaticMoveBlock(current: string, target: string, ctx: MoveContext): string | null {
  if (current === target) return "already there";
  const curClient = isClientPhaseStage(current, ctx.currentOrder);
  const tgtClient = isClientPhaseStage(target, ctx.targetOrder);

  // A client never goes back into the lead phase — Lost included.
  if (!tgtClient && (curClient || ctx.converted)) return "client stays in the client phase";

  // Entering the client phase automatically needs a converted lead, or a lead
  // already Won. (A shared document link does not make a prospect a client.)
  if (tgtClient && !curClient && !ctx.converted && current !== WON_STAGE) return "not won or converted yet";

  // Lost: closing is allowed from any open lead stage; a lost lead coming back
  // (a call, a meeting, an accepted proposal) may reopen.
  if (target === LOST_STAGE) return null;
  if (current === LOST_STAGE) return null;

  // Never across onboarding branches or routes.
  const bc = onboardingBranchOf(current);
  const bt = onboardingBranchOf(target);
  if (bc && bt && bc !== bt) return "different onboarding branch";
  const rc = routeOfStage(current);
  const rt = routeOfStage(target);
  if (rc && rt && rc !== rt) return "different onboarding route";

  // Insurance "Not Proceeded" closes an open insurance journey; reopening
  // from it goes back to the start of that branch.
  if (current === "insurance_lost") return target === "insurance_needs_analysis" ? null : "insurance journey closed";

  const rCur = journeyRank(current, ctx.currentOrder);
  const rTgt = journeyRank(target, ctx.targetOrder);
  if (rTgt > rCur) return null;
  if (rTgt === rCur) return null; // sideways inside one loop
  return "would move the journey backwards";
}

/** Lead-phase stages a lead may be closed as Lost from (every open one). */
export function canCloseAsLost(current: string, converted: boolean): boolean {
  if (converted) return false;
  if (current === LOST_STAGE) return false;
  return !isClientPhaseStage(current);
}
