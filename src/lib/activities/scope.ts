/**
 * Who may see which logged activity (call / visit / note …).
 *
 * The activity log's own rule stays: firm-wide viewers (`dashboard.view.owner`)
 * see everyone's entries, everyone else only what they logged. On top of it,
 * an entry about a client / lead / family is visible only when that record is
 * — an owner who limited someone to their own clients means the log too. The
 * viewer's OWN entries are always theirs.
 *
 * Only under the data wall (`dataWallApplies`). Without it every caller keeps
 * its earlier rule (the web's own-only slice for non-managers, the mobile
 * app's `mobileActivityScope`), so nothing visible before disappears.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { clientScopeNarrows, dataWallApplies, investorScopeSql } from "@/lib/investors/access";
import { mobileFirmAccess } from "@/lib/mobile/access";
import { leadScopeSql } from "@/lib/leads/access";
import { familyScopeSql } from "@/lib/families/access";

/** The activity's subject (client / lead / family) is visible to the viewer. */
export async function activitySubjectVisibleSql(tx: any, session: SessionUser, alias = "a"): Promise<SQL> {
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  const invAllowed = cap("investor.view.all") || cap("investor.view.assigned");
  const leadAllowed = cap("lead.view.all") || cap("lead.view.assigned");
  const famAllowed = invAllowed || cap("family.view");
  if (!(await dataWallApplies(tx, session))) return sql`TRUE`;
  // A viewer the client scope does not narrow keeps entries about a deleted
  // client or family — the EXISTS would drop them.
  const clientsFree = invAllowed && !(await clientScopeNarrows(tx, session));
  const invScope = invAllowed ? await investorScopeSql(tx, session, "as_i") : sql`FALSE`;
  const leadScope = leadAllowed ? leadScopeSql(session, "as_l") : sql`FALSE`;
  const famScope = famAllowed ? await familyScopeSql(tx, session, "as_f") : sql`FALSE`;
  const t = sql.raw(`${alias}.subject_type`);
  const id = sql.raw(`${alias}.subject_id`);
  const inv = clientsFree ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM investors as_i WHERE as_i.id = ${id} AND ${invScope})`;
  const fam = clientsFree ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM families as_f WHERE as_f.id = ${id} AND ${famScope})`;
  return sql`(CASE ${t}
    WHEN 'investor' THEN ${inv}
    WHEN 'lead' THEN EXISTS (SELECT 1 FROM leads as_l WHERE as_l.id = ${id} AND ${leadScope})
    WHEN 'family' THEN ${fam}
    ELSE TRUE END)`;
}

/**
 * Row filter: own entries, or (firm-wide viewers) entries whose subject is
 * visible. Firm-wide = `dashboard.view.owner`, or on the mobile app the roles
 * `mobileActivityScope` already gave the whole firm (ops / back office).
 * `TRUE` when the data wall does not apply — the caller's own rule stands.
 */
export async function activityScopeSql(tx: any, session: SessionUser, alias = "a"): Promise<SQL> {
  if (!(await dataWallApplies(tx, session))) return sql`TRUE`;
  const own = sql`${sql.raw(`${alias}.owner_user_id`)} = ${session.userId}::uuid`;
  const firmWide = can(session.roles, "dashboard.view.owner", session.permissions)
    || (!!session.mobile && mobileFirmAccess(session));
  if (!firmWide) return own;
  return sql`(${own} OR ${await activitySubjectVisibleSql(tx, session, alias)})`;
}
