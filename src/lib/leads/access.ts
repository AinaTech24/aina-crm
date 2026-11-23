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
 * Did the owner TICK this capability for this person ("Customize access permissions")?
 * A branch head's role defaults give only "view assigned", so a ticked "View all
 * clients / leads" is a deliberate step up — it must not be undone by the branch lock
 * that every branch head otherwise gets (Shah Financial, 2026-11-23: a team member
 * with Branch Head + Back Office and View all clients ticked saw almost no clients).
 */
export function hasExplicitGrant(session: SessionUser, cap: "investor.view.all" | "lead.view.all"): boolean {
  return !session.roles.includes("owner") && (session.permissions?.length ?? 0) > 0 && !!session.permissions?.includes(cap);
}

/** The branch lock as it applies to CLIENT lists: lifted by an explicitly ticked "View all clients". */
export function isClientBranchScoped(session: SessionUser): boolean {
  return isBranchScoped(session) && !hasExplicitGrant(session, "investor.view.all");
}

/** The branch lock as it applies to LEAD lists: lifted by an explicitly ticked "View all leads". */
export function isLeadBranchScoped(session: SessionUser): boolean {
  return isBranchScoped(session) && !hasExplicitGrant(session, "lead.view.all");
}

export function leadScopeCondition(session: SessionUser) {
  requireLeadView(session);
  if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r)) && session.roles.includes("branch_head") && !session.branchId) return sql`FALSE`;
  if (isLeadBranchScoped(session)) return eq(leads.branchId, session.branchId!);
  if (canViewAllLeads(session)) return undefined;
  return eq(leads.ownerId, session.userId);
}

export function leadScopeSql(session: SessionUser, alias = "leads") {
  requireLeadView(session);
  if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r)) && session.roles.includes("branch_head") && !session.branchId) return sql`FALSE`;
  if (isLeadBranchScoped(session)) return sql`${sql.raw(`${alias}.branch_id`)} = ${session.branchId}::uuid`;
  if (canViewAllLeads(session)) return sql`TRUE`;
  return sql`${sql.raw(`${alias}.owner_id`)} = ${session.userId}::uuid`;
}

export async function loadEditableLead(tx: Tx, session: SessionUser, leadId: string) {
  requireLeadEdit(session);
  if (session.mobile && session.roles.includes("branch_head") && !canEditAllLeads(session) && !session.branchId) {
    throw Object.assign(new Error("forbidden: no branch is assigned"), { status: 403 });
  }
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId))).limit(1);
  if (!lead) throw Object.assign(new Error("lead not found"), { status: 404 });
  if (isBranchScoped(session)) {
    if (lead.branchId === session.branchId) return lead;
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
  if (isBranchScoped(session)) return lead.branchId === session.branchId ? lead : null;
  if (canViewAllLeads(session) || lead.ownerId === session.userId) return lead;
  return null;
}
