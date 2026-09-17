/**
 * Dashboard tab identity — kept in a SERVER-SAFE module on purpose.
 *
 * This lived in DashboardTabs.tsx, which carries "use client". The dashboard
 * page is a server component and calls the parser to decide which sections to
 * render, and Next refuses that across the boundary: "Attempted to call
 * parseDashboardTab() from the server but parseDashboardTab is on the client."
 * `tsc` cannot see that rule — only running the page does.
 */

export type DashboardTab = "overview" | "insights" | "tracker";

/** Parse `?tab=`, defaulting to Overview for anything unrecognised. */
export function parseDashboardTab(raw: unknown): DashboardTab {
  return raw === "insights" || raw === "tracker" ? raw : "overview";
}
