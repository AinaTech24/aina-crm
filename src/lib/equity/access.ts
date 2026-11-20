/**
 * Who may use the Equity desk's daily brokerage (2026-11-20): a firm with the
 * "zohoImport" flag (We Care — the desk replaces its Zoho "Equity" module), and
 * inside it whoever may read the business MIS, as for the Equity Team board.
 */

import { can } from "@/lib/auth/rbac";
import { zohoImportEnabled } from "@/lib/imports/zoho/access";

type SessionLike = { tenantId: string; roles: string[]; permissions?: any };

export function mayUseEquityDesk(session: SessionLike): boolean {
  return can(session.roles, "reports.business", session.permissions) || can(session.roles, "reports.manage", session.permissions);
}

export async function equityDeskEnabled(session: SessionLike): Promise<boolean> {
  return zohoImportEnabled(session.tenantId, session.roles);
}

/** Throws 404 when the firm does not have the desk, 403 when the person may not use it. */
export async function assertEquityDesk(session: SessionLike): Promise<void> {
  if (!(await equityDeskEnabled(session))) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!mayUseEquityDesk(session)) throw Object.assign(new Error("You need access to business reports to use the Equity desk."), { status: 403 });
}
