import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import type { MetricScope } from "@/lib/metrics";
import { collaboratorSql, worksOnSql } from "@/lib/tasks/collaborators-sql";
export function mobileFirmAccess(s: SessionUser) { return s.roles.some(r => ["owner", "ops", "back_office"].includes(r)); }
export function mobileActivityScope(s: SessionUser, alias = "a") {
  if (mobileFirmAccess(s)) return sql`TRUE`;
  if (s.roles.includes("branch_head")) return s.branchId ? sql`${sql.raw(`${alias}.branch_id`)} = ${s.branchId}::uuid` : sql`FALSE`;
  return sql`${sql.raw(`${alias}.owner_user_id`)} = ${s.userId}::uuid`;
}

export function mobileOwnerScope(s: SessionUser, ownerColumn: string) {
  if (mobileFirmAccess(s)) return sql`TRUE`;
  if (s.roles.includes("branch_head")) return s.branchId ? sql`${sql.raw(ownerColumn)} IN
    (SELECT id FROM users WHERE tenant_id = ${s.tenantId}::uuid AND branch_id = ${s.branchId}::uuid)` : sql`FALSE`;
  return sql`${sql.raw(ownerColumn)} = ${s.userId}::uuid`;
}

export function mobileTaskScope(s: SessionUser, alias = "tasks") {
  if (mobileFirmAccess(s)) return sql`TRUE`;
  if (s.roles.includes("branch_head")) {
    const branch = mobileOwnerScope(s, `${alias}.assignee_id`);
    // A branch head with no branch still sees nothing (never a silent widening).
    return s.branchId ? sql`(${branch} OR ${collaboratorSql(s.userId, alias)})` : branch;
  }
  return sql`(${worksOnSql(s.userId, alias)} OR ${sql.raw(`${alias}.created_by_id`)} = ${s.userId}::uuid
    OR ${sql.raw(`${alias}.meta`)}->'checklist' @> ${JSON.stringify([{ assigneeId: s.userId }])}::jsonb)`;
}

/**
 * The app's viewer scope as a lib/metrics MetricScope — firm (owner / ops /
 * back office), the branch (a branch head: clients of the branch, work of its
 * people) or the viewer's own book — so the app's figures are the dashboards'.
 */
export function mobileMetricScope(s: SessionUser): MetricScope {
  if (mobileFirmAccess(s)) return { tenantId: s.tenantId };
  if (s.roles.includes("branch_head")) return s.branchId ? { tenantId: s.tenantId, branchIds: [s.branchId] } : { tenantId: s.tenantId, rmIds: [s.userId] };
  return { tenantId: s.tenantId, rmIds: [s.userId] };
}

/**
 * Meetings the viewer's scope covers: the RM's own, AND the ones a team member
 * in scope attends (the CRM's rule of 2026-10-01 — an attendee sees the
 * meeting in their meetings, calendar and day). `alias` is review_meetings.
 */
export function mobileMeetingScope(s: SessionUser, alias = "m") {
  const rm = sql.raw(`${alias}.rm_id`);
  const att = sql.raw(`COALESCE(${alias}.attendees, '[]'::jsonb)`);
  if (mobileFirmAccess(s)) return sql`TRUE`;
  if (s.roles.includes("branch_head")) {
    if (!s.branchId) return sql`FALSE`;
    const branchUsers = sql`SELECT id FROM users WHERE tenant_id = ${s.tenantId}::uuid AND branch_id = ${s.branchId}::uuid`;
    return sql`(${rm} IN (${branchUsers}) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(${att}) a
       WHERE a->>'kind' = 'user' AND a->>'refId' IN (SELECT id::text FROM users WHERE tenant_id = ${s.tenantId}::uuid AND branch_id = ${s.branchId}::uuid)))`;
  }
  return sql`(${rm} = ${s.userId}::uuid OR ${att} @> ${JSON.stringify([{ kind: "user", refId: s.userId }])}::jsonb)`;
}
