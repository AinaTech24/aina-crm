/**
 * A person's team on the dashboards: everyone who reports to them, directly
 * or further down the line (`users.reporting_manager_id`, set in Team →
 * Employees). SERVER-ONLY.
 *
 * Someone who would otherwise see only their own book (an RM, a team member)
 * sees their team's instead when anyone reports to them, and can narrow to
 * one person with the RM filter; someone nobody reports to still sees only
 * their own. It never widens past the reporting line: a peer's book is never
 * in it.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { dataAccessFor, type DataAccess } from "./system/access";

export type TeamMember = { id: string; name: string };

/** Everyone under this user in the reporting line, not deleted, by name. */
export async function reportsOf(tx: Tx, tenantId: string, userId: string): Promise<TeamMember[]> {
  const rows = (await tx.execute(sql`
    WITH RECURSIVE team AS (
      SELECT u.id FROM users u
       WHERE u.tenant_id = ${tenantId}::uuid AND u.reporting_manager_id = ${userId}::uuid AND u.deleted_at IS NULL
      UNION
      SELECT u.id FROM users u JOIN team t ON u.reporting_manager_id = t.id
       WHERE u.tenant_id = ${tenantId}::uuid AND u.deleted_at IS NULL
    )
    SELECT u.id::text AS id, u.name
      FROM users u JOIN team t ON t.id = u.id
     WHERE u.id <> ${userId}::uuid
     ORDER BY u.name
  `)).rows as Array<{ id: string; name: string | null }>;
  // "Pooja Shah (RM)" → "Pooja Shah": the role is not part of the name.
  return rows.map((r) => ({ id: r.id, name: (r.name ?? "—").replace(/\s*\([^)]*\)\s*$/, "").trim() || "—" }));
}

/**
 * The viewer's record access on a dashboard, with their team: `self` becomes
 * `team` when anyone reports to them. Firm and branch viewers already see
 * more than their team.
 */
export async function resolveDataAccess(tx: Tx, session: SessionUser): Promise<DataAccess> {
  const base = dataAccessFor(session);
  if (base.kind !== "self") return base;
  const reports = await reportsOf(tx, session.tenantId, session.userId);
  return reports.length
    ? { kind: "team", userId: session.userId, memberIds: [session.userId, ...reports.map((r) => r.id)] }
    : base;
}
