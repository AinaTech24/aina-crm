/**
 * Who may open a saved (custom) report — the same rule as the Custom Reports
 * list: its creator, anyone when it is shared with the team or the firm, and
 * the owner. A private report is no longer readable, runnable or exportable
 * by id by someone it was never shown to.
 */

import type { SessionUser } from "@/lib/auth/session";

export function canSeeSavedReport(
  session: Pick<SessionUser, "userId" | "roles">,
  row: { createdById: string | null; sharedScope: string | null },
): boolean {
  if (!row.createdById || row.createdById === session.userId) return true;
  if (row.sharedScope === "tenant" || row.sharedScope === "team") return true;
  return session.roles.includes("owner");
}
