/**
 * Who may use the Visitor Register (2026-11-26, Akshar Invest).
 *
 * The firm: only one whose `visitorRegister` flag is on (Aina Admin → the firm →
 * Access → feature flags). Off, the menu item is not drawn and every page and
 * API answers "not found".
 *
 * The person: everyone on that firm's team may read the register; recording,
 * editing and deleting visits needs a task-edit permission, which every working
 * role holds and the read-only Viewer does not. The register has no permission
 * or sidebar grant of its own on purpose: a saved list grants only what it
 * names, so a new one would be missing from every customised user — and would
 * show up in other firms' access editors.
 */

import { loadTenantLicense } from "@/lib/auth/license";
import { can, type Capability } from "@/lib/auth/rbac";

export const VISITOR_REGISTER_FLAG = "visitorRegister";

export const VISITOR_WRITE_CAPS: Capability[] = ["task.edit.all", "task.edit.assigned"];

type SessionLike = { tenantId: string; roles: string[]; permissions?: string[] | null };

export async function visitorRegisterEnabled(session: SessionLike): Promise<boolean> {
  const license = await loadTenantLicense(session.tenantId, session.roles);
  return license.featureFlags?.[VISITOR_REGISTER_FLAG] === true;
}

/** Throws a 404-shaped error when the firm does not have the register. */
export async function assertVisitorRegister(session: SessionLike): Promise<void> {
  if (!(await visitorRegisterEnabled(session))) throw Object.assign(new Error("Not found"), { status: 404 });
}

export function canEditVisitors(session: SessionLike): boolean {
  return VISITOR_WRITE_CAPS.some((c) => can(session.roles, c, session.permissions));
}
