/**
 * Who may see which service request (and complaint — a complaint is a service
 * request of type 'complaint').
 *
 * A ticket is visible when ANY of these holds:
 *   - it is assigned / escalated to the viewer (their work, whoever the client);
 *   - it is about a client the viewer may see (`investorScopeSql` — own book,
 *     branch, or the firm, by the client-access rule and the firm switch);
 *   - it has no client and the viewer holds `service_request.view.all`
 *     (or, for a complaint, `complaint.manage`).
 *
 * `service_request.view.all` alone no longer opens a ticket about a client
 * outside the viewer's book: an owner who limited someone to "their own
 * clients" means every module. A ticket that is visible only because it is
 * assigned to the viewer must not print the client's details — use
 * `srClientVisibleSql` to mask them.
 *
 * All of it only under the data wall (`dataWallApplies`). Without it (the
 * owner; a shared-book firm and a user who was not customised) every ticket
 * is visible with its client, as the pages and API always showed them.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { clientScopeNarrows, dataWallApplies, investorScopeSql } from "@/lib/investors/access";

export function canViewAllServiceRequests(session: SessionUser) {
  return can(session.roles, "service_request.view.all", session.permissions);
}

function hasInvestorView(session: SessionUser) {
  return (
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "investor.view.assigned", session.permissions)
  );
}

/** Client scope over an investors alias, or FALSE for a viewer with no client access. */
export async function srClientScopeSql(tx: any, session: SessionUser, investorAlias = "i"): Promise<SQL> {
  return hasInvestorView(session) ? investorScopeSql(tx, session, investorAlias) : sql`FALSE`;
}

/**
 * Row filter for `service_requests <srAlias>`. Correlates on the ticket's
 * investor with its own sub-select, so callers need not join investors.
 */
export async function serviceRequestScopeSql(tx: any, session: SessionUser, srAlias = "sr"): Promise<SQL> {
  if (!(await dataWallApplies(tx, session))) return sql`TRUE`;
  const a = (c: string) => sql.raw(`${srAlias}.${c}`);
  // A firm-wide client viewer reaches every linked ticket, even one whose
  // client was since deleted.
  const linked = hasInvestorView(session) && !(await clientScopeNarrows(tx, session))
    ? sql`${a("investor_id")} IS NOT NULL`
    : sql`(${a("investor_id")} IS NOT NULL AND EXISTS (
          SELECT 1 FROM investors sr_scope_i
           WHERE sr_scope_i.id = ${a("investor_id")} AND ${await srClientScopeSql(tx, session, "sr_scope_i")}))`;
  const allUnlinked = canViewAllServiceRequests(session) ? sql`TRUE` : sql`FALSE`;
  const complaintsUnlinked = can(session.roles, "complaint.manage", session.permissions)
    ? sql`${a("type")} = 'complaint'` : sql`FALSE`;
  return sql`(
    ${a("assigned_to_user_id")} = ${session.userId}::uuid
    OR ${a("escalated_to_user_id")} = ${session.userId}::uuid
    OR ${linked}
    OR (${a("investor_id")} IS NULL AND (${allUnlinked} OR ${complaintsUnlinked}))
  )`;
}

/** TRUE when the ticket's client (if any) is one the viewer may see — mask client fields otherwise. */
export async function srClientVisibleSql(tx: any, session: SessionUser, srAlias = "sr"): Promise<SQL> {
  if (!(await clientScopeNarrows(tx, session))) return sql`TRUE`;
  const clientScope = await srClientScopeSql(tx, session, "sr_vis_i");
  return sql`(${sql.raw(`${srAlias}.investor_id`)} IS NULL OR EXISTS (
    SELECT 1 FROM investors sr_vis_i WHERE sr_vis_i.id = ${sql.raw(`${srAlias}.investor_id`)} AND ${clientScope}))`;
}

/** Can this session see the one ticket? (for by-id routes; 404 when false) */
export async function canSeeServiceRequest(tx: any, session: SessionUser, id: string): Promise<boolean> {
  const scope = await serviceRequestScopeSql(tx, session, "sr");
  const r = await tx.execute(sql`
    SELECT 1 FROM service_requests sr
     WHERE sr.id = ${id}::uuid AND sr.tenant_id = ${session.tenantId}::uuid AND ${scope}
     LIMIT 1
  `);
  return r.rows.length > 0;
}
