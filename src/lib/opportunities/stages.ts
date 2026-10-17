/**
 * The opportunity journey — what happens when an EXISTING client wants
 * another product. Pure data and functions: the blueprint catalog seeds from
 * here, the engine (journey.ts) walks it, and the tests read it.
 *
 *   identified → discussion → suitability → proposal → accepted
 *      ├─ mf         mf_transaction → txn_review
 *      ├─ insurance  ins_proposal_form → ins_underwriting → ins_issued
 *      └─ general    gen_executed                   (no suitability stage)
 *   → won.   "lost" is reachable from every open stage.
 *
 * Unlike the lead journey, many of these stages are usually ALREADY done for
 * a client the firm serves. The engine checks each one as the journey reaches
 * it and skips it — with a history row saying why.
 *
 * KYC, UCC and mandate are NOT steps (removed at the firm's request,
 * 2026-10-17): they belong to client onboarding. "Transaction placed" still
 * cannot be entered without them (gateFor in journey.ts).
 */

import type { SeedStage } from "@/lib/blueprints/lead_to_client";
import type { OpportunityPipeline } from "./products";

export const OPPORTUNITY_BLUEPRINT_NAME = "Existing client — new product";
export const OPPORTUNITY_MODULE = "opportunities";

export type OpportunityStageKey =
  | "identified" | "discussion" | "suitability" | "proposal" | "accepted"
  | "mf_transaction" | "txn_review"
  | "ins_proposal_form" | "ins_underwriting" | "ins_issued"
  | "gen_executed" | "won" | "lost";

export const OPPORTUNITY_STAGES: SeedStage[] = [
  { key: "identified", name: "Need identified", order: 1, ownerRole: "sales", requiredFields: [], slaDays: 2,
    allowedActions: ["log_call", "schedule_meeting"],
    description: "The client asked, or the RM spotted the need. Talk to them within two days." },
  { key: "discussion", name: "Discussion / meeting", order: 2, ownerRole: "sales", requiredFields: [], slaDays: 7,
    allowedActions: ["schedule_meeting", "capture_notes"],
    description: "Understand what the client wants and why." },
  { key: "suitability", name: "Suitability check", order: 3, ownerRole: "sales", requiredFields: [], slaDays: 5,
    allowedActions: ["send_risk_profile", "record_needs_analysis"],
    description: "MF: a current, client-confirmed risk profile. Insurance: a recorded needs analysis. Skipped when already on file." },
  { key: "proposal", name: "Proposal / quote shared", order: 4, ownerRole: "sales", requiredFields: [], slaDays: 7,
    allowedActions: ["create_proposal", "share_quote"],
    description: "A proposal or quote is with the client." },
  { key: "accepted", name: "Client accepted", order: 5, ownerRole: "sales", requiredFields: [], slaDays: 5,
    allowedActions: ["record_acceptance"],
    description: "The client said yes." },
  { key: "mf_transaction", name: "Transaction placed", order: 6, ownerRole: "back_office", requiredFields: [], slaDays: 3,
    allowedActions: ["place_order"], description: "Needs KYC verified, a UCC and, for a SIP, a mandate covering it. Done when the purchase or SIP appears on the client." },
  { key: "txn_review", name: "Approve / reject transaction", order: 7, ownerRole: "back_office", requiredFields: [], slaDays: 2,
    allowedActions: ["approve_transaction", "reject_transaction"],
    description: "Operations checks the transaction. Approved: a task is created and the client is won. Rejected: it goes back to Transaction placed with a task to fix it." },
  { key: "ins_proposal_form", name: "Proposal form submitted", order: 8, ownerRole: "sales", requiredFields: [], slaDays: 5,
    allowedActions: ["submit_proposal_form"], description: "The insurer's proposal form is filled and submitted." },
  { key: "ins_underwriting", name: "Underwriting / medicals", order: 9, ownerRole: "sales", requiredFields: [], slaDays: 15,
    allowedActions: ["track_medicals"], description: "Medicals and insurer questions." },
  { key: "ins_issued", name: "Policy issued", order: 10, ownerRole: "sales", requiredFields: [], slaDays: 3,
    allowedActions: ["record_policy"], description: "Done when the issued policy is recorded on the client." },
  { key: "gen_executed", name: "Executed", order: 11, ownerRole: "back_office", requiredFields: [], slaDays: 7,
    allowedActions: ["record_execution"], description: "The account is opened or the investment made." },
  { key: "won", name: "Won — held with us", order: 12, ownerRole: "sales", requiredFields: [], allowedActions: [],
    flavour: "terminal_success" },
  { key: "lost", name: "Lost", order: 13, ownerRole: "sales", requiredFields: [], allowedActions: [],
    flavour: "terminal_failure" },
];

/** The stages an opportunity of each pipeline walks, in order. */
export const OPPORTUNITY_PATHS: Record<OpportunityPipeline, OpportunityStageKey[]> = {
  mf: ["identified", "discussion", "suitability", "proposal", "accepted", "mf_transaction", "txn_review", "won"],
  insurance: ["identified", "discussion", "suitability", "proposal", "accepted", "ins_proposal_form", "ins_underwriting", "ins_issued", "won"],
  general: ["identified", "discussion", "proposal", "accepted", "gen_executed", "won"],
};

/** Every forward edge of every path, plus open stage → lost. */
export function opportunityTransitions(): Array<{ from: string; to: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ from: string; to: string; name: string }> = [];
  const name = (k: string) => OPPORTUNITY_STAGES.find((s) => s.key === k)?.name ?? k;
  for (const path of Object.values(OPPORTUNITY_PATHS)) {
    for (let i = 0; i < path.length - 1; i++) {
      const key = `${path[i]}>${path[i + 1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: path[i], to: path[i + 1], name: name(path[i + 1]) });
    }
  }
  // A rejected transaction goes back to be placed again.
  out.push({ from: "txn_review", to: "mf_transaction", name: "Transaction rejected — place again" });
  for (const s of OPPORTUNITY_STAGES) {
    if (s.key === "won" || s.key === "lost") continue;
    out.push({ from: s.key, to: "lost", name: "Lost" });
  }
  return out;
}

export function nextStage(pipeline: OpportunityPipeline, current: string): OpportunityStageKey | null {
  const path = OPPORTUNITY_PATHS[pipeline];
  const i = path.indexOf(current as OpportunityStageKey);
  if (i < 0 || i >= path.length - 1) return null;
  return path[i + 1];
}

export function stageName(key: string): string {
  return OPPORTUNITY_STAGES.find((s) => s.key === key)?.name ?? key;
}

/** The step right after "Client accepted" — entering it needs the client's approval of the proposal. */
export const AFTER_ACCEPTED: ReadonlySet<string> = new Set(["mf_transaction", "ins_proposal_form", "gen_executed"]);

export const isClosedStage = (key: string) => key === "won" || key === "lost";
