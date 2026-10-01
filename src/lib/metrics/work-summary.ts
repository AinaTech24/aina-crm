/**
 * Task counts for a period, split financial / non-financial, and SIP
 * rejections by recovery status.
 *
 * TASKS are STAFF facts (they follow the assignee). "Total" is the tasks
 * CREATED in the period; each is then in exactly one state today:
 *
 *   Completed        status completed
 *   Awaiting input   blocked, or waiting for an approver (approval_status
 *                    'pending'). The CRM has no "awaiting input" status; these
 *                    are the two ways a task records that it cannot move until
 *                    someone else acts.
 *   Pending          open or in progress, and not awaiting input
 *   Cancelled        status cancelled — counted in Total, shown on its own
 *
 * Financial = tasks.type in FINANCIAL_TASK_TYPES — the RM desk's and the
 * Branch Head Dashboard's split (lib/dashboard/my/window.ts explains why the
 * list names the financial side). Everything else is non-financial.
 *
 * SIP REJECTIONS are CLIENT facts (the rejected client's RM and branch),
 * dated by the rejection date. The sheet's three statuses map onto the
 * register's seven:
 *
 *   Contacted          client_contacted
 *   Repurchase done    reprocessed, recovered
 *   Pending            pending, bank_issue, mandate_issue
 *   Not recoverable    not_recoverable (its own row — closed, not recovered)
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { FINANCIAL_TASK_TYPES } from "@/lib/dashboard/my/window";
import { clientRecordWhere, staffWhere, type MetricPeriod, type MetricScope } from "./scope";

const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x.replace(/'/g, "")}'`).join(", "));

export type TaskStateCounts = { total: number; pending: number; completed: number; awaiting: number; cancelled: number };
export type TaskSummary = { financial: TaskStateCounts; nonFinancial: TaskStateCounts; all: TaskStateCounts };

/** "Awaiting input": blocked, or waiting for an approver. Exported so the
 *  Tasks list's `state=awaiting` drill-down opens exactly these rows. */
export function taskAwaitingSql(alias = "t") {
  const c = (n: string) => sql.raw(`${alias}.${n}`);
  return sql`(${c("status")} = 'blocked' OR (COALESCE(${c("approval_status")}, '') = 'pending' AND ${c("status")} NOT IN ('completed', 'cancelled')))`;
}
const awaitingSql = taskAwaitingSql("t");

export async function getTaskSummary(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<TaskSummary> {
  const rows = (await tx.execute(sql`
    SELECT (t.type IN (${inList(FINANCIAL_TASK_TYPES)})) AS fin,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE t.status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled,
           COUNT(*) FILTER (WHERE ${awaitingSql})::int AS awaiting,
           COUNT(*) FILTER (WHERE t.status IN ('open', 'in_progress') AND NOT ${awaitingSql})::int AS pending
      FROM tasks t
     WHERE t.tenant_id = ${scope.tenantId}::uuid AND t.deleted_at IS NULL
       AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${p.from}::date AND ${p.to}::date
       AND ${staffWhere(scope, sql`t.assignee_id`)}
     GROUP BY 1
  `)).rows as Array<{ fin: boolean | null; total: number; completed: number; cancelled: number; awaiting: number; pending: number }>;
  const pick = (fin: boolean): TaskStateCounts => {
    const r = rows.filter((x) => !!x.fin === fin);
    const sum = (k: keyof TaskStateCounts) => r.reduce((s, x) => s + Number(x[k]), 0);
    return { total: sum("total"), pending: sum("pending"), completed: sum("completed"), awaiting: sum("awaiting"), cancelled: sum("cancelled") };
  };
  const financial = pick(true);
  const nonFinancial = pick(false);
  const add = (a: TaskStateCounts, b: TaskStateCounts): TaskStateCounts => ({
    total: a.total + b.total, pending: a.pending + b.pending, completed: a.completed + b.completed,
    awaiting: a.awaiting + b.awaiting, cancelled: a.cancelled + b.cancelled,
  });
  return { financial, nonFinancial, all: add(financial, nonFinancial) };
}

export const SIP_REJECTION_GROUPS = [
  { key: "pending", label: "Pending", statuses: ["pending", "bank_issue", "mandate_issue"] },
  { key: "contacted", label: "Contacted", statuses: ["client_contacted"] },
  { key: "repurchased", label: "Repurchase done", statuses: ["reprocessed", "recovered"] },
  { key: "lost", label: "Not recoverable", statuses: ["not_recoverable"] },
] as const;

export type SipRejectionRow = { key: string; label: string; count: number; amount: number };
export type SipRejectionSummary = { count: number; amount: number; rows: SipRejectionRow[] };

export async function getSipRejectionSummary(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<SipRejectionSummary> {
  const groupSql = sql.raw(`CASE ${SIP_REJECTION_GROUPS.map((g) =>
    `WHEN r.recovery_status IN (${g.statuses.map((s) => `'${s}'`).join(", ")}) THEN '${g.key}'`).join(" ")} ELSE 'pending' END`);
  const rows = (await tx.execute(sql`
    SELECT ${groupSql} AS grp, COUNT(*)::int AS n, COALESCE(SUM(r.rejection_amount), 0) AS amt
      FROM sip_rejections r JOIN investors i ON i.id = r.investor_id
     WHERE r.tenant_id = ${scope.tenantId}::uuid
       AND r.rejection_date BETWEEN ${p.from}::date AND ${p.to}::date
       AND ${clientRecordWhere(scope, "i")}
     GROUP BY 1
  `)).rows as Array<{ grp: string; n: number; amt: string }>;
  const out = SIP_REJECTION_GROUPS.map((g) => {
    const r = rows.find((x) => x.grp === g.key);
    return { key: g.key, label: g.label, count: Number(r?.n ?? 0), amount: Number(r?.amt ?? 0) };
  });
  return { count: out.reduce((s, r) => s + r.count, 0), amount: out.reduce((s, r) => s + r.amount, 0), rows: out };
}
