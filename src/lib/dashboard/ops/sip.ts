/**
 * SIP operations (§9–12): the control centre, the rejection register that
 * replaces the monthly SIP-rejection report, reasons, and recovery.
 *
 * The rejection register (sip_rejections) is the source of truth for bounces
 * and their recovery. Recovery is only "successful" at `recovered` — the
 * brief: "Do not call this successful until the replacement/repurchase is
 * actually completed". `reprocessed` is initiated, not done.
 *
 * Registration / modification / stop REQUESTS come from the ops queue (the
 * request types in window.ts); the feed adds stops the platform confirmed.
 */

import { sql } from "drizzle-orm";
import { clientScope, istDay, num, opsBase, opsFilter, selfOnly, str, type OpsWindow, type Row, type Tx } from "./window";

const SIP_OPEN = sql`('pending', 'client_contacted', 'bank_issue', 'mandate_issue')`;

export const RECOVERY_LABEL: Record<string, string> = {
  pending: "Not yet worked",
  client_contacted: "Client / RM contacted",
  bank_issue: "Bank issue",
  mandate_issue: "Mandate issue",
  reprocessed: "Repurchase initiated",
  recovered: "Recovered",
  not_recoverable: "Not recoverable",
};

export const REASON_LABEL: Record<string, string> = {
  insufficient_balance: "Insufficient balance",
  mandate_expired: "Mandate expired",
  technical: "Technical failure",
};

/* ───────────────────────────── §9 control centre ───────────────────────────── */

export type SipControl = {
  regReceived: number; regCompleted: number; regPending: number;
  modPending: number; stopRequests: number; stopConfirmed: number;
  rejected: number; repurchaseDone: number; repurchasePending: number; withoutRemarks: number;
  mandatesPending: number | null; sipsRegisteredInCrm: number;
};

