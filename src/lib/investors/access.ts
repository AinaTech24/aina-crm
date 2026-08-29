/**
 * Client (investor) row-level access scope.
 *
 * RLS isolates by TENANT only — it does NOT slice a tenant's clients by who may
 * see them. That slice is the application's job, and it has to be applied in
 * EVERY query that returns a list of clients: the list page, the Excel export,
 * and the JSON API. The detail route enforces the same rule per-row.
 *
 * The policy (mirrors the capability matrix in lib/auth/rbac.ts):
 *   owner / compliance / back_office / ops  → the whole firm's book
 *   branch_head (with a branch)             → their branch only
 *   rm                                      → clients assigned to them
 *   anyone else (marketing, team_member …)  → no client access at all
 *
 * Deliberately mirrors `lib/leads/access.ts`, which does the same job for the
 * pipeline; keep the two in step when the policy changes.
 */

import { eq, sql } from "drizzle-orm";
import { investors } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
// Session-level helper — its canonical home is the leads access module (its
// first caller). Branch scoping is identical for clients and leads.
import { isBranchScoped } from "@/lib/leads/access";

/** Throws 403 when the caller has no client visibility at all. */
export function requireInvestorView(session: SessionUser) {
  requireAny(
    session.roles,
    ["investor.view.all", "investor.view.assigned"],
    session.permissions
  );
}

export function canViewAllInvestors(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions);
}

/**
 * Drizzle condition restricting a client query to what this session may see.
 * `undefined` means "no restriction" (firm-wide viewer) so callers can spread
 * it into an `and(...)` without an extra branch.
 */
export function investorScopeCondition(session: SessionUser) {
  requireInvestorView(session);
  if (isBranchScoped(session)) return eq(investors.branchId, session.branchId!);
  if (canViewAllInvestors(session)) return undefined;
  return eq(investors.rmId, session.userId);
}

/**
 * Same rule as raw SQL, for queries built with sql`` fragments rather than the
 * query builder. Returns `TRUE` for firm-wide viewers so it can be joined into
 * an AND chain unconditionally.
 */
export function investorScopeSql(session: SessionUser, alias = "investors") {
  requireInvestorView(session);
  if (isBranchScoped(session)) {
    return sql`${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid`;
  }
  if (canViewAllInvestors(session)) return sql`TRUE`;
  return sql`${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid`;
}
