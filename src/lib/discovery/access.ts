/**
 * Who may see a fact-find. A discovery holds the subject's PAN, income,
 * holdings and nominee, so it follows its SUBJECT: a client's fact-find is
 * visible exactly when the client is (investorScopeSql), a lead's when the lead
 * is (leadScopeSql).
 *
 * Before 2026-10-07 every route checked only that the viewer could see SOME
 * clients or leads, so an RM could list, open, edit and share any fact-find in
 * the firm, and could start one on another RM's client to read its prefilled
 * record. Every reader now goes through discoveryScopeSql, and creation goes
 * through subjectVisible.
 */

import { sql, type SQL } from "drizzle-orm";
import { can, requireAny } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql, loadEditableLead } from "@/lib/leads/access";

const canSeeClients = (s: SessionUser) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions);
const canSeeLeads = (s: SessionUser) =>
  can(s.roles, "lead.view.all", s.permissions) || can(s.roles, "lead.view.assigned", s.permissions);

/**
 * SQL condition on a financial_discoveries row (`alias`) that holds only when
 * the viewer may see its subject. A viewer without client access sees no
 * client fact-finds, and likewise for leads.
 */
export async function discoveryScopeSql(tx: any, session: SessionUser, alias = "financial_discoveries"): Promise<SQL> {
  const d = sql.raw(alias);
  const inv = canSeeClients(session)
    ? sql`(${d}.subject_type = 'investor' AND EXISTS (
        SELECT 1 FROM investors dsi
         WHERE dsi.id = ${d}.subject_id AND dsi.tenant_id = ${d}.tenant_id AND dsi.deleted_at IS NULL
           AND ${await investorScopeSql(tx, session, "dsi")}))`
    : sql`FALSE`;
  const lead = canSeeLeads(session)
    ? sql`(${d}.subject_type = 'lead' AND EXISTS (
        SELECT 1 FROM leads dsl
         WHERE dsl.id = ${d}.subject_id AND dsl.tenant_id = ${d}.tenant_id
           AND ${leadScopeSql(session, "dsl")}))`
    : sql`FALSE`;
  return sql`(${inv} OR ${lead})`;
}

/** May the viewer see this client / lead? Required before a fact-find is started on it. */
export async function subjectVisible(
  tx: any,
  session: SessionUser,
  subjectType: "investor" | "lead",
  subjectId: string,
): Promise<{ name: string | null } | null> {
  if (subjectType === "investor") {
    if (!canSeeClients(session)) return null;
    const r = await tx.execute(sql`
      SELECT name FROM investors i
       WHERE i.id = ${subjectId}::uuid AND i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL
         AND ${await investorScopeSql(tx, session, "i")}
       LIMIT 1`);
    return (r.rows[0] as { name: string | null } | undefined) ?? null;
  }
  if (!canSeeLeads(session)) return null;
  const r = await tx.execute(sql`
    SELECT name FROM leads l
     WHERE l.id = ${subjectId}::uuid AND l.tenant_id = ${session.tenantId}::uuid
       AND ${leadScopeSql(session, "l")}
     LIMIT 1`);
  return (r.rows[0] as { name: string | null } | undefined) ?? null;
}

/**
 * May the viewer CHANGE the fact-find's subject record (apply corrections,
 * save a risk profile)? The same rule as the client edit API (investor.edit.*
 * with the assigned / branch row check) and loadEditableLead for a lead.
 * Seeing a fact-find is not enough to write to the record behind it.
 */
export async function assertCanEditSubject(
  tx: any,
  session: SessionUser,
  subjectType: string,
  subjectId: string,
): Promise<void> {
  if (subjectType === "lead") {
    await loadEditableLead(tx, session, subjectId);
    return;
  }
  requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
  if (can(session.roles, "investor.edit.all", session.permissions)) return;
  const inv = (await tx.execute(sql`
    SELECT rm_id, branch_id FROM investors
     WHERE id = ${subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL LIMIT 1`)).rows[0] as
    | { rm_id: string | null; branch_id: string | null }
    | undefined;
  const branchScoped = !session.roles.includes("owner") && session.roles.includes("branch_head") && !!session.branchId;
  const ok = !!inv && (branchScoped ? inv.branch_id === session.branchId : inv.rm_id === session.userId);
  if (!ok) throw Object.assign(new Error("forbidden: client is not assigned to you"), { status: 403 });
}
