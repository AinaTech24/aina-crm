/**
 * Who may see and change the practice system.
 *
 *   view   the Systems Map, positions, promise, measures, strategy — the
 *          people who run the firm: owner, branch head, compliance.
 *   manage editing positions, process owners, the service promise and the
 *          strategic objective — the owner (or anyone granted settings.users).
 *
 * Every member of staff sees their OWN operations manual (/practice/manual)
 * and the SOP library.
 */

import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/jwt";

export const PRACTICE_VIEW_ROLES = ["owner", "branch_head", "compliance"];

export function canViewPractice(session: Pick<SessionUser, "roles" | "permissions">): boolean {
  return session.roles.some((r) => PRACTICE_VIEW_ROLES.includes(r));
}

export function canManagePractice(session: Pick<SessionUser, "roles" | "permissions">): boolean {
  return session.roles.includes("owner") || can(session.roles, "settings.users", session.permissions);
}
