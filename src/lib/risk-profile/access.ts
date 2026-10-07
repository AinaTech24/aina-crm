/**
 * Data scope for risk-profile rows.
 *
 * `risk_profile_responses.investor_id` is polymorphic: it holds a CLIENT id,
 * or a LEAD id for a prospect profiled before conversion. A row is visible
 * when its subject is — a client through lib/investors/access, a lead through
 * lib/leads/access. Someone with neither capability sees nothing.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";

/** SQL condition: the subject id `subjectId` (a column expression) is visible to this session. */
export async function riskSubjectScopeSql(tx: any, session: SessionUser, subjectId: SQL): Promise<SQL> {
  const seesClients =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "investor.view.assigned", session.permissions);
  const seesLeads =
    can(session.roles, "lead.view.all", session.permissions) ||
    can(session.roles, "lead.view.assigned", session.permissions);
  const client = seesClients
    ? sql`EXISTS (SELECT 1 FROM investors rs_i WHERE rs_i.id = ${subjectId} AND ${await investorScopeSql(tx, session, "rs_i")})`
    : sql`FALSE`;
  const lead = seesLeads
    ? sql`EXISTS (SELECT 1 FROM leads rs_l WHERE rs_l.id = ${subjectId} AND ${leadScopeSql(session, "rs_l")})`
    : sql`FALSE`;
  return sql`(${client} OR ${lead})`;
}
