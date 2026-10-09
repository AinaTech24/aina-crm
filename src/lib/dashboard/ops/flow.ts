/**
 * Volume, value, funnel, SLA, ageing, TAT and the backlog's history (§4–8,
 * §33, §36–40).
 *
 * Two sources, never blended into one number:
 *   · REQUESTS — ops work items (window.ts): received / completed / pending.
 *   · THE FEED — transactions from the RTA / exchange feeds: the platform's
 *     own verdict (processed, pending, rejected) and the only reliable values.
 *
 * "Closed" for backlog history is completion, or cancellation — whose time the
 * CRM does not stamp, so a cancelled request is taken as closed on its last
 * edit. That approximation is stated where it is used.
 */

import { sql } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import {
  AGE_BUCKETS, clientScope, FINANCIAL_KINDS, inList, istDay, KIND_LABEL, num, numOrNull, OPS_KINDS,
  opsBase, opsFilter, selfOnly, str, type OpsWindow, type Row, type Tx,
  rejectedInstructionKey,
} from "./window";

const CLOSED_DAY = sql`CASE WHEN status IN ('completed', 'cancelled') THEN ${istDay(sql`COALESCE(completed_at, updated_at)`)} END`;

/* ───────────────────────────── §4 volume by request type ───────────────────────────── */

export type VolumeRow = {
  kind: string; label: string; received: number; completed: number; pending: number;
  /** Rejected on the feed for the matching transaction type; null = no feed counterpart. */
  feedRejected: number | null;
};

/** Feed transaction types → request kinds, for the "rejected on the feed" column. */
const FEED_KIND = sql`CASE
  WHEN t.type IN ('purchase', 'lumpsum') THEN 'purchase'
  WHEN t.type = 'redemption' THEN 'redemption'
  WHEN t.type = 'switch' THEN 'switch'
  WHEN t.type = 'sip' THEN 'sip_rejection'
  WHEN t.type IN ('sip_stop', 'sip_pause') THEN 'sip_stop'
  WHEN t.type IN ('stp', 'swp') THEN t.type
END`;
const FEED_KINDS = new Set(["purchase", "redemption", "switch", "sip_rejection", "sip_stop", "stp", "swp"]);

