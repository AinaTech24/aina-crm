/**
 * Branch-level FY targets.
 *
 * `annual_targets` has supported `scope_type = 'branch'` since it was created,
 * but only the SIF and equity modules ever wrote to it, and both write at FIRM
 * scope for their own metric. So the branch scoreboard's target columns had
 * nothing to read and printed "Not set" on every row — not because the firm had
 * no targets, but because there was no way to enter one.
 *
 * This is the shared definition of WHICH metrics a branch can be targeted on,
 * so the settings screen, the API and the scoreboard cannot drift apart.
 *
 * The keys are chosen to match what the scoreboard already computes per branch.
 * Do not add a metric here without a matching column in `loadBranchScoreboard`,
 * or the firm will set a target nothing measures.
 */

export type BranchTargetMetric = {
  key: string;
  label: string;
  unit: "inr" | "count";
  /** What the target is compared against, in the director's words. */
  hint: string;
};

export const BRANCH_TARGET_METRICS: BranchTargetMetric[] = [
  { key: "aum", label: "AUM", unit: "inr", hint: "Closing book for the branch" },
  {
    key: "sip_book_addition",
    label: "SIP book",
    unit: "inr",
    hint: "Monthly SIP the branch carries",
  },
  {
    key: "net_business",
    label: "Net business",
    unit: "inr",
    hint: "Gross investment minus redemption",
  },
  { key: "new_clients", label: "New clients", unit: "count", hint: "Clients added in the year" },
  // Measured by the branch command centre (?scope=branch) — see BRANCH_KEY in
  // src/lib/dashboard/my/window.ts — and, for meetings and insurance, by the
  // director's branch scoreboard columns of the same name.
  { key: "net_sip", label: "Net new SIP", unit: "inr", hint: "New SIP added less SIPs stopped" },
  { key: "meetings", label: "Meetings", unit: "count", hint: "New and review meetings held" },
  { key: "insurance_business", label: "Insurance", unit: "inr", hint: "Premium booked to the branch" },
];

export const BRANCH_TARGET_KEYS = new Set(BRANCH_TARGET_METRICS.map((m) => m.key));
