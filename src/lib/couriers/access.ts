/**
 * Who may use Couriers (2026-11-27, Akshar Invest).
 *
 * The firm: only one whose `courierRegister` flag is on (Aina Admin → the firm →
 * Access → feature flags). Off, the menu item is not drawn and every page and
 * API answers "not found".
 *
 * The person: everyone on that firm's team may read; adding, editing, importing
 * and deleting needs a task-edit permission, which every working role holds and
 * the read-only Viewer does not. As with the Visitor Register, there is no
 * permission or sidebar grant of its own on purpose: a saved list grants only
 * what it names, so a new one would be missing from every customised user — and
 * would show up in other firms' access editors.
 */

import { loadTenantLicense } from "@/lib/auth/license";
import { can, type Capability } from "@/lib/auth/rbac";

export const COURIER_FLAG = "courierRegister";

export const COURIER_WRITE_CAPS: Capability[] = ["task.edit.all", "task.edit.assigned"];

type SessionLike = { tenantId: string; roles: string[]; permissions?: string[] | null };

export async function couriersEnabled(session: SessionLike): Promise<boolean> {
  const license = await loadTenantLicense(session.tenantId, session.roles);
  return license.featureFlags?.[COURIER_FLAG] === true;
}

/** Throws a 404-shaped error when the firm does not have Couriers. */
export async function assertCouriers(session: SessionLike): Promise<void> {
  if (!(await couriersEnabled(session))) throw Object.assign(new Error("Not found"), { status: 404 });
}

export function canEditCouriers(session: SessionLike): boolean {
  return COURIER_WRITE_CAPS.some((c) => can(session.roles, c, session.permissions));
}