export async function loadVolume(tx: Tx, w: OpsWindow, from: string, to: string): Promise<VolumeRow[]> {
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT kind,
           COUNT(*) FILTER (WHERE received_day BETWEEN ${from}::date AND ${to}::date)::int            AS rec,
           COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${from}::date AND ${to}::date)::int AS done,
           COUNT(*) FILTER (WHERE is_open)::int                                                     AS open_n
      FROM f GROUP BY kind
  `)).rows as Row[];
  const self = selfOnly(w);
  const feed = self ? [] : (await tx.execute(sql`
    SELECT ${FEED_KIND} AS kind, COUNT(DISTINCT ${rejectedInstructionKey("t")})::int AS n
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
       AND t.status IN ('rejected', 'failed') AND t.order_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY 1
  `)).rows as Row[];
  const R = new Map(rows.map((r) => [String(r.kind), r]));
  const F = new Map(feed.map((r) => [String(r.kind), num(r.n)]));
  return OPS_KINDS.map((k) => {
    const r = R.get(k.key);
    return {
      kind: k.key, label: k.label,
      received: num(r?.rec), completed: num(r?.done), pending: num(r?.open_n),
      feedRejected: FEED_KINDS.has(k.key) ? F.get(k.key) ?? 0 : null,
    };
  }).filter((r) => r.received || r.completed || r.pending || r.feedRejected);
}

/* ───────────────────────────── §5 value (the feed) ───────────────────────────── */

export type ValueRow = {
  key: string; label: string;
  received: { n: number; v: number }; completed: { n: number; v: number };
  pending: { n: number; v: number }; rejected: { n: number; v: number };
};

/** Rejected is counted in unique instructions: an STP's two legs count once, at the instruction's amount (rejectedInstructionKey). */
export async function loadFeedValue(tx: Tx, w: OpsWindow, from: string, to: string): Promise<{ rows: ValueRow[]; any: boolean }> {
  if (selfOnly(w)) return { rows: [], any: false };
  const rows = (await tx.execute(sql`
    SELECT g.key,
           COUNT(*)::int AS rec_n, COALESCE(SUM(g.amount), 0) AS rec_v,
           COUNT(*) FILTER (WHERE g.status IN ('processed', 'successful'))::int AS done_n,
           COALESCE(SUM(g.amount) FILTER (WHERE g.status IN ('processed', 'successful')), 0) AS done_v,
           COUNT(*) FILTER (WHERE g.status IN ('pending', 'submitted'))::int AS pend_n,
           COALESCE(SUM(g.amount) FILTER (WHERE g.status IN ('pending', 'submitted')), 0) AS pend_v,
           COUNT(*) FILTER (WHERE g.status IN ('rejected', 'failed') AND g.first_leg)::int AS rej_n,
           COALESCE(SUM(g.amount) FILTER (WHERE g.status IN ('rejected', 'failed') AND g.first_leg), 0) AS rej_v
      FROM (
        SELECT CASE
                 WHEN t.type IN ('purchase', 'lumpsum') THEN 'purchase'
                 WHEN t.type = 'redemption' THEN 'redemption'
                 WHEN t.type = 'switch' THEN 'switch'
                 WHEN t.type = 'sip' THEN 'sip'
                 WHEN t.type IN ('sip_stop', 'sip_pause') THEN 'sip_stop'
                 WHEN t.type IN ('stp', 'swp') THEN t.type
                 ELSE 'other'
               END AS key,
               t.status, t.amount::numeric AS amount,
               ROW_NUMBER() OVER (PARTITION BY ${rejectedInstructionKey("t")} ORDER BY t.id) = 1 AS first_leg
          FROM transactions t JOIN investors i ON i.id = t.investor_id
         WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
           AND t.order_date BETWEEN ${from}::date AND ${to}::date
        UNION ALL
        SELECT 'liquid', t.status, t.amount::numeric,
               ROW_NUMBER() OVER (PARTITION BY ${rejectedInstructionKey("t")} ORDER BY t.id) = 1
          FROM transactions t JOIN investors i ON i.id = t.investor_id
         WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
           AND t.order_date BETWEEN ${from}::date AND ${to}::date
           AND (t.scheme_category ~* 'liquid' OR t.scheme_name ~* '\\mliquid\\M')
      ) g
     GROUP BY g.key
  `)).rows as Row[];
  const LABEL: Record<string, string> = {
    purchase: "Purchase", redemption: "Redemption", switch: "Switch", sip: "SIP instalments",
    sip_stop: "SIP stop / pause", stp: "STP", swp: "SWP", other: "Other (dividends etc.)",
    liquid: "of which: liquid funds",
  };
  const order = ["purchase", "redemption", "switch", "sip", "sip_stop", "stp", "swp", "other", "liquid"];
  const out = order.flatMap((key): ValueRow[] => {
    const r = rows.find((x) => x.key === key);
    if (!r) return [];
    return [{
      key, label: LABEL[key],
      received: { n: num(r.rec_n), v: num(r.rec_v) }, completed: { n: num(r.done_n), v: num(r.done_v) },
      pending: { n: num(r.pend_n), v: num(r.pend_v) }, rejected: { n: num(r.rej_n), v: num(r.rej_v) },
    }];
  });
  return { rows: out, any: out.length > 0 };
}

/* ───────────────────────────── §6 processing funnel ───────────────────────────── */

export type FunnelStep = { key: string; label: string; count: number; value: number; valued: number; avgHours: number | null; note?: string };
export type Funnel = { steps: FunnelStep[]; alternates: FunnelStep[]; approvalUsed: boolean };

export async function loadFunnel(tx: Tx, w: OpsWindow): Promise<Funnel> {
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}),
         f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND received_day BETWEEN ${w.from}::date AND ${w.to}::date)
    SELECT
      COUNT(*)::int AS rec_n, COALESCE(SUM(value), 0) AS rec_v, COUNT(value)::int AS rec_c,
      COUNT(*) FILTER (WHERE assignee_id IS NOT NULL)::int AS asg_n,
      COALESCE(SUM(value) FILTER (WHERE assignee_id IS NOT NULL), 0) AS asg_v,
      COUNT(value) FILTER (WHERE assignee_id IS NOT NULL)::int AS asg_c,
      COUNT(*) FILTER (WHERE status IN ('in_progress', 'blocked', 'completed'))::int AS pro_n,
      COALESCE(SUM(value) FILTER (WHERE status IN ('in_progress', 'blocked', 'completed')), 0) AS pro_v,
      COUNT(value) FILTER (WHERE status IN ('in_progress', 'blocked', 'completed'))::int AS pro_c,
      COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int AS sub_n,
      COALESCE(SUM(value) FILTER (WHERE submitted_at IS NOT NULL), 0) AS sub_v,
      COUNT(value) FILTER (WHERE submitted_at IS NOT NULL)::int AS sub_c,
      COUNT(*) FILTER (WHERE approval_status = 'approved')::int AS apr_n,
      COALESCE(SUM(value) FILTER (WHERE approval_status = 'approved'), 0) AS apr_v,
      COUNT(value) FILTER (WHERE approval_status = 'approved')::int AS apr_c,
      AVG(EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600.0)
        FILTER (WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL AND approved_at >= submitted_at) AS apr_h,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS done_n,
      COALESCE(SUM(value) FILTER (WHERE status = 'completed'), 0) AS done_v,
      COUNT(value) FILTER (WHERE status = 'completed')::int AS done_c,
      AVG(tat_hours) FILTER (WHERE status = 'completed' AND completed_at >= created_at) AS done_h,
      COUNT(*) FILTER (WHERE is_open AND status = 'blocked')::int AS blk_n,
      COUNT(*) FILTER (WHERE is_open AND approval_status = 'pending')::int AS awa_n,
      COUNT(*) FILTER (WHERE is_open AND pending_with = 'rm')::int AS rm_n,
      COUNT(*) FILTER (WHERE approval_status = 'rejected' OR (is_open AND approval_note IS NOT NULL
                              AND approval_status IS DISTINCT FROM 'pending'))::int AS ret_n,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS can_n
    FROM f
  `)).rows[0] as Row | undefined;
  const step = (key: string, label: string, p: string, avg?: unknown, note?: string): FunnelStep => ({
    key, label, count: num(r?.[`${p}_n`]), value: num(r?.[`${p}_v`]), valued: num(r?.[`${p}_c`]),
    avgHours: avg === undefined ? null : numOrNull(avg), note,
  });
  const approvalUsed = num(r?.sub_n) > 0;
  const steps = [
    step("received", "Request received", "rec"),
    step("assigned", "Assigned", "asg"),
    step("processing", "Processing started", "pro"),
    ...(approvalUsed ? [
      step("submitted", "Submitted for approval", "sub"),
      step("confirmed", "Approved", "apr", r?.apr_h, "average hours from submission to approval"),
    ] : []),
    step("completed", "Completed", "done", r?.done_h, "average hours from receipt to completion"),
  ];
  const alt = (key: string, label: string, n: unknown): FunnelStep =>
    ({ key, label, count: num(n), value: 0, valued: 0, avgHours: null });
  return {
    steps,
    alternates: [
      alt("awaiting_rm", "Awaiting RM", r?.rm_n),
      alt("awaiting_approval", "Awaiting approval", r?.awa_n),
      alt("blocked", "Blocked — outside the team", r?.blk_n),
      alt("returned", "Returned for correction", r?.ret_n),
      alt("cancelled", "Cancelled", r?.can_n),
    ],
    approvalUsed,
  };
}

