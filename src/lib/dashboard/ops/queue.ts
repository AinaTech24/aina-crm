/**
 * The top of the Control Tower: the command strip (§1), the attention centre
 * (§2), the processing queue (§3), the morning stand-up (§46) and the day's
 * closure (§47). Everything here is CURRENT state plus the selected period's
 * flow; the history sits in flow.ts.
 *
 * Sources, and why each:
 *   requests        — ops work items (window.ts) — received / completed / open
 *   rejected/failed — the RTA / exchange feed (transactions) — a request task
 *                     has no rejected state; the platform's verdict does
 *   awaiting client — client-waiting queries and SIP rejections with the
 *                     client contacted; awaiting RM — requests held by an RM
 *   platform wait   — feed transactions still pending / submitted
 */

import { OPS_LIST_VIEWS as V } from "./request-list";
import { sql } from "drizzle-orm";
import {
  AGE_BUCKETS, clientScope, istDay, KIND_LABEL, num, numOrNull, opsBase, opsFilter, PENDING_LABEL,
  PRIORITY_LABEL, selfOnly, STATUS_LABEL, str, tasksHref, type OpsWindow, type Row, type Tx,
} from "./window";

const OPEN_SR = sql`('open', 'in_progress', 'escalated', 'waiting_customer')`;
const SIP_OPEN = sql`('pending', 'client_contacted', 'bank_issue', 'mandate_issue')`;
const FEED_REJECTED = sql`('rejected', 'failed')`;
const FEED_WAITING = sql`('pending', 'submitted')`;

/* ───────────────────────────── §1 command strip ───────────────────────────── */

export type Money = { count: number; value: number; valued: number };
export type CommandStrip = {
  received: Money;
  completed: Money & { completionPct: number | null; base: number };
  pending: Money;
  breached: Money;
  rejected: Money;
  awaitingRm: number;
  awaitingClient: number;
  awaitingApproval: number;
  documents: number;
  tat: { avgHours: number | null; medianHours: number | null; measured: number; completed: number };
};

