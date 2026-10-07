/**
 * Who may see which goals. A goal is about a client, so it is visible only when
 * its client is: the shared client scope (`lib/investors/access.ts` — the firm
 * switch, a customised "assigned only" permission list, the branch lock) AND
 * the goals module's long-standing rule that a viewer without
 * `investor.view.all` sees only the clients assigned to them. Both are kept so
 * that applying the shared scope never widens what this module already hid.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { goals, investors } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dataWallApplies, investorScopeSql, loadViewableInvestor } from "@/lib/investors/access";

/** SQL condition over an `investors` alias: this client's goals are visible. */
export async function goalClientScopeSql(tx: any, session: SessionUser, alias = "i") {
  const scope = await investorScopeSql(tx, session, alias);
  const own = can(session.roles, "investor.view.all", session.permissions)
    ? sql`TRUE`
    : sql`${sql.raw(`${alias}.rm_id`)} = ${session.userId}::uuid`;
  return sql`(${scope} AND ${own})`;
}

/** Sub-select of the live client ids whose goals this session may see. */
export async function visibleGoalInvestorIdsSql(tx: any, session: SessionUser) {
  const scope = await goalClientScopeSql(tx, session, "i");
  return sql`(SELECT i.id FROM investors i WHERE i.deleted_at IS NULL AND ${scope})`;
}

/**
 * One goal + its client, or null when either is missing or out of scope.
 * The client scope and the own-clients rule apply only under the data wall
 * (`dataWallApplies`); without it the goal opens as it always did. A viewer
 * with no client capability gets null (→ 404), never a thrown 403.
 */
export async function loadViewableGoal(tx: Tx, session: SessionUser, id: string) {
  const [goal] = await tx
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId)))
    .limit(1);
  if (!goal) return null;
  if (!(await dataWallApplies(tx, session))) {
    const [investor] = await tx.select().from(investors).where(eq(investors.id, goal.investorId)).limit(1);
    return { goal, investor };
  }
  if (!can(session.roles, "investor.view.all", session.permissions) && !can(session.roles, "investor.view.assigned", session.permissions)) return null;
  const investor = await loadViewableInvestor(tx, session, goal.investorId);
  if (!investor) return null;
  if (!can(session.roles, "investor.view.all", session.permissions) && investor.rmId !== session.userId) return null;
  return { goal, investor };
}
