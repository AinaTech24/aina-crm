/**
 * Who may read which message in the Communications inbox / outbox and the
 * per-person conversation threads.
 *
 *   - Oversight viewers (`investor.view.all`, `compliance.view`,
 *     `reports.business`) see the firm's messages — narrowed by the shared
 *     client / lead scope, so a branch head reads their branch's clients and an
 *     owner-restricted ("own clients only") user never reaches someone else's
 *     book. A message they sent themselves is always theirs.
 *   - Everyone else: messages they sent, or tied to a client they manage
 *     (`investors.rm_id`) or a lead they own — unchanged.
 *
 * A viewer with no client (or lead) capability keeps the old oversight rule for
 * that link: the shared helpers would refuse them outright.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dataWallApplies, investorScopeSql, loadViewableInvestor } from "@/lib/investors/access";
import { leadScopeSql, loadViewableLead } from "@/lib/leads/access";

export function commsSeesAll(session: SessionUser) {
  return (
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "compliance.view", session.permissions) ||
    can(session.roles, "reports.business", session.permissions)
  );
}

/** May this session open the Communications surfaces at all? (page gate) */
export function canViewComms(session: SessionUser) {
  return commsSeesAll(session) || can(session.roles, "communication.send", session.permissions);
}

/** Row filter for `communications <alias>`. */
export async function commsScopeSql(tx: any, session: SessionUser, alias = "communications"): Promise<SQL> {
  const c = (x: string) => sql.raw(`${alias}.${x}`);
  const me = session.userId;
  if (!commsSeesAll(session)) {
    return sql`(${c("user_id")} = ${me}::uuid
      OR ${c("investor_id")} IN (SELECT id FROM investors WHERE rm_id = ${me}::uuid)
      OR ${c("lead_id")} IN (SELECT id FROM leads WHERE owner_id = ${me}::uuid))`;
  }
  const cap = (x: Parameters<typeof can>[1]) => can(session.roles, x, session.permissions);
  const invScope = cap("investor.view.all") || cap("investor.view.assigned")
    ? await investorScopeSql(tx, session, "cs_i") : sql`TRUE`;
  const leadScope = cap("lead.view.all") || cap("lead.view.assigned")
    ? leadScopeSql(session, "cs_l") : sql`TRUE`;
  return sql`(${c("user_id")} = ${me}::uuid OR (
    (${c("investor_id")} IS NULL OR EXISTS (SELECT 1 FROM investors cs_i WHERE cs_i.id = ${c("investor_id")} AND ${invScope}))
    AND (${c("lead_id")} IS NULL OR EXISTS (SELECT 1 FROM leads cs_l WHERE cs_l.id = ${c("lead_id")} AND ${leadScope}))
  ))`;
}

/**
 * A per-person conversation thread (WhatsApp / email) — readable and sendable
 * only for a client or lead the caller may see, and only by someone who may
 * use the Communications surfaces. Throws 403 / 404 (never confirms the record
 * exists). Only under the data wall (`dataWallApplies`); without it the
 * threads are open as they always were.
 */
export async function assertThreadAccess(
  tx: any,
  session: SessionUser,
  type: "investor" | "lead",
  id: string,
): Promise<void> {
  if (!(await dataWallApplies(tx, session))) return;
  if (!canViewComms(session)) throw Object.assign(new Error("forbidden: missing communication access"), { status: 403 });
  const found = type === "investor"
    ? await loadViewableInvestor(tx, session, id)
    : await loadViewableLead(tx, session, id);
  if (!found) throw Object.assign(new Error(type === "investor" ? "Client not found" : "Lead not found"), { status: 404 });
}