export async function loadSipControl(tx: Tx, w: OpsWindow): Promise<SipControl> {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT
      COUNT(*) FILTER (WHERE kind = 'sip_registration' AND received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS reg_rec,
      COUNT(*) FILTER (WHERE kind = 'sip_registration' AND status = 'completed' AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS reg_done,
      COUNT(*) FILTER (WHERE kind = 'sip_registration' AND is_open)::int AS reg_open,
      COUNT(*) FILTER (WHERE kind = 'sip_modification' AND is_open)::int AS mod_open,
      COUNT(*) FILTER (WHERE kind = 'sip_stop' AND received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS stop_req
    FROM f
  `)).rows[0] as Row | undefined;
  const s = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date)::int AS rej,
      COUNT(*) FILTER (WHERE s.recovery_status = 'recovered'
        AND ${istDay(sql`COALESCE(s.recovery_date::timestamptz, s.status_changed_at, s.updated_at)`)} BETWEEN ${w.from}::date AND ${w.to}::date)::int AS done,
      COUNT(*) FILTER (WHERE s.recovery_status IN ${SIP_OPEN})::int AS open_n,
      COUNT(*) FILTER (WHERE s.recovery_status IN ${SIP_OPEN} AND NULLIF(btrim(COALESCE(s.remarks, '')), '') IS NULL)::int AS no_rem
      FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
       ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}
  `)).rows[0] as Row | undefined;
  const x = self ? undefined : (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM transactions t JOIN investors i ON i.id = t.investor_id
        WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.type IN ('sip_stop', 'sip_pause')
          AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date)::int AS stops,
      (SELECT COUNT(*) FROM sips p JOIN investors i ON i.id = p.investor_id
        WHERE p.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
          AND ${istDay(sql`p.created_at`)} BETWEEN ${w.from}::date AND ${w.to}::date)::int AS sips_new,
      (SELECT COUNT(*) FROM mandates m JOIN investors i ON i.id = m.investor_id
        WHERE m.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND m.status = 'pending')::int AS mandates,
      (SELECT COUNT(*) FROM mandates m WHERE m.tenant_id = ${w.tenantId}::uuid)::int AS mandates_any
  `)).rows[0] as Row | undefined;
  return {
    regReceived: num(r?.reg_rec), regCompleted: num(r?.reg_done), regPending: num(r?.reg_open),
    modPending: num(r?.mod_open), stopRequests: num(r?.stop_req), stopConfirmed: num(x?.stops),
    rejected: num(s?.rej), repurchaseDone: num(s?.done), repurchasePending: num(s?.open_n), withoutRemarks: num(s?.no_rem),
    // No mandate row at all means the feed has never carried mandates — unknown, not zero.
    mandatesPending: x && num(x.mandates_any) > 0 ? num(x.mandates) : null,
    sipsRegisteredInCrm: num(x?.sips_new),
  };
}

/* ───────────────────────────── §10–12 rejections ───────────────────────────── */

export type RejectionRow = {
  id: string; investorId: string; client: string; rm: string | null; branch: string | null;
  amount: number; date: string; reason: string | null; followUp: string | null; followUpDate: string | null;
  recovery: string; recoveryLabel: string; repurchase: "completed" | "initiated" | "not_yet" | "not_recoverable";
  pending: number; assignedTo: string | null; ageDays: number; remarks: string | null; pastSla: boolean;
};

export type RejectionDesk = {
  totals: {
    count: number; value: number; recovered: number; recoveredValue: number;
    pendingCount: number; pendingValue: number; withoutRemarks: number; pastSla: number;
    openAll: number; openAllValue: number;
  };
  rows: RejectionRow[];
  more: number;
  reasons: Array<{ key: string; label: string; count: number; value: number; missing?: boolean }>;
  funnel: Array<{ key: string; label: string; count: number; value: number }>;
  recoveryPct: number | null;
  notRecoverable: number;
};

export async function loadRejections(tx: Tx, w: OpsWindow, limit = 100): Promise<RejectionDesk> {
  const self = selfOnly(w);
  const sla = w.t.sipRejectionSlaDays;
  // The working set: rejections received in the period, plus every one still open.
  const inSet = sql`(s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date OR s.recovery_status IN ${SIP_OPEN})`;
  const where = sql`
    WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
      ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}`;
  const base = sql`FROM sip_rejections s JOIN investors i ON i.id = s.investor_id ${where}`;

  const t = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date)::int AS n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date), 0) AS v,
      COUNT(*) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date AND s.recovery_status = 'recovered')::int AS rec_n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date
                                                         AND s.recovery_status = 'recovered'), 0) AS rec_v,
      COUNT(*) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date AND s.recovery_status IN ${SIP_OPEN})::int AS pend_n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.rejection_date BETWEEN ${w.from}::date AND ${w.to}::date
                                                         AND s.recovery_status IN ${SIP_OPEN}), 0) AS pend_v,
      COUNT(*) FILTER (WHERE s.recovery_status IN ${SIP_OPEN} AND NULLIF(btrim(COALESCE(s.remarks, '')), '') IS NULL)::int AS no_rem,
      COUNT(*) FILTER (WHERE s.recovery_status IN ${SIP_OPEN}
                         AND COALESCE(s.status_changed_at, s.created_at) < now() - (${sla} || ' days')::interval)::int AS past_sla,
      COUNT(*) FILTER (WHERE s.recovery_status IN ${SIP_OPEN})::int AS open_all,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.recovery_status IN ${SIP_OPEN}), 0) AS open_all_v
    ${base}
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT s.id, s.investor_id, i.name AS client, rmu.name AS rm, b.name AS branch,
           s.rejection_amount::numeric AS amount, s.rejection_date::text AS date,
           COALESCE(NULLIF(btrim(s.rejection_reason), ''), s.reason_category) AS reason,
           s.recovery_status, s.follow_up_date::text AS follow_up_date, s.remarks,
           au.name AS assigned_to,
           (${w.today}::date - s.rejection_date)::int AS age_days,
           (s.recovery_status IN ${SIP_OPEN}
              AND COALESCE(s.status_changed_at, s.created_at) < now() - (${sla} || ' days')::interval) AS past_sla,
           COUNT(*) OVER () AS total
      FROM sip_rejections s
      JOIN investors i ON i.id = s.investor_id
      LEFT JOIN users rmu ON rmu.id = i.rm_id
      LEFT JOIN branches b ON b.id = i.branch_id
      LEFT JOIN users au ON au.id = s.assigned_rm_id
    ${where} AND ${inSet}
    ORDER BY (s.recovery_status IN ${SIP_OPEN}) DESC, s.rejection_date ASC
    LIMIT ${limit}
  `)).rows as Row[];

  const reasons = (await tx.execute(sql`
    SELECT CASE
             WHEN s.reason_category IS NOT NULL THEN 'cat:' || s.reason_category
             WHEN NULLIF(btrim(COALESCE(s.rejection_reason, '')), '') IS NOT NULL THEN 'txt:' || btrim(s.rejection_reason)
             ELSE 'none'
           END AS k,
           COUNT(*)::int AS n, COALESCE(SUM(s.rejection_amount::numeric), 0) AS v
    ${base} AND ${inSet}
    GROUP BY 1 ORDER BY 2 DESC
  `)).rows as Row[];

  const f = (await tx.execute(sql`
    SELECT
      COUNT(*)::int AS all_n, COALESCE(SUM(s.rejection_amount::numeric), 0) AS all_v,
      COUNT(*) FILTER (WHERE s.recovery_status IN ('client_contacted', 'bank_issue', 'mandate_issue', 'reprocessed', 'recovered'))::int AS c_n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.recovery_status IN ('client_contacted', 'bank_issue', 'mandate_issue', 'reprocessed', 'recovered')), 0) AS c_v,
      COUNT(*) FILTER (WHERE s.recovery_status IN ('bank_issue', 'mandate_issue', 'reprocessed', 'recovered'))::int AS a_n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.recovery_status IN ('bank_issue', 'mandate_issue', 'reprocessed', 'recovered')), 0) AS a_v,
      COUNT(*) FILTER (WHERE s.recovery_status IN ('reprocessed', 'recovered'))::int AS i_n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.recovery_status IN ('reprocessed', 'recovered')), 0) AS i_v,
      COUNT(*) FILTER (WHERE s.recovery_status = 'recovered')::int AS d_n,
      COALESCE(SUM(s.rejection_amount::numeric) FILTER (WHERE s.recovery_status = 'recovered'), 0) AS d_v,
      COUNT(*) FILTER (WHERE s.recovery_status = 'not_recoverable')::int AS nr_n
    ${base} AND ${inSet}
  `)).rows[0] as Row | undefined;

  const reasonRows = reasons.map((r) => {
    const k = String(r.k);
    const missing = k === "none";
    const label = missing ? "Reason not updated"
      : k.startsWith("cat:") ? REASON_LABEL[k.slice(4)] ?? k.slice(4).replace(/_/g, " ")
      : k.slice(4);
    return { key: k, label, count: num(r.n), value: num(r.v), missing };
  });
  const allN = num(f?.all_n);
  return {
    totals: {
      count: num(t?.n), value: num(t?.v), recovered: num(t?.rec_n), recoveredValue: num(t?.rec_v),
      pendingCount: num(t?.pend_n), pendingValue: num(t?.pend_v), withoutRemarks: num(t?.no_rem),
      pastSla: num(t?.past_sla), openAll: num(t?.open_all), openAllValue: num(t?.open_all_v),
    },
    rows: rows.map((r): RejectionRow => {
      const status = String(r.recovery_status);
      const open = ["pending", "client_contacted", "bank_issue", "mandate_issue"].includes(status);
      return {
        id: String(r.id), investorId: String(r.investor_id), client: String(r.client ?? "—"),
        rm: str(r.rm), branch: str(r.branch), amount: num(r.amount), date: String(r.date),
        reason: str(r.reason) ? (REASON_LABEL[String(r.reason)] ?? String(r.reason)) : null,
        followUp: RECOVERY_LABEL[status] ?? status, followUpDate: str(r.follow_up_date),
        recovery: status, recoveryLabel: RECOVERY_LABEL[status] ?? status,
        repurchase: status === "recovered" ? "completed" : status === "reprocessed" ? "initiated"
          : status === "not_recoverable" ? "not_recoverable" : "not_yet",
        pending: open || status === "reprocessed" ? num(r.amount) : 0,
        assignedTo: str(r.assigned_to), ageDays: num(r.age_days), remarks: str(r.remarks), pastSla: r.past_sla === true,
      };
    }),
    more: Math.max(0, (rows.length ? num(rows[0].total) : 0) - rows.length),
    reasons: reasonRows,
    funnel: [
      { key: "rejected", label: "Rejected", count: allN, value: num(f?.all_v) },
      { key: "contacted", label: "Client / RM contacted", count: num(f?.c_n), value: num(f?.c_v) },
      { key: "action", label: "Cause found / action agreed", count: num(f?.a_n), value: num(f?.a_v) },
      { key: "initiated", label: "Repurchase initiated", count: num(f?.i_n), value: num(f?.i_v) },
      { key: "completed", label: "Recovered", count: num(f?.d_n), value: num(f?.d_v) },
    ],
    recoveryPct: allN > 0 ? num(f?.d_n) / allN : null,
    notRecoverable: num(f?.nr_n),
  };
}

