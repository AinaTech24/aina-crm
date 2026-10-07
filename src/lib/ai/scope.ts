/**
 * The AI assistant answers only from data its user may see. Every figure the
 * model receives (the firm snapshot in its system prompt, each tool's rows) is
 * computed under the viewer's own access: their client book, leads, tasks and
 * meetings — the same rules as the list pages (`investorScopeSql`,
 * `leadScopeSql`, lib/tasks/scope, lib/review-meetings/scope). Scoping the
 * inputs is what scopes the AI: the model never queries anything itself.
 *
 * Without a session (a legacy caller) every fragment is TRUE — the old
 * firm-wide behaviour — so nothing that does not pass one changes.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql, canViewAllInvestors } from "@/lib/investors/access";
import { isBranchScoped, leadScopeSql } from "@/lib/leads/access";
import { taskScopeSql } from "@/lib/tasks/scope";
import { meetingScopeSql } from "@/lib/review-meetings/scope";

export type AiScope = {
  /** investors visible, for the table aliased `investors` (unaliased) or `i`. */
  inv: (alias: "investors" | "i") => SQL;
  /** the client id in `col` is visible (sips / policies / business entries …). */
  clientOf: (col: string) => SQL;
  /** leads visible, for `leads` (unaliased). */
  leads: SQL;
  /** tasks visible, for `tasks` (unaliased) or `t`. */
  task: (alias: "tasks" | "t") => SQL;
  /** meetings visible, for `review_meetings` (unaliased) or `m`. */
  meeting: (alias: "review_meetings" | "m") => SQL;
  /** Sees the whole firm's book (firm history / per-RM tables are meaningful). */
  firmWide: boolean;
};

const TRUE = sql`TRUE`;

export async function buildAiScope(tx: any, session?: SessionUser): Promise<AiScope> {
  if (!session) {
    return { inv: () => TRUE, clientOf: () => TRUE, leads: TRUE, task: () => TRUE, meeting: () => TRUE, firmWide: true };
  }
  const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
  const invAllowed = cap("investor.view.all") || cap("investor.view.assigned");
  const invAlias = {
    investors: invAllowed ? await investorScopeSql(tx, session, "investors") : sql`FALSE`,
    i: invAllowed ? await investorScopeSql(tx, session, "i") : sql`FALSE`,
  };
  const clientScope = invAllowed ? await investorScopeSql(tx, session, "ais_i") : sql`FALSE`;
  const leads = cap("lead.view.all") || cap("lead.view.assigned") ? leadScopeSql(session, "leads") : sql`FALSE`;
  const taskCaps = cap("task.view.all") || cap("task.view.assigned");
  const taskAlias = {
    tasks: taskCaps ? await taskScopeSql(tx, session, "tasks") : sql`tasks.assignee_id = ${session.userId}::uuid`,
    t: taskCaps ? await taskScopeSql(tx, session, "t") : sql`t.assignee_id = ${session.userId}::uuid`,
  };
  const meetingAlias = {
    review_meetings: await meetingScopeSql(tx, session, "review_meetings"),
    m: await meetingScopeSql(tx, session, "m"),
  };
  return {
    inv: (a) => invAlias[a],
    clientOf: (col) => sql`EXISTS (SELECT 1 FROM investors ais_i WHERE ais_i.id = ${sql.raw(col)} AND ${clientScope})`,
    leads,
    task: (a) => taskAlias[a],
    meeting: (a) => meetingAlias[a],
    firmWide: invAllowed && canViewAllInvestors(session) && !isBranchScoped(session) && !session.mobile,
  };
}
