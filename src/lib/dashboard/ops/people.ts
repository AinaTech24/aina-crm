/**
 * Who holds the work (§17–22, §25–27): the team's workload, its distribution,
 * productivity, financial / non-financial / approval queues, back-office work,
 * and the branch- and RM-wise views.
 *
 * Workload, never a league table: executives are listed by name, not ranked —
 * the brief: "Do not automatically rank employees only by transaction count
 * because transaction complexity can differ."
 */

import { sql } from "drizzle-orm";
import { BO_PARTICULARS } from "@/lib/service/back-office-work";
import {
  clientScope, FINANCIAL_KINDS, inList, istDay, KIND_LABEL, num, numOrNull, OPS_ROLES, opsBase, opsFilter,
  selfOnly, str, textArray, type OpsWindow, type Row, type Tx,
  rejectedInstructionKey,
} from "./window";

/* ───────────────────────────── §17–18 team workload ───────────────────────────── */

export type ExecRow = {
  id: string | null;
  name: string;
  isOps: boolean;
  assigned: number;
  receivedToday: number;
  completedToday: number;
  completedPeriod: number;
  pending: number;
  overdue: number;
  value: number;
  valued: number;
  avgTat: number | null;
  oldestDays: number | null;
  mix: Array<{ kind: string; label: string; n: number }>;
};

