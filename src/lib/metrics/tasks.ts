/**
 * Overdue tasks — ONE definition for the sidebar badge, the dashboard, the
 * team table and the Tasks page's "Overdue" view:
 *
 *   not deleted, still to do (open / in progress / blocked), due before now.
 *
 * `completed` is the finished status; there is no `done`, and filtering on
 * one silently counts every finished task as still open.
 *
 * Tasks are STAFF facts: they follow the assignee, not the client.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { col, staffWhere, type MetricScope } from "./scope";

export const TASK_OPEN = ["open", "in_progress", "blocked"] as const;
export const TASK_DEAD = ["completed", "cancelled"] as const;

/** An overdue task, over a tasks alias. */
export function overdueTaskSql(alias = "t"): SQL {
  return sql`${col(alias, "deleted_at")} IS NULL
    AND ${col(alias, "status")} IN ('open', 'in_progress', 'blocked')
    AND ${col(alias, "due_at")} < now()`;
}

/**
 * Overdue tasks for one person (`{ tenantId, userId }` — the sidebar badge) or
 * for everyone the scope covers (`MetricScope` — the dashboard).
 */
export async function getOverdueTasks(
  tx: Tx, who: { tenantId: string; userId: string } | MetricScope,
): Promise<number> {
  const person = "userId" in who ? who.userId : null;
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM tasks t
     WHERE t.tenant_id = ${who.tenantId}::uuid AND ${overdueTaskSql("t")}
       AND ${person ? sql`t.assignee_id = ${person}::uuid` : staffWhere(who as MetricScope, sql`t.assignee_id`)}
  `)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/** Overdue tasks per assignee in scope. Key null = unassigned. */
export async function getOverdueTasksByAssignee(tx: Tx, scope: MetricScope): Promise<Map<string | null, number>> {
  const rows = (await tx.execute(sql`
    SELECT t.assignee_id, COUNT(*)::int AS n FROM tasks t
     WHERE t.tenant_id = ${scope.tenantId}::uuid AND ${overdueTaskSql("t")}
       AND ${staffWhere(scope, sql`t.assignee_id`)}
     GROUP BY t.assignee_id
  `)).rows as Array<{ assignee_id: string | null; n: number }>;
  return new Map(rows.map((r) => [r.assignee_id, Number(r.n)]));
}
