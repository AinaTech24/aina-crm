/**
 * The requests behind an Operations Dashboard figure — the list a tile opens.
 *
 * The tiles used to link to a "#queue" section of the dashboard itself. That
 * section is gone, so a click reloaded the same dashboard and nothing showed.
 * A tile now opens /dashboard/operations/requests?view=… with the dashboard's
 * filters in force: the SAME `opsBase` + `opsFilter` the counts run over,
 * narrowed by the view's condition below, so the list's row count is the
 * tile's number. The day views are the exact conditions of `loadDayCounts`
 * (queue.ts) and the period views those of `loadCommandStrip`, which read them
 * from here — one definition each.
 *
 * Everything finer (SLA breached, documentation, unassigned, a request type)
 * is a filter param the URL carries (`sla`, `kind`, `exec` …), read by
 * `opsFilter` like any dashboard filter.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { istDay, opsBase, opsFilter, type OpsWindow } from "./window";

/** Received before `day`, and still open then (open now, or closed on/after it). */
export const openAtStartOf = (day: string): SQL => sql`(received_day < ${day}::date
  AND (status NOT IN ('completed', 'cancelled')
       OR ${istDay(sql`COALESCE(completed_at, updated_at)`)} >= ${day}::date))`;

const dueBy = (op: "=" | "<=", day: string): SQL =>
  sql`(is_open AND ((due_at IS NOT NULL AND ${istDay(sql`due_at`)} ${sql.raw(op)} ${day}::date)
       OR (sla_due_at IS NOT NULL AND ${istDay(sql`sla_due_at`)} ${sql.raw(op)} ${day}::date)))`;

export const OPS_LIST_VIEWS = {
  open: { label: "Pending requests", cond: () => sql`is_open` },
  carry: { label: "Carried forward from yesterday", cond: (w: OpsWindow) => openAtStartOf(w.today) },
  received_today: { label: "New requests today", cond: (w: OpsWindow) => sql`received_day = ${w.today}::date` },
  completed_today: {
    label: "Completed today",
    cond: (w: OpsWindow) => sql`(status = 'completed' AND completed_day = ${w.today}::date)`,
  },
  due_today: { label: "Due today", cond: (w: OpsWindow) => dueBy("=", w.today) },
  due_unresolved: { label: "Due and unresolved", cond: (w: OpsWindow) => dueBy("<=", w.today) },
  high_value: {
    label: "High-value pending",
    cond: (_w: OpsWindow, highValue: number) => sql`(is_open AND value >= ${highValue})`,
  },
  received: {
    label: "Requests received",
    cond: (w: OpsWindow) => sql`received_day BETWEEN ${w.from}::date AND ${w.to}::date`,
  },
  completed: {
    label: "Requests completed",
    cond: (w: OpsWindow) => sql`(status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)`,
  },
} as const;

export type OpsListView = keyof typeof OPS_LIST_VIEWS;

export const isOpsListView = (v: unknown): v is OpsListView =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(OPS_LIST_VIEWS, v);

export type OpsRequestRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  client: string | null;
  investorId: string | null;
  leadId: string | null;
  assignee: string | null;
  priority: string | null;
  slaState: string;
  dueAt: string | null;
  slaDueAt: string | null;
  value: number | null;
  receivedAt: string;
  completedAt: string | null;
  tatHours: number | null;
};

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export async function loadOpsRequestList(
  tx: Tx,
  w: OpsWindow,
  view: OpsListView,
  highValue: number,
  limit = 500,
): Promise<{ rows: OpsRequestRow[]; total: number }> {
  const cond = OPS_LIST_VIEWS[view].cond(w, highValue);
  const r = await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT f.*, COUNT(*) OVER () AS total
      FROM f
     WHERE ${cond}
     ORDER BY is_open DESC, COALESCE(sla_due_at, due_at) ASC NULLS LAST, created_at DESC
     LIMIT ${limit}
  `);
  const rows = (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id),
    title: String(x.title ?? ""),
    kind: String(x.kind ?? "other"),
    status: String(x.status ?? ""),
    client: (x.client as string | null) ?? null,
    investorId: (x.investor_id as string | null) ?? null,
    leadId: (x.lead_id as string | null) ?? null,
    assignee: (x.assignee as string | null) ?? null,
    priority: (x.priority as string | null) ?? null,
    slaState: String(x.sla_state ?? "none"),
    dueAt: iso(x.due_at),
    slaDueAt: iso(x.sla_due_at),
    value: x.value == null ? null : Number(x.value),
    receivedAt: iso(x.created_at) ?? "",
    completedAt: iso(x.completed_at),
    tatHours: x.tat_hours == null ? null : Number(x.tat_hours),
  }));
  return { rows, total: rows.length ? Number((r.rows[0] as any).total) : 0 };
}