export async function loadCommandStrip(tx: Tx, w: OpsWindow): Promise<CommandStrip> {
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT
      COUNT(*) FILTER (WHERE ${V.received.cond(w)})::int                                                  AS rec_n,
      COALESCE(SUM(value) FILTER (WHERE received_day BETWEEN ${w.from}::date AND ${w.to}::date), 0)       AS rec_v,
      COUNT(value) FILTER (WHERE received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int             AS rec_valued,
      COUNT(*) FILTER (WHERE ${V.completed.cond(w)})::int                                                 AS done_n,
      COALESCE(SUM(value) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date), 0) AS done_v,
      COUNT(value) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS done_valued,
      COUNT(*) FILTER (WHERE received_day < ${w.from}::date
                         AND (status NOT IN ('completed', 'cancelled')
                              OR ${istDay(sql`COALESCE(completed_at, updated_at)`)} >= ${w.from}::date))::int AS opening,
      COUNT(*) FILTER (WHERE is_open)::int                                                               AS open_n,
      COALESCE(SUM(value) FILTER (WHERE is_open), 0)                                                     AS open_v,
      COUNT(value) FILTER (WHERE is_open)::int                                                           AS open_valued,
      COUNT(*) FILTER (WHERE is_open AND sla_state = 'breached')::int                                    AS br_n,
      COALESCE(SUM(value) FILTER (WHERE is_open AND sla_state = 'breached'), 0)                          AS br_v,
      COUNT(value) FILTER (WHERE is_open AND sla_state = 'breached')::int                                AS br_valued,
      COUNT(*) FILTER (WHERE is_open AND pending_with = 'rm')::int                                       AS aw_rm,
      COUNT(*) FILTER (WHERE is_open AND pending_with = 'approval')::int                                 AS aw_appr,
      COUNT(*) FILTER (WHERE is_open AND kind = 'documentation')::int                                    AS docs,
      AVG(tat_hours) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date
                               AND completed_at IS NOT NULL AND completed_at >= created_at)             AS tat_avg,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY tat_hours) FILTER (WHERE status = 'completed'
                               AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date
                               AND completed_at IS NOT NULL AND completed_at >= created_at)             AS tat_med,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date
                         AND completed_at IS NOT NULL AND completed_at >= created_at)::int               AS tat_n
    FROM f
  `)).rows[0] as Row | undefined;

  const self = selfOnly(w);
  const feed = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(t.amount::numeric), 0) AS v, COUNT(t.amount)::int AS valued
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
       AND t.status IN ${FEED_REJECTED}
       AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date
       ${self ? sql`AND FALSE` : sql``}
  `)).rows[0] as Row | undefined;

  const client = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status = 'waiting_customer' AND ${clientScope(w)}
          ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int
      + (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
          WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status = 'client_contacted' AND ${clientScope(w)}
            ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``})::int AS n
  `)).rows[0] as Row | undefined;

  const received = num(r?.rec_n);
  const opening = num(r?.opening);
  const doneN = num(r?.done_n);
  const base = opening + received;
  return {
    received: { count: received, value: num(r?.rec_v), valued: num(r?.rec_valued) },
    completed: {
      count: doneN, value: num(r?.done_v), valued: num(r?.done_valued),
      completionPct: base > 0 ? doneN / base : null, base,
    },
    pending: { count: num(r?.open_n), value: num(r?.open_v), valued: num(r?.open_valued) },
    breached: { count: num(r?.br_n), value: num(r?.br_v), valued: num(r?.br_valued) },
    rejected: { count: num(feed?.n), value: num(feed?.v), valued: num(feed?.valued) },
    awaitingRm: num(r?.aw_rm),
    awaitingClient: num(client?.n),
    awaitingApproval: num(r?.aw_appr),
    documents: num(r?.docs),
    tat: {
      avgHours: numOrNull(r?.tat_avg),
      medianHours: numOrNull(r?.tat_med),
      measured: num(r?.tat_n),
      completed: doneN,
    },
  };
}

/* ───────────────────────────── §2 attention centre ───────────────────────────── */

export type AttentionCard = {
  key: string;
  label: string;
  rule: string;
  count: number;
  /** null when the source holds no amount. */
  value: number | null;
  oldestDays: number | null;
  /** The person holding most of these, where there is one. */
  owner: string | null;
  severity: "critical" | "attention" | "normal";
  href: string;
};

export async function loadAttention(tx: Tx, w: OpsWindow, highValue: number): Promise<AttentionCard[]> {
  const t = w.t;
  const self = selfOnly(w);
  const ops = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND is_open)
    SELECT 'breached' AS k, COUNT(*)::int AS n, SUM(value) AS v, MAX(age_days)::int AS oldest,
           (SELECT assignee FROM f f2 WHERE f2.sla_state = 'breached' AND f2.assignee IS NOT NULL
             GROUP BY assignee ORDER BY COUNT(*) DESC LIMIT 1) AS owner
      FROM f WHERE sla_state = 'breached'
    UNION ALL
    SELECT 'high_value', COUNT(*)::int, SUM(value), MAX(age_days)::int,
           (SELECT assignee FROM f f2 WHERE f2.value >= ${highValue} AND f2.assignee IS NOT NULL
             GROUP BY assignee ORDER BY COUNT(*) DESC LIMIT 1)
      FROM f WHERE value >= ${highValue}
    UNION ALL
    SELECT 'docs_sla', COUNT(*)::int, NULL, MAX(age_days)::int,
           (SELECT assignee FROM f f2 WHERE f2.kind = 'documentation' AND f2.sla_state = 'breached'
             AND f2.assignee IS NOT NULL GROUP BY assignee ORDER BY COUNT(*) DESC LIMIT 1)
      FROM f WHERE kind = 'documentation' AND sla_state = 'breached'
    UNION ALL
    SELECT 'no_update', COUNT(*)::int, SUM(value),
           MAX((${w.today}::date - ${istDay(sql`last_touch`)}))::int,
           (SELECT assignee FROM f f2 WHERE f2.last_touch < now() - (${t.opsNoUpdateDays} || ' days')::interval
             AND f2.assignee IS NOT NULL GROUP BY assignee ORDER BY COUNT(*) DESC LIMIT 1)
      FROM f WHERE last_touch < now() - (${t.opsNoUpdateDays} || ' days')::interval
    UNION ALL
    SELECT 'no_remarks', COUNT(*)::int, SUM(value), MAX(age_days)::int,
           (SELECT assignee FROM f f2 WHERE NOT f2.has_remarks AND f2.kind IN (
              'purchase','additional_purchase','redemption','switch','sip_registration','sip_modification','sip_stop',
              'sip_rejection','stp','swp','mandate','liquid','sif','aif','pms')
             AND f2.assignee IS NOT NULL GROUP BY assignee ORDER BY COUNT(*) DESC LIMIT 1)
      FROM f WHERE NOT has_remarks AND kind IN (
              'purchase','additional_purchase','redemption','switch','sip_registration','sip_modification','sip_stop',
              'sip_rejection','stp','swp','mandate','liquid','sif','aif','pms')
    UNION ALL
    SELECT 'unassigned', COUNT(*)::int, SUM(value), MAX(age_days)::int, NULL
      FROM f WHERE assignee_id IS NULL
  `)).rows as Row[];
  const O = new Map(ops.map((x) => [String(x.k), x]));

  const sip = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(s.rejection_amount::numeric), 0) AS v,
           MAX(${w.today}::date - s.rejection_date::date)::int AS oldest,
           COUNT(*) FILTER (WHERE COALESCE(s.status_changed_at, s.created_at) < now() - (${t.sipRejectionSlaDays} || ' days')::interval)::int AS past_sla,
           (SELECT u.name FROM sip_rejections s2 JOIN investors i2 ON i2.id = s2.investor_id JOIN users u ON u.id = s2.assigned_rm_id
             WHERE s2.tenant_id = ${w.tenantId}::uuid AND s2.recovery_status IN ${SIP_OPEN} AND ${clientScope(w, "i2")}
             GROUP BY u.name ORDER BY COUNT(*) DESC LIMIT 1) AS owner
      FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status IN ${SIP_OPEN} AND ${clientScope(w)}
       ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}
  `)).rows[0] as Row | undefined;

  const feed = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE t.status IN ${FEED_REJECTED}
                         AND t.order_date >= ${w.today}::date - ${t.rejectionRecentDays}::int)::int          AS rej_n,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.status IN ${FEED_REJECTED}
                         AND t.order_date >= ${w.today}::date - ${t.rejectionRecentDays}::int), 0)            AS rej_v,
      MAX(${w.today}::date - t.order_date) FILTER (WHERE t.status IN ${FEED_REJECTED}
                         AND t.order_date >= ${w.today}::date - ${t.rejectionRecentDays}::int)::int          AS rej_old,
      COUNT(*) FILTER (WHERE t.status IN ${FEED_WAITING}
                         AND COALESCE(t.order_date, t.created_at::date) < ${w.today}::date - ${t.opsPlatformPendingDays}::int)::int AS wait_n,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.status IN ${FEED_WAITING}
                         AND COALESCE(t.order_date, t.created_at::date) < ${w.today}::date - ${t.opsPlatformPendingDays}::int), 0) AS wait_v,
      MAX(${w.today}::date - COALESCE(t.order_date, t.created_at::date)) FILTER (WHERE t.status IN ${FEED_WAITING})::int AS wait_old
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} ${self ? sql`AND FALSE` : sql``}
  `)).rows[0] as Row | undefined;

  const q = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           MAX(${w.today}::date - ${istDay(sql`sr.created_at`)})::int AS oldest,
           (SELECT u.name FROM service_requests s2 LEFT JOIN investors i2 ON i2.id = s2.investor_id
              JOIN users u ON u.id = s2.assigned_to_user_id
             WHERE s2.tenant_id = ${w.tenantId}::uuid AND s2.status IN ${OPEN_SR}
               AND s2.sla_resolution_at < now() AND ${clientScope(w, "i2")}
             GROUP BY u.name ORDER BY COUNT(*) DESC LIMIT 1) AS owner
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
     WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status IN ${OPEN_SR}
       AND sr.sla_resolution_at < now() AND ${clientScope(w)}
       ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``}
  `)).rows[0] as Row | undefined;

  const opsCard = (
    key: string, label: string, rule: string, href: string,
    sev: (n: number) => AttentionCard["severity"], valued = true,
  ): AttentionCard => {
    const x = O.get(key);
    const n = num(x?.count ?? x?.n);
    return {
      key, label, rule, href, count: n,
      value: valued ? (x?.v == null ? null : num(x.v)) : null,
      oldestDays: numOrNull(x?.oldest), owner: str(x?.owner), severity: n > 0 ? sev(n) : "normal",
    };
  };

  return [
    opsCard("breached", "SLA breached", "Open requests past their SLA due time.", tasksHref({ due: "sla_risk" }), () => "critical"),
    opsCard("high_value", "High-value pending", `Open requests with a recorded value of ${fmtLakh(highValue)} or more.`,
      "#high-value", () => "attention"),
    {
      key: "sip", label: "SIP rejection pending", rule: `Bounced SIPs not yet recovered. Past SLA after ${t.sipRejectionSlaDays} days in one state.`,
      count: num(sip?.n), value: num(sip?.v), oldestDays: numOrNull(sip?.oldest), owner: str(sip?.owner),
      severity: num(sip?.past_sla) > 0 ? "critical" : num(sip?.n) > 0 ? "attention" : "normal",
      href: "/dashboard/sip-rejections?recovery=pending,client_contacted,bank_issue,mandate_issue",
    },
    {
      key: "rejected", label: "Transaction rejected", rule: `Rejected or failed on the RTA / exchange feed in the last ${t.rejectionRecentDays} days.`,
      count: num(feed?.rej_n), value: num(feed?.rej_v), oldestDays: numOrNull(feed?.rej_old), owner: null,
      severity: num(feed?.rej_n) > 0 ? "critical" : "normal", href: "#rejected",
    },
    opsCard("docs_sla", "Documents pending beyond SLA", "Document-collection requests past their SLA.",
      tasksHref({ type: "collect_document", due: "sla_risk" }), () => "critical", false),
    {
      key: "queries", label: "Service request overdue", rule: "Open service requests past their resolution SLA.",
      count: num(q?.n), value: null, oldestDays: numOrNull(q?.oldest), owner: str(q?.owner),
      severity: num(q?.n) > 0 ? "critical" : "normal", href: "/dashboard/service-requests?breached=1",
    },
    opsCard("no_update", "No update", `Open requests with no edit and no remark for ${t.opsNoUpdateDays}+ days.`,
      "#no-update", () => "attention"),
    opsCard("no_remarks", "Transaction without remarks", "Open transaction requests with no remark and no comment.",
      "#queue", () => "attention"),
    {
      key: "platform", label: "Awaiting platform / AMC too long",
      rule: `Feed transactions still pending or submitted after ${t.opsPlatformPendingDays} days.`,
      count: num(feed?.wait_n), value: num(feed?.wait_v), oldestDays: numOrNull(feed?.wait_old), owner: null,
      severity: num(feed?.wait_n) > 0 ? "attention" : "normal", href: "#external",
    },
    opsCard("unassigned", "Unassigned requests", "Open requests with nobody assigned.", "#unassigned", () => "attention"),
  ];
}

function fmtLakh(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v % 1e7 === 0 ? 0 : 2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v % 1e5 === 0 ? 0 : 2)} Lakh`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

