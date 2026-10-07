/**
 * Data scope for financial discoveries (fact-finds).
 *
 * A discovery is ABOUT a lead or a client (`subject_type` / `subject_id`), and
 * it carries that person's whole financial picture. It is visible exactly when
 * its subject is: a client through lib/investors/access, a lead through
 * lib/leads/access. A viewer with neither capability sees none.
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";

const seesClients = (s: SessionUser) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions);
const seesLeads = (s: SessionUser) =>
  can(s.roles, "lead.view.all", s.permissions) || can(s.roles, "lead.view.assigned", s.permissions);

/** SQL condition over a subject (type + id column expressions): visible to this session. */
async function subjectScope(tx: any, session: SessionUser, subjectType: SQL, subjectId: SQL): Promise<SQL> {
  const client = seesClients(session)
    ? sql`(${subjectType} = 'investor' AND EXISTS (
        SELECT 1 FROM investors ds_i WHERE ds_i.id = ${subjectId} AND ds_i.deleted_at IS NULL
           AND ${await investorScopeSql(tx, session, "ds_i")}))`
    : sql`FALSE`;
  const lead = seesLeads(session)
    ? sql`(${subjectType} = 'lead' AND EXISTS (
        SELECT 1 FROM leads ds_l WHERE ds_l.id = ${subjectId} AND ${leadScopeSql(session, "ds_l")}))`
    : sql`FALSE`;
  return sql`(${client} OR ${lead})`;
}

/** Condition for a query over `financial_discoveries` (Drizzle table columns). */
export async function discoveryScopeCondition(tx: any, session: SessionUser): Promise<SQL> {
  return subjectScope(tx, session, sql`${financialDiscoveries.subjectType}`, sql`${financialDiscoveries.subjectId}`);
}

/** May this session start / see a discovery about this lead or client? */
export async function canSeeDiscoverySubject(
  tx: any, session: SessionUser, subjectType: "lead" | "investor", subjectId: string,
): Promise<boolean> {
  const scope = await subjectScope(tx, session, sql`${subjectType}::text`, sql`${subjectId}::uuid`);
  const r = await tx.execute(sql`SELECT ${scope} AS ok`);
  return (r.rows[0] as { ok?: boolean } | undefined)?.ok === true;
}

/** One discovery when this session may see it, else null (→ 404). */
export async function loadViewableDiscovery(tx: any, session: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const scope = await discoveryScopeCondition(tx, session);
  const [row] = await tx
    .select()
    .from(financialDiscoveries)
    .where(and(eq(financialDiscoveries.id, id), eq(financialDiscoveries.tenantId, session.tenantId), scope))
    .limit(1);
  return (row ?? null) as typeof financialDiscoveries.$inferSelect | null;
}
