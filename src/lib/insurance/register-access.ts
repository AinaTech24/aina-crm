/**
 * Who may see which insurance policies and claims on the REGISTER screens and
 * APIs (the Insurance / Claims dashboards have their own access layer in
 * lib/dashboard/insurance and lib/dashboard/claims).
 *
 * Two rules, both applied:
 *  1. The register's own: a viewer without `investor.view.all` /
 *     `compliance.view` (the register's "manager") sees their own book —
 *     policies they sold or whose client they manage.
 *  2. The client's scope: a policy or claim is visible only when its client is
 *     (`investorScopeSql` — firm switch, customised "assigned only"
 *     permissions, branch lock). No client capability at all → none.
 *     `insurance.view.all` (the Insurance Head's grant) skips rule 2 only;
 *     each surface still applies its own rule 1.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { insuranceClaims, insurancePolicies } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeCondition, investorScopeSql } from "@/lib/investors/access";

/** The register's "manager" test (rule 1 off). */
export function registerSeesAll(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
}

/**
 * Rule 2 as an SQL condition: the client whose id is `investorIdSql` (a column
 * reference such as sql`p.investor_id`) is in this session's client scope.
 */
export async function insuranceClientScopeSql(tx: any, session: SessionUser, investorIdSql: SQL): Promise<SQL> {
  // `insurance.view.all` is the Insurance Head's explicit grant of the whole
  // insurance book; an owner who ticked it meant it.
  if (can(session.roles, "insurance.view.all", session.permissions)) return sql`TRUE`;
  const hasClientView = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions);
  if (!hasClientView) return sql`FALSE`;
  const scope = await investorScopeSql(tx, session, "ins_scope_i");
  return sql`EXISTS (SELECT 1 FROM investors ins_scope_i WHERE ins_scope_i.id = ${investorIdSql} AND ${scope})`;
}

/**
 * One policy (rules 1 + 2), or null when missing or out of scope (→ 404).
 * `seesAll` overrides rule 1's manager test for a surface that has its own
 * (the register page counts `insurance.view.all` as a manager).
 */
export async function loadViewablePolicy(tx: Tx, session: SessionUser, id: string, opts: { seesAll?: boolean } = {}) {
  const own = (opts.seesAll ?? registerSeesAll(session))
    ? undefined
    : sql`(${insurancePolicies.soldByUserId} = ${session.userId}::uuid OR ${insurancePolicies.investorId} IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
  const [row] = await tx
    .select()
    .from(insurancePolicies)
    .where(and(
      eq(insurancePolicies.id, id),
      eq(insurancePolicies.tenantId, session.tenantId),
      own,
      await insuranceClientScopeSql(tx, session, sql`${insurancePolicies.investorId}`),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Rule 2 for a CLAIM, whose client link is optional: a claim on a client is
 * visible when that client is; a claim not linked to any client is visible to
 * an unrestricted viewer, and to a restricted one only when they own it.
 * `investorIdSql` / `rmIdSql` are column references (e.g. sql`c.investor_id`).
 */
export async function claimClientScopeSql(tx: any, session: SessionUser, investorIdSql: SQL, rmIdSql: SQL): Promise<SQL> {
  const linked = await insuranceClientScopeSql(tx, session, investorIdSql);
  const hasClientView = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions);
  const unrestricted = can(session.roles, "insurance.view.all", session.permissions)
    || (hasClientView && (await investorScopeCondition(tx, session)) === undefined);
  const unlinked = unrestricted ? sql`TRUE` : sql`${rmIdSql} = ${session.userId}::uuid`;
  return sql`((${investorIdSql} IS NOT NULL AND ${linked}) OR (${investorIdSql} IS NULL AND ${unlinked}))`;
}

/** One claim, or null when missing or out of the viewer's client scope (→ 404). */
export async function loadViewableClaim(tx: Tx, session: SessionUser, id: string) {
  const [row] = await tx
    .select()
    .from(insuranceClaims)
    .where(and(
      eq(insuranceClaims.id, id),
      eq(insuranceClaims.tenantId, session.tenantId),
      await claimClientScopeSql(tx, session, sql`${insuranceClaims.investorId}`, sql`${insuranceClaims.rmId}`),
    ))
    .limit(1);
  return row ?? null;
}