/* ───────────────────────────── §7 SLA · §8 ageing ───────────────────────────── */

export type SlaView = {
  within: number; approaching: number; breached: number; noSla: number;
  avgTat: number | null; medianTat: number | null; measured: number;
  oldest: { id: string; title: string; client: string | null; assignee: string | null; days: number } | null;
};

export async function loadSla(tx: Tx, w: OpsWindow): Promise<SlaView> {
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT
      COUNT(*) FILTER (WHERE is_open AND sla_state = 'within')::int AS within,
      COUNT(*) FILTER (WHERE is_open AND sla_state = 'approaching')::int AS near,
      COUNT(*) FILTER (WHERE is_open AND sla_state = 'breached')::int AS breached,
      COUNT(*) FILTER (WHERE is_open AND sla_state = 'none')::int AS none,
      AVG(tat_hours) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date AND completed_at >= created_at) AS avg_h,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY tat_hours) FILTER (WHERE status = 'completed'
         AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date AND completed_at >= created_at) AS med_h,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date AND completed_at >= created_at)::int AS measured
    FROM f
  `)).rows[0] as Row | undefined;
  const o = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT id, title, client, assignee, age_days FROM ops WHERE ${opsFilter(w)} AND is_open
     ORDER BY created_at ASC LIMIT 1
  `)).rows[0] as Row | undefined;
  return {
    within: num(r?.within), approaching: num(r?.near), breached: num(r?.breached), noSla: num(r?.none),
    avgTat: numOrNull(r?.avg_h), medianTat: numOrNull(r?.med_h), measured: num(r?.measured),
    oldest: o ? { id: String(o.id), title: String(o.title), client: str(o.client), assignee: str(o.assignee), days: num(o.age_days) } : null,
  };
}

