/**
 * Who may open the Insurance Business Command Centre, and over which book —
 * decided once, here, for the page and for the client-drawer route.
 *
 *   · Opening it needs `dashboard.view.insurance` (the insurance team; owner
 *     through the hard-case in can()).
 *   · A branch head locked to their branch (the same lock as the branch view)
 *     sees that branch.
 *   · The whole firm needs `insurance.view.all` — the Insurance Head's grant —
 *     or the firm-wide client access the insurance register already treats as
 *     a manager's (investor.view.all, compliance.view).
 *   · Anyone else sees their own book: policies they sold or own, and their
 *     clients' policies.
 */

import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { isBranchScoped } from "@/lib/leads/access";
import type { InsScope } from "./window";

export function seesWholeInsuranceBook(session: Pick<SessionUser, "roles" | "permissions">): boolean {
  const { roles, permissions } = session;
  return can(roles, "insurance.view.all", permissions) || can(roles, "investor.view.all", permissions) || can(roles, "compliance.view", permissions);
}

export function insuranceAccess(session: SessionUser) {
  const { roles, permissions } = session;
  const allBranches = can(roles, "dashboard.view.all_branches", permissions);
  const scope: InsScope =
    isBranchScoped(session) && !allBranches && session.branchId ? { kind: "branch", branchId: session.branchId }
    : seesWholeInsuranceBook(session) ? { kind: "firm" }
    : { kind: "self", userId: session.userId };
  return {
    allowed: can(roles, "dashboard.view.insurance", permissions),
    scope,
    contacts: can(roles, "investor.view.all", permissions) || can(roles, "investor.view.assigned", permissions),
    canWritePolicy: can(roles, "insurance.write", permissions),
    canLead: can(roles, "lead.edit.all", permissions) || can(roles, "lead.edit.assigned", permissions),
    canMeeting: can(roles, "review_meeting.manage.assigned", permissions) || can(roles, "review_meeting.manage.all", permissions),
    canProposal: can(roles, "proposal.write", permissions),
    canTask: can(roles, "task.edit.all", permissions) || can(roles, "task.edit.assigned", permissions),
    canClaims: can(roles, "insurance.view", permissions),
  };
}
