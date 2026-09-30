/**
 * What a viewer's dashboards may count — the record-access rule, applied to
 * every widget whatever dashboard it sits on (D8: "an RM sees only their
 * clients, a branch head only their branch, even on a dashboard shared with
 * them"). Server-safe, no DB.
 *
 *   firm    the owner, anyone given "all branches", and roles that see the
 *           whole client book (compliance, operations, back office)
 *   branch  a branch head without "all branches": their branch
 *   team    someone people report to (users.reporting_manager_id, any depth):
 *           their own and their team's clients and work, and the RM filter
 *           offers exactly those people (lib/dashboards/team.ts resolves it)
 *   self    everyone else: their own clients and their own work
 *
 * The filter bar only narrows inside this: an RM filter can never reach a
 * client outside the viewer's access, and a branch head's Branch filter is
 * pinned to their branch.
 */

import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { MetricScope } from "@/lib/metrics/scope";
import type { FilterState } from "./filters";

export type DataAccess =
  | { kind: "firm" }
  | { kind: "branch"; branchId: string }
  /** The viewer and everyone who reports to them. */
  | { kind: "team"; userId: string; memberIds: string[] }
  | { kind: "self"; userId: string };

function isBranchLocked(session: SessionUser): boolean {
  return (
    !session.roles.includes("owner") &&
    session.roles.includes("branch_head") &&
    !can(session.roles, "dashboard.view.all_branches", session.permissions)
  );
}

export function dataAccessFor(session: SessionUser): DataAccess {
  if (session.roles.includes("owner")) return { kind: "firm" };
  if (can(session.roles, "dashboard.view.all_branches", session.permissions)) return { kind: "firm" };
  if (isBranchLocked(session)) {
    // A branch head with no branch sees their own book, never the firm.
    return session.branchId ? { kind: "branch", branchId: session.branchId } : { kind: "self", userId: session.userId };
  }
  if (can(session.roles, "investor.view.all", session.permissions)) return { kind: "firm" };
  return { kind: "self", userId: session.userId };
}

/** "Showing: your clients / Ahmedabad HQ / whole firm". */
export function accessLabel(access: DataAccess, branchName?: string | null): string {
  if (access.kind === "firm") return "whole firm";
  if (access.kind === "branch") return branchName ?? "your branch";
  if (access.kind === "team") return `you and your team (${access.memberIds.length - 1} ${access.memberIds.length === 2 ? "person" : "people"})`;
  return "your clients";
}

/** May the viewer pick RMs? Not when they only ever see themselves; a team lead picks among their team. */
export function canFilterRm(access: DataAccess): boolean {
  return access.kind !== "self";
}

/** May the viewer pick branches? Only firm-wide viewers, and only with more than one real branch. */
export function canFilterBranch(access: DataAccess, realBranchCount: number): boolean {
  return access.kind === "firm" && realBranchCount > 1;
}

/**
 * The metric scope for a viewer and a filter state: access first, then the
 * filters, each narrowing. `me` in the RM filter is the viewer.
 */
export function scopeFor(tenantId: string, session: SessionUser, access: DataAccess, state: FilterState): MetricScope {
  const v = state.values;
  const rmPick = (v.rm ?? []).map((id) => (id === "me" ? session.userId : id));
  const scope: MetricScope = { tenantId };

  if (access.kind === "self") {
    scope.rmIds = [session.userId];
  } else if (access.kind === "team") {
    // Only people in the team can be picked; with none picked, the whole team.
    const picked = rmPick.filter((id) => access.memberIds.includes(id));
    scope.rmIds = picked.length ? picked : access.memberIds;
  } else {
    if (rmPick.length) scope.rmIds = rmPick;
    if (access.kind === "branch") scope.branchIds = [access.branchId];
    else if (v.branch?.length) scope.branchIds = v.branch;
  }
  if (v.segment?.length) scope.segments = v.segment;
  if (v.category?.length) scope.categories = v.category;
  if (v.family?.length) scope.familyIds = v.family;
  if (v.tags?.length) scope.tags = v.tags;
  if (v.amc?.length) scope.amcs = v.amc;
  if (v.leadSource?.length) scope.leadSources = v.leadSource;
  return scope;
}