export async function loadTeam(tx: Tx, w: OpsWindow): Promise<ExecRow[]> {
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)}),
         people AS (
           SELECT u.id, u.name, (u.roles && ${textArray(OPS_ROLES)}) AS is_ops FROM users u
            WHERE u.tenant_id = ${w.tenantId}::uuid AND u.status = 'active' AND u.roles && ${textArray(OPS_ROLES)}
              ${w.scope.kind === "self" ? sql`AND u.id = ${w.scope.userId}::uuid` : sql``}
           UNION
           SELECT u.id, u.name, (u.roles && ${textArray(OPS_ROLES)}) FROM users u
            WHERE u.id IN (SELECT assignee_id FROM f WHERE is_open AND assignee_id IS NOT NULL)
         )
    SELECT p.id, p.name, p.is_ops,
           COUNT(f.id) FILTER (WHERE f.is_open)::int AS pending,
           COUNT(f.id) FILTER (WHERE f.received_day = ${w.today}::date)::int AS rec_today,
           COUNT(f.id) FILTER (WHERE f.status = 'completed' AND f.completed_day = ${w.today}::date)::int AS done_today,
           COUNT(f.id) FILTER (WHERE f.status = 'completed' AND f.completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS done_period,
           COUNT(f.id) FILTER (WHERE f.is_open AND f.sla_state = 'breached')::int AS overdue,
           COALESCE(SUM(f.value) FILTER (WHERE f.is_open), 0) AS value,
           COUNT(f.value) FILTER (WHERE f.is_open)::int AS valued,
           AVG(f.tat_hours) FILTER (WHERE f.status = 'completed' AND f.completed_day BETWEEN ${w.from}::date AND ${w.to}::date
                                      AND f.completed_at >= f.created_at) AS tat,
           MAX(f.age_days) FILTER (WHERE f.is_open)::int AS oldest
      FROM people p LEFT JOIN f ON f.assignee_id = p.id
     GROUP BY p.id, p.name, p.is_ops
     ORDER BY p.name
  `)).rows as Row[];
  const unassigned = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND is_open AND assignee_id IS NULL)
    SELECT COUNT(*)::int AS n, COALESCE(SUM(value), 0) AS v, COUNT(value)::int AS c,
           COUNT(*) FILTER (WHERE sla_state = 'breached')::int AS br, MAX(age_days)::int AS oldest,
           COUNT(*) FILTER (WHERE received_day = ${w.today}::date)::int AS rec_today
      FROM f
  `)).rows[0] as Row | undefined;
  const mix = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT assignee_id, kind, COUNT(*)::int AS n FROM ops
     WHERE ${opsFilter(w)} AND is_open AND assignee_id IS NOT NULL
     GROUP BY 1, 2
  `)).rows as Row[];
  const mixOf = (id: string) => mix.filter((m) => String(m.assignee_id) === id)
    .sort((a, b) => num(b.n) - num(a.n))
    .map((m) => ({ kind: String(m.kind), label: KIND_LABEL[String(m.kind)] ?? "Other", n: num(m.n) }));

  const out: ExecRow[] = rows.map((r) => ({
    id: String(r.id), name: String(r.name ?? "—"), isOps: r.is_ops === true,
    assigned: num(r.pending), receivedToday: num(r.rec_today), completedToday: num(r.done_today),
    completedPeriod: num(r.done_period), pending: num(r.pending), overdue: num(r.overdue),
    value: num(r.value), valued: num(r.valued), avgTat: numOrNull(r.tat), oldestDays: numOrNull(r.oldest),
    mix: mixOf(String(r.id)),
  }));
  if (num(unassigned?.n) > 0) {
    out.push({
      id: null, name: "Not assigned", isOps: false, assigned: 0, receivedToday: num(unassigned?.rec_today),
      completedToday: 0, completedPeriod: 0, pending: num(unassigned?.n), overdue: num(unassigned?.br),
      value: num(unassigned?.v), valued: num(unassigned?.c), avgTat: null, oldestDays: numOrNull(unassigned?.oldest), mix: [],
    });
  }
  return out;
}

/* ───────────────────────────── §19 productivity ───────────────────────────── */

export type ProdRow = { key: string; label: string; current: number; previous: number; note?: string };
export type Productivity = { today: string; previousDay: string; day: ProdRow[]; week: ProdRow[] };

/** The previous working day: yesterday, stepping back over Sunday. */
function previousWorkingDay(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function prodSpan(tx: Tx, w: OpsWindow, from: string, to: string) {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}),
         f AS (SELECT *, CASE WHEN status IN ('completed', 'cancelled')
                              THEN ${istDay(sql`COALESCE(completed_at, updated_at)`)} END AS closed_day
                 FROM ops WHERE ${opsFilter(w)})
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${from}::date AND ${to}::date
                         AND kind IN (${inList(FINANCIAL_KINDS)}))::int AS txns,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${from}::date AND ${to}::date)::int AS tasks,
      COUNT(*) FILTER (WHERE ${istDay(sql`updated_at`)} BETWEEN ${from}::date AND ${to}::date)::int AS touched,
      COUNT(*) FILTER (WHERE received_day <= ${to}::date AND (closed_day IS NULL OR closed_day > ${to}::date))::int AS carried
    FROM f
  `)).rows[0] as Row | undefined;
  const q = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND sr.resolved_at IS NOT NULL
          AND ${istDay(sql`sr.resolved_at`)} BETWEEN ${from}::date AND ${to}::date
          ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int AS resolved,
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
          AND ${istDay(sql`sr.updated_at`)} BETWEEN ${from}::date AND ${to}::date
          ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int AS sr_touched,
      (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
        WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
          AND ${istDay(sql`s.updated_at`)} BETWEEN ${from}::date AND ${to}::date
          ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``})::int AS sip_touched
  `)).rows[0] as Row | undefined;
  return {
    txns: num(r?.txns), tasks: num(r?.tasks), resolved: num(q?.resolved),
    updated: num(r?.touched) + num(q?.sr_touched) + num(q?.sip_touched), carried: num(r?.carried),
  };
}

export async function loadProductivity(tx: Tx, w: OpsWindow): Promise<Productivity> {
  const prev = previousWorkingDay(w.today);
  const dow = (new Date(`${w.today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shift(w.today, -dow);
  const [d0, d1, w0, w1] = [
    await prodSpan(tx, w, w.today, w.today),
    await prodSpan(tx, w, prev, prev),
    await prodSpan(tx, w, monday, w.today),
    await prodSpan(tx, w, shift(monday, -7), shift(w.today, -7)),
  ];
  const rows = (c: typeof d0, p: typeof d0): ProdRow[] => [
    { key: "txns", label: "Transactions processed", current: c.txns, previous: p.txns, note: "financial requests completed" },
    { key: "tasks", label: "Requests completed", current: c.tasks, previous: p.tasks },
    { key: "queries", label: "Service requests resolved", current: c.resolved, previous: p.resolved },
    { key: "updated", label: "Records updated", current: c.updated, previous: p.updated, note: "requests, service requests and SIP rejections edited" },
    { key: "carried", label: "Pending carried forward", current: c.carried, previous: p.carried, note: "open at the end of the day / week" },
  ];
  return { today: w.today, previousDay: prev, day: rows(d0, d1), week: rows(w0, w1) };
}

