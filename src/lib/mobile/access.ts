import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
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
  if (mobileFirmAccess(s) || s.roles.includes("branch_head")) return mobileOwnerScope(s, `${alias}.assignee_id`);
  return sql`(${sql.raw(`${alias}.assignee_id`)} = ${s.userId}::uuid OR ${sql.raw(`${alias}.created_by_id`)} = ${s.userId}::uuid
    OR ${sql.raw(`${alias}.meta`)}->'checklist' @> ${JSON.stringify([{ assigneeId: s.userId }])}::jsonb)`;
}
