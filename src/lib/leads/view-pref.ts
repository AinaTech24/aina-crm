/**
 * The Leads page's remembered view (kanban / list). A cookie rather than
 * localStorage so the server can read it and render the right view on the
 * first paint. Plain module: both the page (server) and LeadsViewPersist
 * (client) import it — a constant exported from a "use client" file would
 * reach the server as a reference, not a string.
 */
export const LEADS_VIEW_COOKIE = "leads_view";

export type LeadsView = "kanban" | "table";

export function parseLeadsView(v: string | null | undefined): LeadsView | null {
  return v === "table" || v === "kanban" ? v : null;
}

/** With no explicit or saved choice: a list once the board would be crowded. */
export const LEADS_LIST_THRESHOLD = 30;