/* ───────────────────────────── §20–22 task queues ───────────────────────────── */

export type TaskQueueRow = {
  id: string; title: string; kindLabel: string; client: string | null; investorId: string | null;
  rm: string | null; branch: string | null; assignee: string | null; created: string; due: string | null;
  status: string; ageDays: number; overdue: boolean;
};
export type TaskQueue = {
  created: number; completed: number; pending: number; overdue: number; assigned: number;
  completionPct: number | null; rows: TaskQueueRow[]; more: number;
};

async function loadTaskQueue(tx: Tx, w: OpsWindow, financial: boolean): Promise<TaskQueue> {
  const pick = financial ? sql`kind IN (${inList(FINANCIAL_KINDS)})` : sql`kind NOT IN (${inList(FINANCIAL_KINDS)})`;
  const c = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND ${pick})
    SELECT
      COUNT(*) FILTER (WHERE received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS created,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS completed,
      COUNT(*) FILTER (WHERE received_day < ${w.from}::date
                         AND (status NOT IN ('completed', 'cancelled')
                              OR ${istDay(sql`COALESCE(completed_at, updated_at)`)} >= ${w.from}::date))::int AS opening,
      COUNT(*) FILTER (WHERE is_open)::int AS pending,
      COUNT(*) FILTER (WHERE is_open AND assignee_id IS NOT NULL)::int AS assigned,
      COUNT(*) FILTER (WHERE is_open AND (sla_state = 'breached' OR (due_at IS NOT NULL AND due_at < now())))::int AS overdue
    FROM f
  `)).rows[0] as Row | undefined;
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT o.id, o.title, o.kind, o.client, o.investor_id, rmu.name AS rm, b.name AS branch, o.assignee,
           o.created_at, COALESCE(o.due_at, o.sla_due_at) AS due, o.status, o.approval_status, o.age_days,
           (o.sla_state = 'breached' OR (o.due_at IS NOT NULL AND o.due_at < now())) AS overdue,
           COUNT(*) OVER () AS total
      FROM ops o
      LEFT JOIN users rmu ON rmu.id = o.rm_id
      LEFT JOIN branches b ON b.id = o.branch_id
     WHERE ${opsFilter(w, "o")} AND o.is_open AND ${financial ? sql`o.kind IN (${inList(FINANCIAL_KINDS)})` : sql`o.kind NOT IN (${inList(FINANCIAL_KINDS)})`}
     ORDER BY overdue DESC, COALESCE(o.due_at, o.sla_due_at) ASC NULLS LAST, o.created_at ASC
     LIMIT 25
  `)).rows as Row[];
  const created = num(c?.created);
  const completed = num(c?.completed);
  const base = num(c?.opening) + created;
  return {
    created, completed, pending: num(c?.pending), overdue: num(c?.overdue), assigned: num(c?.assigned),
    completionPct: base > 0 ? completed / base : null,
    rows: rows.map((r) => ({
      id: String(r.id), title: String(r.title ?? "Request"), kindLabel: KIND_LABEL[String(r.kind)] ?? "Other",
      client: str(r.client), investorId: str(r.investor_id), rm: str(r.rm), branch: str(r.branch),
      assignee: str(r.assignee), created: String(r.created_at), due: str(r.due),
      status: r.approval_status === "pending" ? "awaiting_approval" : String(r.status),
      ageDays: num(r.age_days), overdue: r.overdue === true,
    })),
    more: Math.max(0, (rows.length ? num(rows[0].total) : 0) - rows.length),
  };
}

export const loadFinancialTasks = (tx: Tx, w: OpsWindow) => loadTaskQueue(tx, w, true);
export const loadNonFinancialTasks = (tx: Tx, w: OpsWindow) => loadTaskQueue(tx, w, false);

export type ApprovalRow = { id: string; title: string; client: string | null; assignee: string | null; approver: string | null; submitted: string | null; waitingDays: number | null };
export type Approvals = { count: number; oldestDays: number | null; rows: ApprovalRow[] };

