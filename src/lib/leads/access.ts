import { and, eq, sql } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import type { Tx } from "@/db/client";

export function requireLeadView(session: SessionUser) {
  requireAny(session.roles, ["lead.view.all", "lead.view.assigned"], session.permissions);
}

export function requireLeadEdit(session: SessionUser) {
  requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
}

export function canViewAllLeads(session: SessionUser) {
  if (session.mobile) return session.roles.some(r => ["owner", "ops", "back_office"].includes(r));
  return can(session.roles, "lead.view.all", session.permissions);
}

export function canEditAllLeads(session: SessionUser) {
  if (session.mobile) return session.roles.some(r => ["owner", "ops", "back_office"].includes(r)) || (session.roles.includes("branch_head") && !!session.branchId);
  return can(session.roles, "lead.edit.all", session.permissions);
}

/** Who may restore a deleted lead: the owner, a branch head (their branch —
 *  loadEditableLead decides), or a lead manager (lead.edit.all). */
export function canRestoreLeads(session: SessionUser) {
  return session.roles.includes("owner") || session.roles.includes("branch_head") || canEditAllLeads(session);
}

/**
 * A branch head is scoped to their OWN branch — even though their role can
 * "view all", they only ever see their branch's pipeline. Only applies when a
 * branch is actually assigned to them (else they fall through to the normal
 * caps, so a mis-configured branch head is never locked out). Owner is never
 * branch-limited.
 */
export function isBranchScoped(session: SessionUser): boolean {
  if (session.mobile && session.roles.some(r => ["owner", "ops", "back_office"].includes(r))) return false;
  return (
    !session.roles.includes("owner") &&
    session.roles.includes("branch_head") &&
    !!session.branchId
  );
}

/**
 * The leads a viewer sees — ONE rule for the Leads list, the API, the
 * nurture page and the dashboards' lead cards (audit L12):
 *
 *   firm    — lead.view.all (owner, managers)
 *   branch  — a branch head: leads of their branch, i.e. `branch_id` = the
 *             branch, or — where no branch was recorded — owned by someone in
 *             it (lib/metrics leadWhere's rule; a lead's branch follows its
 *             owner on every write, lib/leads/ownership.ts)
 *   team    — anyone else: their own leads plus those of everyone who reports
 *             to them (users.reporting_manager_id, any depth) — the dashboards'
 *             `team` access (lib/dashboards/team.ts). Seeing a teammate's lead
 *             does not make it editable (loadEditableLead).
 */
export function leadScopeCondition(session: SessionUser) {
  // A firm-wide viewer adds no condition; everyone else gets leadScopeSql's.
  if (canViewAllLeads(session) && !isBranchScoped(session)
    && !(session.mobile && session.roles.includes("branch_head") && !session.branchId)) {
    requireLeadView(session);
    return undefined;
  }
  return leadScopeSql(session, "leads");
}

/** Leads of a branch: recorded there, or (none recorded) owned by someone in it. */
export function leadInBranchSql(alias: string, tenantId: string, branchId: string) {
  const a = (c: string) => sql.raw(`${alias}.${c}`);
  return sql`(${a("branch_id")} = ${branchId}::uuid
    OR (${a("branch_id")} IS NULL AND ${a("owner_id")} IN (
      SELECT bu.id FROM users bu WHERE bu.tenant_id = ${tenantId}::uuid AND bu.branch_id = ${branchId}::uuid)))`;
}

/** The viewer's reporting line below them (any depth), as a uuid subquery. */
function teamIdsSql(tenantId: string, userId: string) {
  return sql`(WITH RECURSIVE team AS (
      SELECT tu.id FROM users tu
       WHERE tu.tenant_id = ${tenantId}::uuid AND tu.reporting_manager_id = ${userId}::uuid AND tu.deleted_at IS NULL
      UNION
      SELECT tu.id FROM users tu JOIN team t ON tu.reporting_manager_id = t.id
       WHERE tu.tenant_id = ${tenantId}::uuid AND tu.deleted_at IS NULL
    ) SELECT id FROM team)`;
}

export function leadScopeSql(session: SessionUser, alias = "leads") {
  requireLeadView(session);
  if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r)) && session.roles.includes("branch_head") && !session.branchId) return sql`FALSE`;
  if (isBranchScoped(session)) return leadInBranchSql(alias, session.tenantId, session.branchId!);
  if (canViewAllLeads(session)) return sql`TRUE`;
  const own = sql`${sql.raw(`${alias}.owner_id`)} = ${session.userId}::uuid`;
  // The app keeps the mobile rule as it was (own leads only).
  if (session.mobile) return own;
  return sql`(${own} OR ${sql.raw(`${alias}.owner_id`)} IN ${teamIdsSql(session.tenantId, session.userId)})`;
}

/** Is the lead in the viewer's branch (recorded, or by its owner when none is)? */
async function leadIsInBranch(tx: Tx, session: SessionUser, lead: { branchId: string | null; ownerId: string | null }) {
  if (lead.branchId) return lead.branchId === session.branchId;
  if (!lead.ownerId) return false;
  const r = await tx.execute(sql`SELECT 1 FROM users WHERE id = ${lead.ownerId}::uuid AND tenant_id = ${session.tenantId}::uuid AND branch_id = ${session.branchId}::uuid`);
  return r.rows.length > 0;
}

export async function loadEditableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadEdit(session);
  if (session.mobile && session.roles.includes("branch_head") && !canEditAllLeads(session) && !session.branchId) {
    throw Object.assign(new Error("forbidden: no branch is assigned"), { status: 403 });
  }
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId))).limit(1);
  if (!lead) throw Object.assign(new Error("lead not found"), { status: 404 });
  if (isBranchScoped(session)) {
    if (await leadIsInBranch(tx, session, lead)) return lead;
    throw Object.assign(new Error("forbidden: lead is in another branch"), { status: 403 });
  }
  if (canEditAllLeads(session)) return lead;
  if (lead.ownerId === session.userId) return lead;
  throw Object.assign(new Error("forbidden: lead is not assigned to you"), { status: 403 });
}

export async function loadViewableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadView(session);
  if (session.mobile && session.roles.includes("branch_head") && !canViewAllLeads(session) && !session.branchId) return null;
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId))).limit(1);
  if (!lead) return null;
  if (isBranchScoped(session)) return (await leadIsInBranch(tx, session, lead)) ? lead : null;
  if (canViewAllLeads(session) || lead.ownerId === session.userId) return lead;
  // Someone who reports to the viewer owns it (the team rule of leadScopeSql).
  if (!session.mobile && lead.ownerId) {
    const r = await tx.execute(sql`SELECT 1 WHERE ${lead.ownerId}::uuid IN ${teamIdsSql(session.tenantId, session.userId)}`);
    if (r.rows.length) return lead;
  }
  return null;
}
