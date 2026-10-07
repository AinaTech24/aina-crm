/**
 * Viewer scope for client-linked money records — transactions, SIPs, SIP
 * rejections, business entries, expected inflows. A row is visible only when
 * its CLIENT is visible (lib/investors/access.ts decides that, including the
 * "Customize access permissions → View assigned only" allow-list).
 *
 * The shared helpers throw 403 for a viewer with no client capability at all.
 * These screens have their own gates (transactions.view, reports.business …),
 * so such a viewer is not refused here; they are narrowed to clients assigned
 * to them instead, which is what the screens' hand-rolled own-book slices did.
 */

import { sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import { investorScopeCondition, investorScopeSql } from "@/lib/investors/access";
import type { SessionUser } from "@/lib/auth/session";

export function canViewClients(session: SessionUser): boolean {
  return (
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "investor.view.assigned", session.permissions)
  );
}

/** No client slice applies to this viewer (owner, firm-wide viewer, or the firm's wall is off). */
export async function seesEveryClient(tx: any, session: SessionUser): Promise<boolean> {
  return canViewClients(session) && (await investorScopeCondition(tx, session)) === undefined;
}

/**
 * Predicate over an `investors` alias already in the query (`TRUE` when
 * unrestricted). Only ever narrows — AND it onto the caller's own conditions.
 */
export async function visibleClientSql(tx: any, session: SessionUser, alias = "investors"): Promise<SQL> {
  if (!canViewClients(session)) return sql`${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid`;
  return investorScopeSql(tx, session, alias);
}

/**
 * Same rule for a query that does not join investors: `<investorIdCol>` must
 * name a client this viewer may see. `TRUE` for an unrestricted viewer, so a
 * firm-wide aggregate keeps its plan (and its client-less rows) unchanged.
 */
export async function visibleClientExists(tx: any, session: SessionUser, investorIdCol: unknown): Promise<SQL> {
  if (await seesEveryClient(tx, session)) return sql`TRUE`;
  const scope = await visibleClientSql(tx, session, "vc_i");
  return sql`EXISTS (SELECT 1 FROM investors vc_i WHERE vc_i.id = ${investorIdCol} AND ${scope})`;
}

/**
 * One record's client: may this viewer see it? (detail / write routes → 404
 * when not). An unrestricted viewer may, even for a record with no client.
 */
export async function isClientVisible(tx: any, session: SessionUser, investorId: string | null | undefined): Promise<boolean> {
  if (await seesEveryClient(tx, session)) return true;
  if (!investorId) return false;
  const scope = await visibleClientSql(tx, session, "vc_i");
  const r = await tx.execute(sql`SELECT 1 FROM investors vc_i WHERE vc_i.id = ${investorId}::uuid AND ${scope} LIMIT 1`);
  return r.rows.length > 0;
}

/**
 * For records that are also the viewer's own work (a business entry they
 * booked): visible when the viewer owns it OR its client is visible.
 */
export async function visibleClientOrOwnSql(tx: any, session: SessionUser, investorIdCol: unknown, ownerCol: unknown): Promise<SQL> {
  if (await seesEveryClient(tx, session)) return sql`TRUE`;
  return sql`(${ownerCol} = ${session.userId}::uuid OR ${await visibleClientExists(tx, session, investorIdCol)})`;
}