/** §21 — requests sitting with an approver ("link not approved" and the like). */
export async function loadApprovals(tx: Tx, w: OpsWindow): Promise<Approvals> {
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT id, title, client, assignee, created_by, submitted_at,
           (${w.today}::date - ${istDay(sql`COALESCE(submitted_at, updated_at)`)})::int AS waiting
      FROM ops WHERE ${opsFilter(w)} AND is_open AND approval_status = 'pending'
     ORDER BY COALESCE(submitted_at, updated_at) ASC
  `)).rows as Row[];
  return {
    count: rows.length,
    oldestDays: rows.length ? num(rows[0].waiting) : null,
    rows: rows.slice(0, 15).map((r) => ({
      id: String(r.id), title: String(r.title ?? "Request"), client: str(r.client), assignee: str(r.assignee),
      approver: str(r.created_by), submitted: str(r.submitted_at), waitingDays: numOrNull(r.waiting),
    })),
  };
}

/* ───────────────────────────── §25 back-office work ───────────────────────────── */

export type BoCell = { count: number; value: number; completed: number; pending: number };
export type BoRow = { key: string; label: string; online: BoCell; offline: BoCell; unrecorded: BoCell };

export async function loadBackOffice(tx: Tx, w: OpsWindow): Promise<{ rows: BoRow[]; any: boolean }> {
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT COALESCE(o.p, 'other') AS particular, COALESCE(o.mode, 'none') AS channel,
           COUNT(*)::int AS n, COALESCE(SUM(o.value), 0) AS v,
           COUNT(*) FILTER (WHERE o.status = 'completed')::int AS done,
           COUNT(*) FILTER (WHERE o.is_open)::int AS open_n
      FROM (SELECT ops.*, t.meta->>'boParticular' AS p FROM ops JOIN tasks t ON t.id = ops.id
             WHERE ops.type = 'back_office_work' AND ${opsFilter(w)}
               AND (ops.received_day BETWEEN ${w.from}::date AND ${w.to}::date OR ops.is_open)) o
     GROUP BY 1, 2
  `)).rows as Row[];
  const cell = (p: string, ch: string): BoCell => {
    const r = rows.find((x) => x.particular === p && x.channel === ch);
    return { count: num(r?.n), value: num(r?.v), completed: num(r?.done), pending: num(r?.open_n) };
  };
  const defs = [...BO_PARTICULARS, { key: "other", label: "Other back-office work" }];
  const out = defs.map((d) => ({ key: d.key, label: d.label, online: cell(d.key, "online"), offline: cell(d.key, "offline"), unrecorded: cell(d.key, "none") }))
    .filter((r) => r.online.count + r.offline.count + r.unrecorded.count > 0 || r.key !== "other");
  return { rows: out, any: rows.length > 0 };
}

/* ───────────────────────────── §26 branch-wise · §27 RM-wise ───────────────────────────── */

export type BranchRow = { id: string | null; name: string; received: number; completed: number; pending: number; rejected: number; breached: number; avgTat: number | null };

