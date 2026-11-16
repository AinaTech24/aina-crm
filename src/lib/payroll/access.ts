/**
 * Who may see and change payroll. Salaries are owner-only until the owner
 * grants `payroll.manage` (run it) or `payroll.view` (read it). Everyone sees
 * their own payslips in My pay.
 */

import { can } from "@/lib/auth/rbac";

type S = { roles: string[]; permissions?: string[] | null; userId: string; tenantId: string };

export const canManagePayroll = (s: S) => can(s.roles, "payroll.manage", s.permissions);
export const canViewPayroll = (s: S) => canManagePayroll(s) || can(s.roles, "payroll.view", s.permissions);
export const isOwner = (s: S) => s.roles.includes("owner");

export function requirePayroll(s: S, level: "view" | "manage"): void {
  const ok = level === "manage" ? canManagePayroll(s) : canViewPayroll(s);
  if (!ok) throw Object.assign(new Error(level === "manage" ? "forbidden: missing payroll.manage" : "forbidden: missing payroll.view"), { status: 403 });
}

export const actorOf = (s: S) => ({ tenantId: s.tenantId, userId: s.userId, isOwner: isOwner(s) });
