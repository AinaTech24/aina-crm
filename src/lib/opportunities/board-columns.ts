/**
 * The Opportunities board's columns — which journey stages each one holds.
 * Pure data, so the dashboard's metrics (lib/metrics/opportunities.ts) can use
 * the same grouping without importing the board's queries.
 */

export const BOARD_COLUMNS = [
  { key: "identified", label: "Need identified", stages: ["identified"] },
  { key: "discussion", label: "Discussion", stages: ["discussion"] },
  { key: "suitability", label: "Suitability", stages: ["suitability"] },
  { key: "proposal", label: "Proposal shared", stages: ["proposal"] },
  { key: "accepted", label: "Client accepted", stages: ["accepted"] },
  {
    key: "processing", label: "Processing",
    stages: ["mf_transaction", "txn_review", "rta_check", "ins_proposal_form", "ins_underwriting", "ins_issued", "gen_executed"],
  },
  // Not a journey step: an open opportunity the client asked to revisit later.
  { key: "later", label: "Later", stages: [] },
  { key: "won", label: "Won", stages: ["won"] },
  { key: "lost", label: "Lost", stages: ["lost"] },
] as const;
export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]["key"];
export const OPEN_COLUMNS = BOARD_COLUMNS.filter((c) => c.key !== "won" && c.key !== "lost");

export function columnOf(stageKey: string | null): BoardColumnKey {
  return BOARD_COLUMNS.find((c) => (c.stages as readonly string[]).includes(stageKey ?? ""))?.key ?? "identified";
}

