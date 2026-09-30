/**
 * Who may open the Operations Control Tower, and over which records — decided
 * once, here, for the page AND for the detail / export routes, so a route can
 * never show a record the page would not.
 *
 *   · Opening it needs `dashboard.view.ops` (back office, ops, service team;
 *     owner through the hard-case in can()).
 *   · A branch head locked to their branch (the same lock as the branch view)
 *     sees that branch only.
 *   · `task.view.all` sees the firm; anyone else, only their own work.
 */

import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { isBranchScoped } from "@/lib/leads/access";
import type { OpsScope } from "./window";

export function opsAccess(session: SessionUser): { allowed: boolean; scope: OpsScope; audit: boolean; contacts: boolean } {
  const { roles, permissions } = session;
  const allowed = can(roles, "dashboard.view.ops", permissions);
  const allBranches = can(roles, "dashboard.view.all_branches", permissions);
  const scope: OpsScope =
    isBranchScoped(session) && !allBranches && session.branchId ? { kind: "branch", branchId: session.branchId }
    : can(roles, "task.view.all", permissions) ? { kind: "firm" }
    : { kind: "self", userId: session.userId };
  return {
    allowed,
    scope,
    // The audit log is the owner's and compliance's (app/dashboard/audit-log).
    audit: roles.includes("owner") || roles.includes("compliance"),
    // Client contact details only where the viewer may already see the client.
    contacts: can(roles, "investor.view.all", permissions) || can(roles, "investor.view.assigned", permissions),
  };
}
