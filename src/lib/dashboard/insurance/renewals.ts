/**
 * Renewals — the command centre, the cycle, retention and the at-risk list.
 *
 * A renewal is DUE on an in-force policy's next_premium_due_date (the form's
 * "Next premium / renewal due"). Single-premium policies have no renewal.
 * "Mark renewed" moves the due date a year (or a frequency period) on and
 * writes the due it cleared to the audit log — the only history of a renewal,
 * and what retention is measured from:
 *
 *   due in a window  = renewals whose due date fell in it and was cleared
 *                      (audit) + policies whose current due still sits in it
 *   renewed          = the first set
 *
 * A renewal keyed as a separate new policy row counts as renewal PREMIUM, but
 * the old row stays due until someone marks it renewed or closes it; the CRM
 * does not link the two rows.
 */

import { sql } from "drizzle-orm";
import { inList, STATUS_IN_FORCE, STATUS_LOST } from "@/lib/insurance/book";
import { num, numOrNull, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

const IN_FORCE = inList(STATUS_IN_FORCE);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const minIso = (a: string, b: string) => (a < b ? a : b);

/* ───────────────────────── §14 command centre ───────────────────────── */

export type RenewalBucket = { key: string; label: string; from: string | null; to: string | null; count: number; premium: number; oldestDays: number | null };

export async function loadRenewalBuckets(tx: Tx, w: InsWindow): Promise<{ buckets: RenewalBucket[]; pastGrace: { count: number; premium: number } }> {
  const r = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT
      COUNT(*) FILTER (WHERE due < ${w.today}::date)::int AS od_n,
      COALESCE(SUM(inst) FILTER (WHERE due < ${w.today}::date), 0) AS od_p,
      MAX(${w.today}::date - due) FILTER (WHERE due < ${w.today}::date) AS od_old,
      COUNT(*) FILTER (WHERE due < ${w.today}::date - grace)::int AS pg_n,
      COALESCE(SUM(inst) FILTER (WHERE due < ${w.today}::date - grace), 0) AS pg_p,
      COUNT(*) FILTER (WHERE due = ${w.today}::date)::int AS t_n,
      COALESCE(SUM(inst) FILTER (WHERE due = ${w.today}::date), 0) AS t_p,
      COUNT(*) FILTER (WHERE due BETWEEN ${w.today}::date + 1 AND ${w.today}::date + 7)::int AS w_n,
      COALESCE(SUM(inst) FILTER (WHERE due BETWEEN ${w.today}::date + 1 AND ${w.today}::date + 7), 0) AS w_p,
      COUNT(*) FILTER (WHERE due BETWEEN ${w.today}::date + 8 AND ${w.today}::date + 15)::int AS f_n,
      COALESCE(SUM(inst) FILTER (WHERE due BETWEEN ${w.today}::date + 8 AND ${w.today}::date + 15), 0) AS f_p,
      COUNT(*) FILTER (WHERE due BETWEEN ${w.today}::date + 16 AND ${w.today}::date + 30)::int AS m_n,
      COALESCE(SUM(inst) FILTER (WHERE due BETWEEN ${w.today}::date + 16 AND ${w.today}::date + 30), 0) AS m_p,
      COUNT(*) FILTER (WHERE due BETWEEN ${w.today}::date + 31 AND ${w.today}::date + 60)::int AS s_n,
      COALESCE(SUM(inst) FILTER (WHERE due BETWEEN ${w.today}::date + 31 AND ${w.today}::date + 60), 0) AS s_p
      FROM pol
     WHERE ${polWhere(w, { nature: false, status: false })} AND status IN (${IN_FORCE}) AND freq <> 'single' AND due IS NOT NULL
  `)).rows[0] as Row | undefined;
  const t = w.today;
  return {
    buckets: [
      { key: "overdue", label: "Overdue", from: null, to: addDays(t, -1), count: num(r?.od_n), premium: num(r?.od_p), oldestDays: numOrNull(r?.od_old) },
      { key: "today", label: "Due today", from: t, to: t, count: num(r?.t_n), premium: num(r?.t_p), oldestDays: null },
      { key: "d7", label: "Next 7 days", from: addDays(t, 1), to: addDays(t, 7), count: num(r?.w_n), premium: num(r?.w_p), oldestDays: null },
      { key: "d15", label: "8–15 days", from: addDays(t, 8), to: addDays(t, 15), count: num(r?.f_n), premium: num(r?.f_p), oldestDays: null },
      { key: "d30", label: "16–30 days", from: addDays(t, 16), to: addDays(t, 30), count: num(r?.m_n), premium: num(r?.m_p), oldestDays: null },
      { key: "d60", label: "31–60 days", from: addDays(t, 31), to: addDays(t, 60), count: num(r?.s_n), premium: num(r?.s_p), oldestDays: null },
    ],
    pastGrace: { count: num(r?.pg_n), premium: num(r?.pg_p) },
  };
}

/* ───────────────────────── §16 retention ───────────────────────── */

const RET_DIM = {
  none: "'all'",
  line: "p.line",
  grp: "p.grp",
  branch: "p.branch_id::text",
  owner: "p.owner_id::text",
  seller: "p.seller_id::text",
  insurer: "p.insurer_key",
  occupation: "p.occupation",
} as const;
export type RetDim = keyof typeof RET_DIM;

export type Retention = { key: string | null; due: number; renewed: number; duePremium: number; renewedPremium: number; policyPct: number | null; premiumPct: number | null };

/**
 * Of the renewals that fell due in [from, min(to, today)], how many were
 * renewed — by count, and separately by premium. A monthly policy's
 * installments each count as one due.
 */
export async function loadRetention(tx: Tx, w: InsWindow, from: string, to: string, dim: RetDim = "none"): Promise<Retention[]> {
  const end = minIso(to, w.today);
  if (end < from) return [];
  const d = sql.raw(RET_DIM[dim]);
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (SELECT * FROM pol WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND freq <> 'single'),
         cleared AS (
           SELECT a.entity_id AS policy_id, NULLIF(a.before->>'nextPremiumDueDate', '')::date AS due
             FROM audit_log a
            WHERE a.tenant_id = ${w.tenantId}::uuid AND a.action = 'insurance.renew' AND a.entity_type = 'insurance_policy'
              AND NULLIF(a.before->>'nextPremiumDueDate', '')::date BETWEEN ${from}::date AND ${end}::date
         ),
         dues AS (
           SELECT p.id, p.inst, TRUE AS renewed, ${d} AS k FROM cleared JOIN p ON p.id = cleared.policy_id
           UNION ALL
           SELECT p.id, p.inst, FALSE, ${d} FROM p
            WHERE p.due BETWEEN ${from}::date AND ${end}::date
              AND p.status IN (${IN_FORCE}, ${inList(STATUS_LOST)})
         )
    SELECT k, COUNT(*)::int AS due, COUNT(*) FILTER (WHERE renewed)::int AS renewed,
           COALESCE(SUM(inst), 0) AS due_p, COALESCE(SUM(inst) FILTER (WHERE renewed), 0) AS ren_p
      FROM dues GROUP BY k
  `)).rows as Row[];
  return rows.map((r) => {
    const due = num(r.due);
    const duePremium = num(r.due_p);
    return {
      key: str(r.k),
      due, renewed: num(r.renewed), duePremium, renewedPremium: num(r.ren_p),
      policyPct: due > 0 ? num(r.renewed) / due : null,
      premiumPct: duePremium > 0 ? num(r.ren_p) / duePremium : null,
    };
  });
}