export async function loadBranchWise(tx: Tx, w: OpsWindow): Promise<BranchRow[]> {
  const self = selfOnly(w);
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT f.branch_id, b.name,
           COUNT(*) FILTER (WHERE f.received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS rec,
           COUNT(*) FILTER (WHERE f.status = 'completed' AND f.completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS done,
           COUNT(*) FILTER (WHERE f.is_open)::int AS open_n,
           COUNT(*) FILTER (WHERE f.is_open AND f.sla_state = 'breached')::int AS br,
           AVG(f.tat_hours) FILTER (WHERE f.status = 'completed' AND f.completed_day BETWEEN ${w.from}::date AND ${w.to}::date
                                      AND f.completed_at >= f.created_at) AS tat
      FROM f LEFT JOIN branches b ON b.id = f.branch_id
     GROUP BY 1, 2
  `)).rows as Row[];
  const rej = self ? [] : (await tx.execute(sql`
    SELECT i.branch_id, COUNT(DISTINCT ${rejectedInstructionKey("t")})::int AS n
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('rejected', 'failed')
       AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date
     GROUP BY 1
  `)).rows as Row[];
  const ids = new Set<string>([...rows.map((r) => String(r.branch_id ?? "")), ...rej.map((r) => String(r.branch_id ?? ""))]);
  const names = new Map(rows.map((r) => [String(r.branch_id ?? ""), str(r.name)]));
  if (rej.some((r) => r.branch_id && !names.get(String(r.branch_id)))) {
    const extra = (await tx.execute(sql`SELECT id::text AS id, name FROM branches WHERE tenant_id = ${w.tenantId}::uuid`)).rows as Row[];
    for (const e of extra) if (!names.get(String(e.id))) names.set(String(e.id), str(e.name));
  }
  return [...ids].map((id): BranchRow => {
    const r = rows.find((x) => String(x.branch_id ?? "") === id);
    return {
      id: id || null, name: id ? names.get(id) ?? "Branch" : "No branch recorded",
      received: num(r?.rec), completed: num(r?.done), pending: num(r?.open_n),
      rejected: num(rej.find((x) => String(x.branch_id ?? "") === id)?.n), breached: num(r?.br), avgTat: numOrNull(r?.tat),
    };
  }).sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
}

export type RmRow = { id: string | null; name: string; raised: number; completed: number; pending: number; awaitingRm: number; awaitingClient: number; rejected: number; breached: number };

export async function loadRmWise(tx: Tx, w: OpsWindow): Promise<RmRow[]> {
  const self = selfOnly(w);
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT f.rm_id, u.name,
           COUNT(*) FILTER (WHERE f.received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS raised,
           COUNT(*) FILTER (WHERE f.status = 'completed' AND f.completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS done,
           COUNT(*) FILTER (WHERE f.is_open)::int AS open_n,
           COUNT(*) FILTER (WHERE f.is_open AND f.pending_with = 'rm')::int AS aw_rm,
           COUNT(*) FILTER (WHERE f.is_open AND f.sla_state = 'breached')::int AS br
      FROM f LEFT JOIN users u ON u.id = f.rm_id
     WHERE f.investor_id IS NOT NULL
     GROUP BY 1, 2
  `)).rows as Row[];
  const ext = self ? [] : (await tx.execute(sql`
    SELECT i.rm_id,
           (SELECT COUNT(*) FROM service_requests sr WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status = 'waiting_customer'
              AND sr.investor_id IN (SELECT i2.id FROM investors i2 WHERE i2.rm_id = i.rm_id AND ${clientScope(w, "i2")}))::int
         + (SELECT COUNT(*) FROM sip_rejections s WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status = 'client_contacted'
              AND s.investor_id IN (SELECT i2.id FROM investors i2 WHERE i2.rm_id = i.rm_id AND ${clientScope(w, "i2")}))::int AS aw_client,
           (SELECT COUNT(DISTINCT ${rejectedInstructionKey("t")}) FROM transactions t WHERE t.tenant_id = ${w.tenantId}::uuid AND t.status IN ('rejected', 'failed')
              AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date
              AND t.investor_id IN (SELECT i2.id FROM investors i2 WHERE i2.rm_id = i.rm_id AND ${clientScope(w, "i2")}))::int AS rej
      FROM (SELECT DISTINCT rm_id FROM investors i WHERE i.tenant_id = ${w.tenantId}::uuid AND i.rm_id IS NOT NULL AND ${clientScope(w)}) i
  `)).rows as Row[];
  const names = (await tx.execute(sql`SELECT id::text AS id, name FROM users WHERE tenant_id = ${w.tenantId}::uuid`)).rows as Row[];
  const N = new Map(names.map((r) => [String(r.id), String(r.name ?? "—")]));
  const ids = new Set<string>([...rows.map((r) => String(r.rm_id ?? "")), ...ext.filter((r) => num(r.aw_client) || num(r.rej)).map((r) => String(r.rm_id ?? ""))]);
  return [...ids].map((id): RmRow => {
    const r = rows.find((x) => String(x.rm_id ?? "") === id);
    const e = ext.find((x) => String(x.rm_id ?? "") === id);
    return {
      id: id || null, name: id ? N.get(id) ?? "RM" : "No RM mapped",
      raised: num(r?.raised), completed: num(r?.done), pending: num(r?.open_n), awaitingRm: num(r?.aw_rm),
      awaitingClient: num(e?.aw_client), rejected: num(e?.rej), breached: num(r?.br),
    };
  }).sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
}
