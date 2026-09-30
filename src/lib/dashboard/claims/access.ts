/**
 * Who may open the Insurance Claims Control Centre, over which claims, and
 * what they may do from it — decided once, here, for the page and for the
 * drawer, search and follow-up routes.
 *
 *   · Opening it needs `dashboard.view.claims` (the insurance team by default;
 *     owner through the hard-case in can()).
 *   · A branch head locked to their branch (the branch view's lock) sees that
 *     branch's claims.
 *   · Everyone else who may open it sees every claim: the claims team works
 *     the whole book, and the claims register already shows every claim to
 *     anyone with `insurance.view`, so this widens nothing.
 *   · Someone an admin shared the Claims Dashboard with, who has neither,
 *     sees the claims of their own clients and the claims they own — sharing
 *     a dashboard never widens what it shows.
 *   · Changing a claim needs `insurance.write`, exactly as on the claim page;
 *     client details beyond the claim need the investor view caps.
 */

import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { isBranchScoped } from "@/lib/leads/access";
import type { ClaimScope } from "./window";

export function claimsAccess(session: SessionUser) {
  const { roles, permissions } = session;
  const allBranches = can(roles, "dashboard.view.all_branches", permissions);
  const wholeBook = can(roles, "dashboard.view.claims", permissions) || can(roles, "insurance.view", permissions);
  const scope: ClaimScope =
    isBranchScoped(session) && !allBranches && session.branchId ? { kind: "branch", branchId: session.branchId }
    : wholeBook ? { kind: "firm" }
    : { kind: "self", userId: session.userId };
  return {
    allowed: can(roles, "dashboard.view.claims", permissions),
    scope,
    /** Open the claim page and its register. */
    canView: can(roles, "insurance.view", permissions),
    /** Change status, owner, amounts; schedule a follow-up. */
    canWrite: can(roles, "insurance.write", permissions),
    canClient360: can(roles, "investor.view.all", permissions) || can(roles, "investor.view.assigned", permissions),
    /** The audit trail's actors and times on each claim. */
    canAudit: can(roles, "insurance.view", permissions),
  };
}