export const retentionOf = (rows: Retention[], key: string | null = "all") => rows.find((r) => r.key === key) ?? null;

/* ───────────────────────── §15 the renewal cycle ───────────────────────── */

export type RenewalCycle = {
  from: string;
  to: string;
  due: { count: number; premium: number };
  contacted: { count: number; premium: number };
  followUp: { count: number; premium: number };
  renewed: { count: number; premium: number };
  notRenewed: { count: number; premium: number };
};

/**
 * The renewals due from 30 days ago to 30 days ahead, and how far each has
 * got in what the CRM records: a contact (a logged call/visit/message or a
 * completed meeting since 45 days before the due), a follow-up task (the
 * premium-reminder and lapse-recovery recipes), renewed, or not renewed
 * (lapsed / surrendered / cancelled, or past grace).
 */
export async function loadRenewalCycle(tx: Tx, w: InsWindow): Promise<RenewalCycle> {
  const from = addDays(w.today, -30);
  const to = addDays(w.today, 30);
  const r = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (SELECT * FROM pol WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND freq <> 'single'),
         cleared AS (
           SELECT DISTINCT ON (a.entity_id, NULLIF(a.before->>'nextPremiumDueDate', ''))
                  a.entity_id AS policy_id, NULLIF(a.before->>'nextPremiumDueDate', '')::date AS due
             FROM audit_log a
            WHERE a.tenant_id = ${w.tenantId}::uuid AND a.action = 'insurance.renew' AND a.entity_type = 'insurance_policy'
              AND NULLIF(a.before->>'nextPremiumDueDate', '')::date BETWEEN ${from}::date AND ${to}::date
         ),
         cohort AS (
           SELECT p.id, p.investor_id, p.inst, cleared.due, TRUE AS renewed, FALSE AS lost FROM cleared JOIN p ON p.id = cleared.policy_id
           UNION ALL
           SELECT p.id, p.investor_id, p.inst, p.due, FALSE,
                  (p.status IN (${inList(STATUS_LOST)}) OR p.due < ${w.today}::date - p.grace)
             FROM p WHERE p.due BETWEEN ${from}::date AND ${to}::date AND p.status IN (${IN_FORCE}, ${inList(STATUS_LOST)})
         ),
         marked AS (
           SELECT c.*,
                  EXISTS (SELECT 1 FROM activities a WHERE a.tenant_id = ${w.tenantId}::uuid AND a.subject_type = 'investor'
                            AND a.subject_id = c.investor_id AND a.occurred_at >= (c.due - 45))
                  OR EXISTS (SELECT 1 FROM review_meetings m WHERE m.tenant_id = ${w.tenantId}::uuid AND m.investor_id = c.investor_id
                            AND m.status = 'completed' AND m.meeting_date >= (c.due - 45)) AS contacted,
                  EXISTS (SELECT 1 FROM tasks t WHERE t.tenant_id = ${w.tenantId}::uuid AND t.deleted_at IS NULL
                            AND t.type IN ('insurance_premium_followup', 'insurance_lapse_recovery')
                            AND (t.related_investor_id = c.investor_id OR (t.subject_type = 'investor' AND t.subject_id = c.investor_id))
                            AND t.created_at >= (c.due - 45)) AS followed
             FROM cohort c
         )
    SELECT COUNT(*)::int AS due_n, COALESCE(SUM(inst), 0) AS due_p,
           COUNT(*) FILTER (WHERE contacted OR renewed)::int AS con_n, COALESCE(SUM(inst) FILTER (WHERE contacted OR renewed), 0) AS con_p,
           COUNT(*) FILTER (WHERE followed)::int AS fol_n, COALESCE(SUM(inst) FILTER (WHERE followed), 0) AS fol_p,
           COUNT(*) FILTER (WHERE renewed)::int AS ren_n, COALESCE(SUM(inst) FILTER (WHERE renewed), 0) AS ren_p,
           COUNT(*) FILTER (WHERE lost)::int AS lost_n, COALESCE(SUM(inst) FILTER (WHERE lost), 0) AS lost_p
      FROM marked
  `)).rows[0] as Row | undefined;
  const pair = (n: unknown, p: unknown) => ({ count: num(n), premium: num(p) });
  return {
    from, to,
    due: pair(r?.due_n, r?.due_p),
    contacted: pair(r?.con_n, r?.con_p),
    followUp: pair(r?.fol_n, r?.fol_p),
    renewed: pair(r?.ren_n, r?.ren_p),
    notRenewed: pair(r?.lost_n, r?.lost_p),
  };
}

/* ───────────────────────── §17 at risk ───────────────────────── */

export type AtRiskRow = {
  policyId: string; investorId: string; client: string; plan: string; policyNumber: string | null; policyType: string;
  insurer: string | null; premium: number; due: string; daysLeft: number; grace: number; ownerId: string | null;
  lastContact: string | null; claimOpen: boolean;
};

/**
 * Overdue first, then due within 7 days, then the larger premium, then no
 * contact on record — the brief's order, with no score. Due within 30 days.
 */
export async function loadAtRisk(tx: Tx, w: InsWindow, limit = 50): Promise<{ rows: AtRiskRow[]; total: number }> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (SELECT * FROM pol WHERE ${polWhere(w, { nature: false, status: false }, "pol")}
                 AND status IN (${IN_FORCE}) AND freq <> 'single' AND due IS NOT NULL AND due <= ${w.today}::date + 30)
    SELECT p.id, p.investor_id, p.client, p.plan_name, p.policy_number, p.policy_type, p.insurer, p.inst, p.due::text AS due,
           (p.due - ${w.today}::date) AS days_left, p.grace, p.owner_id::text AS owner_id,
           GREATEST(
             (SELECT MAX(a.occurred_at) FROM activities a WHERE a.tenant_id = ${w.tenantId}::uuid AND a.subject_type = 'investor' AND a.subject_id = p.investor_id),
             (SELECT MAX(m.meeting_date) FROM review_meetings m WHERE m.tenant_id = ${w.tenantId}::uuid AND m.investor_id = p.investor_id AND m.status = 'completed')
           ) AS last_contact,
           EXISTS (SELECT 1 FROM insurance_claims c WHERE c.policy_id = p.id
                     AND c.claim_status NOT IN ('settled_fully', 'settled_partially', 'rejected', 'withdrawn')) AS claim_open,
           COUNT(*) OVER () AS total
      FROM p
     ORDER BY (p.due < ${w.today}::date) DESC, (p.due <= ${w.today}::date + 7) DESC, p.inst DESC, p.due ASC
     LIMIT ${limit}
  `)).rows as Row[];
  return {
    total: rows.length ? num(rows[0].total) : 0,
    rows: rows.map((r) => ({
      policyId: String(r.id), investorId: String(r.investor_id), client: String(r.client ?? "—"), plan: String(r.plan_name ?? ""),
      policyNumber: str(r.policy_number), policyType: String(r.policy_type ?? ""), insurer: str(r.insurer), premium: num(r.inst),
      due: String(r.due), daysLeft: num(r.days_left), grace: num(r.grace), ownerId: str(r.owner_id),
      lastContact: r.last_contact ? String(r.last_contact) : null, claimOpen: r.claim_open === true,
    })),
  };
}