export type AgeRow = { key: string; label: string; count: number; value: number; valued: number; oldest: { id: string; title: string; client: string | null; days: number } | null };

export async function loadAgeing(tx: Tx, w: OpsWindow): Promise<AgeRow[]> {
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND is_open)
    SELECT CASE
             WHEN age_days <= 0 THEN 'd0' WHEN age_days = 1 THEN 'd1' WHEN age_days <= 3 THEN 'd2'
             WHEN age_days <= 5 THEN 'd4' WHEN age_days <= 7 THEN 'd6' WHEN age_days <= 15 THEN 'd8' ELSE 'd16'
           END AS b,
           COUNT(*)::int AS n, COALESCE(SUM(value), 0) AS v, COUNT(value)::int AS c,
           (ARRAY_AGG(id::text ORDER BY created_at ASC))[1] AS oid,
           (ARRAY_AGG(title ORDER BY created_at ASC))[1] AS otitle,
           (ARRAY_AGG(client ORDER BY created_at ASC))[1] AS oclient,
           MAX(age_days)::int AS odays
      FROM f GROUP BY 1
  `)).rows as Row[];
  return AGE_BUCKETS.map((b) => {
    const r = rows.find((x) => x.b === b.key);
    return {
      key: b.key, label: b.label, count: num(r?.n), value: num(r?.v), valued: num(r?.c),
      oldest: r ? { id: String(r.oid), title: String(r.otitle ?? ""), client: str(r.oclient), days: num(r.odays) } : null,
    };
  });
}

/* ───────────────────────────── §33 TAT by request type ───────────────────────────── */

export type TatRow = { kind: string; label: string; count: number; avgHours: number | null; medianHours: number | null; slaPct: number | null; withSla: number };

/** Over requests completed in the last 90 days — long enough to mean something whatever the page's period. */
export async function loadTatByKind(tx: Tx, w: OpsWindow): Promise<TatRow[]> {
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}),
         f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND status = 'completed'
                 AND completed_at IS NOT NULL AND completed_at >= created_at
                 AND completed_day > ${w.today}::date - 90)
    SELECT kind, COUNT(*)::int AS n, AVG(tat_hours) AS avg_h,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY tat_hours) AS med_h,
           COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL)::int AS with_sla,
           COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND completed_at <= sla_due_at)::int AS in_sla
      FROM f GROUP BY kind
  `)).rows as Row[];
  return OPS_KINDS.flatMap((k): TatRow[] => {
    const r = rows.find((x) => x.kind === k.key);
    if (!r) return [];
    const withSla = num(r.with_sla);
    return [{
      kind: k.key, label: k.label, count: num(r.n), avgHours: numOrNull(r.avg_h), medianHours: numOrNull(r.med_h),
      withSla, slaPct: withSla > 0 ? num(r.in_sla) / withSla : null,
    }];
  });
}

