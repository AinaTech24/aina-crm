/**
 * Who may see which task.
 *
 *   - Their own tasks — assigned to them, created by them, or with a sub-task
 *     delegated to them — always (unchanged).
 *   - With `task.view.all`, also every other task whose client / lead is one
 *     they may see. A task reaches its client through TWO links
 *     (`taskInvestor` / `taskLead`, CLAUDE.md) and both are read. An owner who
 *     limited someone to "their own clients" means the task list too.
 *   - A viewer with no client (or lead) capability at all keeps the old
 *     task-only rule for that link — tasks are visible without a client
 *     capability, and `investorScopeSql` would refuse them outright.
 *
 * `taskClientVisibleSql` says whether the task's client may be NAMED to the
 * viewer — a task assigned to me about a colleague's client shows the title it
 * carries and nothing of the client.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { taskInvestor, taskLead } from "@/lib/dashboard/my/window";

export function canViewAllTasks(session: SessionUser) {
  return can(session.roles, "task.view.all", session.permissions);
}

function own(session: SessionUser, alias: string): SQL {
  const c = (x: string) => sql.raw(`${alias}.${x}`);
  return sql`(${c("assignee_id")} = ${session.userId}::uuid OR ${c("created_by_id")} = ${session.userId}::uuid
    OR ${c("meta")}->'checklist' @> ${JSON.stringify([{ assigneeId: session.userId }])}::jsonb)`;
}

/** The task's client is visible to the viewer (or it has none). */
export async function taskClientVisibleSql(tx: any, session: SessionUser, alias = "t"): Promise<SQL> {
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  if (!(cap("investor.view.all") || cap("investor.view.assigned"))) return sql`TRUE`;
  const invScope = await investorScopeSql(tx, session, "ts_i");
  const inv = taskInvestor(alias);
  return sql`(${inv} IS NULL OR EXISTS (SELECT 1 FROM investors ts_i WHERE ts_i.id = ${inv} AND ${invScope}))`;
}

/** The task's lead is visible to the viewer (or it has none). */
export function taskLeadVisibleSql(session: SessionUser, alias = "t"): SQL {
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  if (!(cap("lead.view.all") || cap("lead.view.assigned"))) return sql`TRUE`;
  const lead = taskLead(alias);
  return sql`(${lead} IS NULL OR EXISTS (SELECT 1 FROM leads ts_l WHERE ts_l.id = ${lead} AND ${leadScopeSql(session, "ts_l")}))`;
}

/** Own tasks, or a task whose client and lead are both in the viewer's scope. */
export async function taskInScopeSql(tx: any, session: SessionUser, alias = "t"): Promise<SQL> {
  return sql`(${own(session, alias)} OR (${await taskClientVisibleSql(tx, session, alias)} AND ${taskLeadVisibleSql(session, alias)}))`;
}

/** Row filter for a task LIST: `task.view.all` → in scope; otherwise own only. */
export async function taskScopeSql(tx: any, session: SessionUser, alias = "t"): Promise<SQL> {
  return canViewAllTasks(session) ? taskInScopeSql(tx, session, alias) : own(session, alias);
}

/**
 * For by-id routes: is the task in scope (own, or its client / lead visible)?
 * The caller keeps its own view.all / edit.all checks; this only adds the
 * client wall on top. False → 404.
 */
export async function taskInScope(tx: any, session: SessionUser, id: string): Promise<boolean> {
  const scope = await taskInScopeSql(tx, session, "t");
  const r = await tx.execute(sql`
    SELECT 1 FROM tasks t WHERE t.id = ${id}::uuid AND t.tenant_id = ${session.tenantId}::uuid AND ${scope} LIMIT 1
  `);
  return r.rows.length > 0;
}
