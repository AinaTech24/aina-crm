/**
 * The positions API's gates. Reading needs the practice view (owner, branch
 * head, compliance); writing needs to manage the practice AND settings.users.
 */

import type { SessionUser } from "@/lib/auth/session";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";

const forbidden = (msg: string) => Object.assign(new Error(msg), { status: 403 });

export function gateView(session: SessionUser): void {
  if (!canViewPractice(session)) throw forbidden("forbidden: practice view");
}

/** Call AFTER `require(session.roles, "settings.users", session.permissions)` in the handler. */
export function gateManage(session: SessionUser): void {
  if (!canManagePractice(session)) throw forbidden("forbidden: practice manage");
}

export const tenantOpts = (session: SessionUser) => ({
  userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles,
});