/* ───────────────────────────── §37 carry-forward ───────────────────────────── */

export type CarryDay = { day: string; opening: number; received: number; completed: number; closing: number };

export async function loadCarryForward(tx: Tx, w: OpsWindow): Promise<CarryDay[]> {
  const monthStart = `${w.today.slice(0, 8)}01`;
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}),
         f AS (SELECT received_day, completed_day, status, ${CLOSED_DAY} AS closed_day FROM ops WHERE ${opsFilter(w)}),
         d AS (SELECT gs::date AS day FROM generate_series(${monthStart}::date, ${w.today}::date, interval '1 day') gs)
    SELECT d.day::text AS day,
           (SELECT COUNT(*) FROM f WHERE f.received_day < d.day AND (f.closed_day IS NULL OR f.closed_day >= d.day))::int AS opening,
           (SELECT COUNT(*) FROM f WHERE f.received_day = d.day)::int AS received,
           (SELECT COUNT(*) FROM f WHERE f.status = 'completed' AND f.completed_day = d.day)::int AS completed,
           (SELECT COUNT(*) FROM f WHERE f.received_day <= d.day AND (f.closed_day IS NULL OR f.closed_day > d.day))::int AS closing
      FROM d ORDER BY d.day
  `)).rows as Row[];
  return rows.map((r) => ({
    day: String(r.day), opening: num(r.opening), received: num(r.received), completed: num(r.completed), closing: num(r.closing),
  }));
}

/* ───────────────────────────── §38–39 weekly / monthly review ───────────────────────────── */

export type ReviewRow = { key: string; label: string; current: number | null; previous: number | null; format: "count" | "currency" | "hours" | "percent"; inverse?: boolean; note?: string };
export type Review = { mode: "weekly" | "monthly"; currentLabel: string; previousLabel: string; rows: ReviewRow[] };

type Span = { from: string; to: string };

async function spanMetrics(tx: Tx, w: OpsWindow, s: Span) {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}),
         f AS (SELECT *, ${CLOSED_DAY} AS closed_day FROM ops WHERE ${opsFilter(w)})
    SELECT
      COUNT(*) FILTER (WHERE received_day < ${s.from}::date AND (closed_day IS NULL OR closed_day >= ${s.from}::date))::int AS opening,
      COUNT(*) FILTER (WHERE received_day BETWEEN ${s.from}::date AND ${s.to}::date)::int AS received,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${s.from}::date AND ${s.to}::date)::int AS completed,
      COUNT(*) FILTER (WHERE received_day <= ${s.to}::date AND (closed_day IS NULL OR closed_day > ${s.to}::date))::int AS closing,
      COUNT(*) FILTER (WHERE kind = 'documentation' AND received_day <= ${s.to}::date
                         AND (closed_day IS NULL OR closed_day > ${s.to}::date))::int AS docs_closing,
      COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND ${istDay(sql`sla_due_at`)} BETWEEN ${s.from}::date AND ${s.to}::date
                         AND (completed_at IS NULL OR completed_at > sla_due_at) AND status <> 'cancelled')::int AS breached,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${s.from}::date AND ${s.to}::date
                         AND kind IN (${inList(FINANCIAL_KINDS)}))::int AS fin_done,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${s.from}::date AND ${s.to}::date
                         AND kind NOT IN (${inList(FINANCIAL_KINDS)}))::int AS nonfin_done,
      COUNT(*) FILTER (WHERE type = 'back_office_work' AND received_day BETWEEN ${s.from}::date AND ${s.to}::date)::int AS bo,
      AVG(tat_hours) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${s.from}::date AND ${s.to}::date AND completed_at >= created_at) AS tat,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${s.from}::date AND ${s.to}::date AND sla_due_at IS NOT NULL)::int AS sla_base,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_day BETWEEN ${s.from}::date AND ${s.to}::date AND sla_due_at IS NOT NULL
                         AND completed_at <= sla_due_at)::int AS sla_in
    FROM f
  `)).rows[0] as Row | undefined;
  const x = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(DISTINCT ${rejectedInstructionKey("t")}) FROM transactions t JOIN investors i ON i.id = t.investor_id
        WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('rejected', 'failed')
          AND t.order_date BETWEEN ${s.from}::date AND ${s.to}::date ${self ? sql`AND FALSE` : sql``})::int AS rejected,
      (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
        WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
          AND s.rejection_date BETWEEN ${s.from}::date AND ${s.to}::date
          ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``})::int AS sip_rej,
      (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
        WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND s.recovery_status = 'recovered'
          AND ${istDay(sql`COALESCE(s.recovery_date::timestamptz, s.status_changed_at, s.updated_at)`)} BETWEEN ${s.from}::date AND ${s.to}::date
          ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``})::int AS repurchased,
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND sr.resolved_at IS NOT NULL
          AND ${istDay(sql`sr.resolved_at`)} BETWEEN ${s.from}::date AND ${s.to}::date
          ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int AS q_resolved,
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
          AND ${istDay(sql`sr.created_at`)} BETWEEN ${s.from}::date AND ${s.to}::date
          ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``})::int AS q_received
  `)).rows[0] as Row | undefined;
  const slaBase = num(r?.sla_base);
  return {
    opening: num(r?.opening), received: num(r?.received), completed: num(r?.completed), closing: num(r?.closing),
    docsClosing: num(r?.docs_closing), breached: num(r?.breached), finDone: num(r?.fin_done), nonFinDone: num(r?.nonfin_done), bo: num(r?.bo),
    tat: numOrNull(r?.tat), slaPct: slaBase > 0 ? num(r?.sla_in) / slaBase : null,
    rejected: num(x?.rejected), sipRej: num(x?.sip_rej), repurchased: num(x?.repurchased),
    qResolved: num(x?.q_resolved), qReceived: num(x?.q_received),
  };
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtD = (iso: string) => formatDate(iso, "dayMonth");

export async function loadReview(tx: Tx, w: OpsWindow, mode: "weekly" | "monthly"): Promise<Review> {
  let cur: Span; let prev: Span;
  if (mode === "weekly") {
    const dow = (new Date(`${w.today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const monday = addDays(w.today, -dow);
    cur = { from: monday, to: w.today };
    prev = { from: addDays(monday, -7), to: addDays(w.today, -7) };
  } else {
    const first = `${w.today.slice(0, 8)}01`;
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const prevFirst = d.toISOString().slice(0, 10);
    const dayOfMonth = Number(w.today.slice(8, 10));
    const prevLast = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    // The same stretch of last month — the 1st to the same day — never a part-month against a whole one.
    cur = { from: first, to: w.today };
    prev = { from: prevFirst, to: `${prevFirst.slice(0, 8)}${String(Math.min(dayOfMonth, prevLast)).padStart(2, "0")}` };
  }
  const [c, p] = [await spanMetrics(tx, w, cur), await spanMetrics(tx, w, prev)];
  const row = (key: string, label: string, get: (m: typeof c) => number | null, format: ReviewRow["format"] = "count", inverse = false, note?: string): ReviewRow =>
    ({ key, label, current: get(c), previous: get(p), format, inverse, note });
  const common = [
    row("opening", "Opening pending", (m) => m.opening, "count", true),
    row("received", "Requests received", (m) => m.received),
    row("completed", "Completed", (m) => m.completed),
    row("closing", "Closing pending", (m) => m.closing, "count", true),
    row("rejected", "Rejected on the feed", (m) => m.rejected, "count", true),
    row("breached", "SLA breached", (m) => m.breached, "count", true, "SLA fell due in the period and was missed"),
    row("sip_rej", "SIP rejections", (m) => m.sipRej, "count", true),
    row("repurchased", "SIP repurchase completed", (m) => m.repurchased),
    row("q_resolved", "Service requests resolved", (m) => m.qResolved),
  ];
  const rows = mode === "weekly" ? [
    ...common,
    row("tasks", "Tasks completed", (m) => m.finDone + m.nonFinDone),
    row("bo", "Back-office work received", (m) => m.bo),
  ] : [
    ...common,
    row("q_received", "Service requests received", (m) => m.qReceived),
    row("tat", "Average TAT", (m) => m.tat, "hours", true),
    row("sla", "SLA compliance", (m) => m.slaPct, "percent", false, "completed within SLA ÷ completed with an SLA"),
    row("fin", "Financial requests completed", (m) => m.finDone),
    row("nonfin", "Non-financial requests completed", (m) => m.nonFinDone),
    row("docs", "Documentation pending at close", (m) => m.docsClosing, "count", true, "documentation requests still open on the last day of the span"),
    row("bo", "Back-office work received", (m) => m.bo),
  ];
  return {
    mode,
    currentLabel: `${fmtD(cur.from)} – ${fmtD(cur.to)}`,
    previousLabel: `${fmtD(prev.from)} – ${fmtD(prev.to)}`,
    rows,
  };
}

