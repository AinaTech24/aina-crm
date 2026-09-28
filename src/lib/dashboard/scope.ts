/**
 * Which BOOK the dashboard is showing — server-safe, no "use client".
 *
 * The same person can want two different dashboards. A director who also
 * carries clients opens the firm cockpit to ask "how is the business doing",
 * and a personal cockpit to ask "what should I do today". Those are different
 * questions with different denominators, and folding them into one screen makes
 * both worse: firm-wide overdue tasks drown the four that are actually yours.
 *
 * So: one route, two scopes. `?scope=mine` narrows every figure to the signed-in
 * user's own book; the default stays firm-wide. A URL param rather than a
 * setting, for the same reasons `?tab=` is one — the SERVER decides which
 * queries to run, the choice survives a refresh, and it can be linked to.
 *
 * Lives in lib rather than in the switcher component because the page is a
 * server component and calls the parser. `tabs.ts` exists for the same reason;
 * see the note there about what `tsc` cannot catch.
 */

export type DashboardScope = "firm" | "branch" | "mine";

/**
 * Parse `?scope=`, defaulting to the firm-wide view. Parsing is not
 * permission: the page decides which scopes the viewer may actually open (a
 * branch head without cross-branch access never gets "firm"), see
 * src/app/dashboard/page.tsx.
 */
export function parseDashboardScope(raw: unknown): DashboardScope {
  return raw === "mine" ? "mine" : raw === "branch" ? "branch" : "firm";
}

/** Params that only mean something on the branch command centre. */
export const BRANCH_ONLY_PARAMS = ["tgt", "rmsort", "flow", "hv", "review"] as const;

/**
 * Params only the RM desk ("My portfolio") reads: the action day, the
 * end-of-day view and the client filters. The firm and branch views would
 * ignore them, so they are dropped on the way out rather than left in the URL
 * to reappear, unexplained, on the next visit to My portfolio.
 */
export const MINE_ONLY_PARAMS = ["day", "eod", "cat", "ctype", "cnew", "cstatus", "city", "src", "fam"] as const;
