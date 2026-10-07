/**
 * Who may see which proposals.
 *
 * Two rules, both applied:
 *  1. The module's own: a viewer without `investor.view.all` / `compliance.view`
 *     sees only the proposals they prepared (`prepared_by_user_id`).
 *  2. The recipient's scope: a proposal for a CLIENT is visible only when that
 *     client is (`investorScopeSql`), for a LEAD when the lead is
 *     (`leadScopeSql`), for a FAMILY when the family is (`familyScopeSql`).
 *     No capability for that kind of recipient → none of those proposals.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { proposals } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { familyScopeSql } from "@/lib/families/access";

export function proposalSeesAll(session: SessionUser) {
  return can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
}

function hasCap(session: SessionUser, caps: string[]) {
  return caps.some((c) => can(session.roles, c as any, session.permissions));
}

/** Client part, over an `investors` alias; FALSE without a client capability. */
export async function proposalInvestorScopeSql(tx: any, session: SessionUser, alias = "i") {
  return hasCap(session, ["investor.view.all", "investor.view.assigned"])
    ? await investorScopeSql(tx, session, alias)
    : sql`FALSE`;
}

/** Recipient part only (rule 2), over a `proposals` alias. */
export async function proposalRecipientScopeSql(tx: any, session: SessionUser, alias = "proposals") {
  const col = (c: string) => sql.raw(`${alias}.${c}`);
  const inv = await proposalInvestorScopeSql(tx, session, "pr_i");
  const lead = hasCap(session, ["lead.view.all", "lead.view.assigned"]) ? leadScopeSql(session, "pr_l") : sql`FALSE`;
  const fam = hasCap(session, ["family.view", "investor.view.all", "investor.view.assigned"])
    ? await familyScopeSql(tx, session, "pr_f")
    : sql`FALSE`;
  return sql`(
    (${col("recipient_type")} = 'family' AND ${col("family_id")} IS NOT NULL
      AND EXISTS (SELECT 1 FROM families pr_f WHERE pr_f.id = ${col("family_id")} AND ${fam}))
    OR (${col("recipient_type")} <> 'family' AND ${col("investor_id")} IS NOT NULL
      AND EXISTS (SELECT 1 FROM investors pr_i WHERE pr_i.id = ${col("investor_id")} AND ${inv}))
    OR (${col("recipient_type")} <> 'family' AND ${col("investor_id")} IS NULL AND ${col("lead_id")} IS NOT NULL
      AND EXISTS (SELECT 1 FROM leads pr_l WHERE pr_l.id = ${col("lead_id")} AND ${lead}))
    OR (${col("investor_id")} IS NULL AND ${col("lead_id")} IS NULL AND ${col("family_id")} IS NULL)
  )`;
}

/** Full condition over a `proposals` alias (rules 1 + 2). */
export async function proposalScopeSql(tx: any, session: SessionUser, alias = "proposals") {
  const own = proposalSeesAll(session)
    ? sql`TRUE`
    : sql`${sql.raw(`${alias}.prepared_by_user_id`)} = ${session.userId}::uuid`;
  return sql`(${own} AND ${await proposalRecipientScopeSql(tx, session, alias)})`;
}

/** One proposal, or null when it is missing or out of scope (→ 404). */
export async function loadViewableProposal(tx: Tx, session: SessionUser, id: string) {
  const [row] = await tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId), await proposalScopeSql(tx, session)))
    .limit(1);
  return row ?? null;
}
