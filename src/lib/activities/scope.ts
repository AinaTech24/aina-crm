/**
 * Who may see which logged activity (call / visit / note …).
 *
 * The activity log's own rule stays: firm-wide viewers (`dashboard.view.owner`)
 * see everyone's entries, everyone else only what they logged. On top of it,
 * an entry about a client / lead / family is visible only when that record is
 * — an owner who limited someone to their own clients means the log too. The
 * viewer's OWN entries are always theirs.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { familyScopeSql } from "@/lib/families/access";

/** The activity's subject (client / lead / family) is visible to the viewer. */
export async function activitySubjectVisibleSql(tx: any, session: SessionUser, alias = "a"): Promise<SQL> {
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  const invAllowed = cap("investor.view.all") || cap("investor.view.assigned");
  const leadAllowed = cap("lead.view.all") || cap("lead.view.assigned");
  const famAllowed = invAllowed || cap("family.view");
  const invScope = invAllowed ? await investorScopeSql(tx, session, "as_i") : sql`FALSE`;
  const leadScope = leadAllowed ? leadScopeSql(session, "as_l") : sql`FALSE`;
  const famScope = famAllowed ? await familyScopeSql(tx, session, "as_f") : sql`FALSE`;
  const t = sql.raw(`${alias}.subject_type`);
  const id = sql.raw(`${alias}.subject_id`);
  return sql`(CASE ${t}
    WHEN 'investor' THEN EXISTS (SELECT 1 FROM investors as_i WHERE as_i.id = ${id} AND ${invScope})
    WHEN 'lead' THEN EXISTS (SELECT 1 FROM leads as_l WHERE as_l.id = ${id} AND ${leadScope})
    WHEN 'family' THEN EXISTS (SELECT 1 FROM families as_f WHERE as_f.id = ${id} AND ${famScope})
    ELSE TRUE END)`;
}

/** Row filter: own entries, or (firm-wide viewers) entries whose subject is visible. */
export async function activityScopeSql(tx: any, session: SessionUser, alias = "a"): Promise<SQL> {
  const own = sql`${sql.raw(`${alias}.owner_user_id`)} = ${session.userId}::uuid`;
  if (!can(session.roles, "dashboard.view.owner", session.permissions)) return own;
  return sql`(${own} OR ${await activitySubjectVisibleSql(tx, session, alias)})`;
}