/* ───────────────────────────── §3 processing queue ───────────────────────────── */

export type QueueItem = {
  id: string;
  receivedAt: string;
  title: string;
  kind: string;
  kindLabel: string;
  client: string | null;
  investorId: string | null;
  rm: string | null;
  branch: string | null;
  amount: number | null;
  mode: string | null;
  assigneeId: string | null;
  assignee: string | null;
  status: string;
  statusLabel: string;
  pendingWith: string | null;
  pendingLabel: string | null;
  slaDue: string | null;
  slaState: string;
  ageDays: number;
  priority: string;
  priorityLabel: string;
  remark: string | null;
  /** Escalation level (§45): 3 escalate · 2 overdue · 1 attention · 0 normal. */
  level: 0 | 1 | 2 | 3;
  levelWhy: string;
};

export async function loadQueue(
  tx: Tx, w: OpsWindow, highValue: number, limit = 60,
): Promise<{ items: QueueItem[]; total: number }> {
  const esc = Math.max(1, Math.round(w.t.opsEscalateHours));
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND is_open)
    SELECT f.*, rmu.name AS rm_name, b.name AS branch_name,
           (SELECT COALESCE(NULLIF(btrim(c.body), ''), NULL) FROM task_comments c
             WHERE c.task_id = f.id AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 1) AS last_comment,
           (f.sla_due_at < now() - (${esc} || ' hours')::interval) AS esc_breach,
           (f.due_at IS NOT NULL AND ${istDay(sql`f.due_at`)} = ${w.today}::date)
             OR (f.sla_due_at IS NOT NULL AND ${istDay(sql`f.sla_due_at`)} = ${w.today}::date) AS due_today,
           COUNT(*) OVER () AS total
      FROM f
      LEFT JOIN users rmu ON rmu.id = f.rm_id
      LEFT JOIN branches b ON b.id = f.branch_id
     ORDER BY (f.sla_state = 'breached') DESC,
              ((f.due_at IS NOT NULL AND ${istDay(sql`f.due_at`)} <= ${w.today}::date)
                OR (f.sla_due_at IS NOT NULL AND ${istDay(sql`f.sla_due_at`)} <= ${w.today}::date)) DESC,
              (f.priority IN ('urgent', 'high')) DESC,
              f.created_at ASC
     LIMIT ${limit}
  `)).rows as Row[];

  const items = rows.map((r): QueueItem => {
    const value = numOrNull(r.value);
    const breached = r.sla_state === "breached";
    const high = value != null && value >= highValue;
    let level: QueueItem["level"] = 0;
    let why = "Within SLA";
    if (breached && (r.esc_breach === true || high)) {
      level = 3;
      why = r.esc_breach === true ? `SLA breached by more than ${esc} hours` : "High-value request past SLA";
    } else if (breached) { level = 2; why = "SLA breached"; }
    else if (r.sla_state === "approaching" || (high && r.priority === "urgent")) {
      level = 1; why = r.sla_state === "approaching" ? `SLA due within ${w.t.opsSlaWarnHours} hours` : "High-value, critical priority";
    } else if (r.sla_state === "none") { why = "No SLA set"; }
    const status = r.approval_status === "pending" ? "awaiting_approval" : String(r.status);
    return {
      id: String(r.id),
      receivedAt: String(r.created_at),
      title: String(r.title ?? "Request"),
      kind: String(r.kind),
      kindLabel: KIND_LABEL[String(r.kind)] ?? "Other",
      client: str(r.client),
      investorId: str(r.investor_id),
      rm: str(r.rm_name),
      branch: str(r.branch_name),
      amount: value,
      mode: str(r.mode),
      assigneeId: str(r.assignee_id),
      assignee: str(r.assignee),
      status,
      statusLabel: STATUS_LABEL[status] ?? status,
      pendingWith: str(r.pending_with),
      pendingLabel: r.pending_with ? PENDING_LABEL[String(r.pending_with)] ?? String(r.pending_with) : null,
      slaDue: str(r.sla_due_at),
      slaState: String(r.sla_state),
      ageDays: num(r.age_days),
      priority: String(r.priority ?? "normal"),
      priorityLabel: PRIORITY_LABEL[String(r.priority ?? "normal")] ?? String(r.priority),
      remark: str(r.last_comment) ?? str(r.remarks),
      level,
      levelWhy: why,
    };
  });
  return { items, total: rows.length ? num(rows[0].total) : 0 };
}

/* ───────────────────────────── §46 morning · §47 closure ───────────────────────────── */

export type DayCounts = {
  carryForward: number;
  receivedToday: number;
  completedToday: number;
  rejectedToday: number;
  pendingNow: number;
  breached: number;
  dueToday: number;
  highValue: number;
  unassigned: number;
  documents: number;
  sipOpen: number;
  queriesOverdue: number;
  queriesOpen: number;
  tasksDueUnresolved: number;
};

export async function loadDayCounts(tx: Tx, w: OpsWindow, highValue: number): Promise<DayCounts> {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT
      -- Each condition is the one the tile's list runs (request-list.ts).
      COUNT(*) FILTER (WHERE ${V.carry.cond(w)})::int                                               AS carry,
      COUNT(*) FILTER (WHERE ${V.received_today.cond(w)})::int                                      AS rec,
      COUNT(*) FILTER (WHERE ${V.completed_today.cond(w)})::int                                     AS done,
      COUNT(*) FILTER (WHERE ${V.open.cond()})::int                                                 AS open_n,
      COUNT(*) FILTER (WHERE is_open AND sla_state = 'breached')::int                               AS breached,
      COUNT(*) FILTER (WHERE ${V.due_today.cond(w)})::int                                           AS due_today,
      COUNT(*) FILTER (WHERE ${V.high_value.cond(w, highValue)})::int                               AS high_value,
      COUNT(*) FILTER (WHERE is_open AND assignee_id IS NULL)::int                                  AS unassigned,
      COUNT(*) FILTER (WHERE is_open AND kind = 'documentation')::int                               AS docs,
      COUNT(*) FILTER (WHERE ${V.due_unresolved.cond(w)})::int                                      AS due_unresolved
    FROM f
  `)).rows[0] as Row | undefined;

  const x = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM transactions t JOIN investors i ON i.id = t.investor_id
        WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ${FEED_REJECTED}
          AND t.order_date = ${w.today}::date ${self ? sql`AND FALSE` : sql``})::int AS rej,
      (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
        WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status IN ${SIP_OPEN} AND ${clientScope(w)}
          ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``})::int AS sip,
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status IN ${OPEN_SR} AND ${clientScope(w)}
          ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int AS q_open,
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status IN ${OPEN_SR} AND sr.sla_resolution_at < now()
          AND ${clientScope(w)} ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int AS q_over
  `)).rows[0] as Row | undefined;

  return {
    carryForward: num(r?.carry),
    receivedToday: num(r?.rec),
    completedToday: num(r?.done),
    rejectedToday: num(x?.rej),
    pendingNow: num(r?.open_n),
    breached: num(r?.breached),
    dueToday: num(r?.due_today),
    highValue: num(r?.high_value),
    unassigned: num(r?.unassigned),
    documents: num(r?.docs),
    sipOpen: num(x?.sip),
    queriesOverdue: num(x?.q_over),
    queriesOpen: num(x?.q_open),
    tasksDueUnresolved: num(r?.due_unresolved),
  };
}

/** Ageing bucket key for a day count — shared by the tables that group by age. */
export function ageBucket(days: number): string {
  for (const b of AGE_BUCKETS) if (days >= b.min && (b.max == null || days <= b.max)) return b.key;
  return "d16";
}