/* ───────────────────────────── §40 trend ───────────────────────────── */

export type TrendPoint = { month: string; label: string; received: number; completed: number; closing: number; rejected: number; breached: number };

export async function loadTrend(tx: Tx, w: OpsWindow, fyStart: string): Promise<TrendPoint[]> {
  const self = selfOnly(w);
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}),
         f AS (SELECT *, ${CLOSED_DAY} AS closed_day FROM ops WHERE ${opsFilter(w)}),
         m AS (SELECT gs::date AS m0, (gs + interval '1 month' - interval '1 day')::date AS m1
                 FROM generate_series(${fyStart}::date, ${w.today}::date, interval '1 month') gs)
    SELECT to_char(m.m0, 'YYYY-MM') AS month, to_char(m.m0, 'Mon') AS label,
           (SELECT COUNT(*) FROM f WHERE f.received_day BETWEEN m.m0 AND m.m1)::int AS received,
           (SELECT COUNT(*) FROM f WHERE f.status = 'completed' AND f.completed_day BETWEEN m.m0 AND m.m1)::int AS completed,
           (SELECT COUNT(*) FROM f WHERE f.received_day <= LEAST(m.m1, ${w.today}::date)
              AND (f.closed_day IS NULL OR f.closed_day > LEAST(m.m1, ${w.today}::date)))::int AS closing,
           (SELECT COUNT(*) FROM f WHERE f.sla_due_at IS NOT NULL AND ${istDay(sql`f.sla_due_at`)} BETWEEN m.m0 AND m.m1
              AND (f.completed_at IS NULL OR f.completed_at > f.sla_due_at) AND f.status <> 'cancelled'
              AND ${istDay(sql`f.sla_due_at`)} <= ${w.today}::date)::int AS breached,
           ${self ? sql`0` : sql`(SELECT COUNT(DISTINCT ${rejectedInstructionKey("t")}) FROM transactions t JOIN investors i ON i.id = t.investor_id
              WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('rejected', 'failed')
                AND t.order_date BETWEEN m.m0 AND m.m1)`}::int AS rejected
      FROM m ORDER BY m.m0
  `)).rows as Row[];
  return rows.map((r) => ({
    month: String(r.month), label: String(r.label), received: num(r.received), completed: num(r.completed),
    closing: num(r.closing), rejected: num(r.rejected), breached: num(r.breached),
  }));
}

export { KIND_LABEL };
