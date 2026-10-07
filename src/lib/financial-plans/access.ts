/**
 * Who may see which financial plans (Financial Health Check).
 *
 * Two rules, both applied:
 *  1. The module's own: a viewer without `investor.view.all` / `compliance.view`
 *     sees only the plans they prepared.
 *  2. The subject's scope: a plan for a CLIENT is visible only when that client
 *     is (`investorScopeSql` — firm switch, customised "assigned only"
 *     permissions, branch lock); a plan for a LEAD only when that lead is
 *     (`leadScopeSql`). No client / lead capability at all → none of those plans.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { financialPlans } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";

export function planSeesAll(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
}

function hasCap(session: SessionUser, caps: string[]) {
  return caps.some((c) => can(session.roles, c as any, session.permissions));
}

/** Client part only, over an `investors` alias; FALSE without a client capability. */
export async function planInvestorScopeSql(tx: any, session: SessionUser, alias = "i") {
  return hasCap(session, ["investor.view.all", "investor.view.assigned"])
    ? await investorScopeSql(tx, session, alias)
    : sql`FALSE`;
}

/** Lead part only, over a `leads` alias; FALSE without a lead capability. */
export function planLeadScopeSql(session: SessionUser, alias = "l") {
  return hasCap(session, ["lead.view.all", "lead.view.assigned"]) ? leadScopeSql(session, alias) : sql`FALSE`;
}

/** Full condition over a `financial_plans` alias (rules 1 + 2). */
export async function planScopeSql(tx: any, session: SessionUser, alias = "financial_plans") {
  const col = (c: string) => sql.raw(`${alias}.${c}`);
  const own = planSeesAll(session) ? sql`TRUE` : sql`${col("prepared_by_user_id")} = ${session.userId}::uuid`;
  const inv = await planInvestorScopeSql(tx, session, "fp_i");
  const lead = planLeadScopeSql(session, "fp_l");
  return sql`(${own} AND (
    (${col("investor_id")} IS NOT NULL AND EXISTS (SELECT 1 FROM investors fp_i WHERE fp_i.id = ${col("investor_id")} AND ${inv}))
    OR (${col("lead_id")} IS NOT NULL AND EXISTS (SELECT 1 FROM leads fp_l WHERE fp_l.id = ${col("lead_id")} AND ${lead}))
  ))`;
}

/** One plan, or null when it is missing or out of scope. */
export async function loadViewablePlan(tx: Tx, session: SessionUser, id: string) {
  const [plan] = await tx
    .select()
    .from(financialPlans)
    .where(and(eq(financialPlans.id, id), eq(financialPlans.tenantId, session.tenantId), await planScopeSql(tx, session)))
    .limit(1);
  return plan ?? null;
}