/* ───────────────────────── renewal timeline ───────────────────────── */

export type RenewalPointRow = { days: number; premium: number; group: string; client: string; product: string };

/**
 * Every in-force, non-single-premium policy falling due in the next
 * `horizon` days (today included), with its installment and product group —
 * the bubble timeline on Renewals. Largest premiums first, at most `limit`.
 */
export async function loadRenewalTimeline(tx: Tx, w: InsWindow, horizon = 90, limit = 300): Promise<{ rows: RenewalPointRow[]; total: number }> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (SELECT * FROM pol WHERE ${polWhere(w, { nature: false, status: false }, "pol")}
                 AND status IN (${IN_FORCE}) AND freq <> 'single' AND due IS NOT NULL
                 AND due BETWEEN ${w.today}::date AND ${w.today}::date + ${horizon}::int)
    SELECT (p.due - ${w.today}::date)::int AS days, p.inst, p.grp, p.client, p.plan_name, p.policy_type,
           COUNT(*) OVER () AS total
      FROM p
     ORDER BY p.inst DESC
     LIMIT ${limit}
  `)).rows as Row[];
  return {
    total: rows.length ? num(rows[0].total) : 0,
    rows: rows.map((r) => ({
      days: num(r.days), premium: num(r.inst), group: String(r.grp ?? "unclassified"),
      client: String(r.client ?? "—"), product: String(r.plan_name || r.policy_type || ""),
    })),
  };
}

export { addDays };
