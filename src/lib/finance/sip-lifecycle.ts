/**
 * SIP lifetime progress and expiry. SERVER-ONLY.
 *
 * Two gaps this closes.
 *
 * 1. Nothing counted a SIP's LIFETIME installments. `sip-installment-watch.ts`
 *    grids the first six of a new SIP (is the mandate actually working?), which
 *    is a different question from "how far through its term is this?". Without
 *    the second, an expiry reminder says only "this ends soon" — not "35 of 36
 *    done, ₹5,000 a month, renew it", which is the version an RM can act on.
 *
 * 2. Nothing ever ENDED a SIP. The only write to `sips.status` sets 'active';
 *    the daily scanner reads `end_date` to fire reminders and then lets the SIP
 *    sail past it still active. The book therefore only ratchets up, and
 *    `investors.active_sip_amount` — which every SIP figure on the platform
 *    reads — drifts upward forever. `completeExpiredSips()` is the missing pass.
 *
 * Installment counting deliberately uses the TRANSACTION ledger rather than
 * elapsed months: a SIP whose instalments bounced has not completed them, and
 * (end - start) / frequency would say it had.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** Installments per year, by SIP frequency. Mirrors PERIODS_PER_YEAR in
 *  trail-rates.ts — kept in SQL here so the whole roll-up stays one query. */
const PER_YEAR_SQL = `CASE lower(coalesce(s.frequency, 'monthly'))
  WHEN 'weekly' THEN 52
  WHEN 'fortnightly' THEN 26
  WHEN 'quarterly' THEN 4
  WHEN 'yearly' THEN 1
  ELSE 12
END`;

export type SipExpiryRow = {
  sipId: string;
  investorId: string;
  investorName: string;
  pan: string | null;
  folioNumber: string | null;
  schemeName: string | null;
  amcName: string | null;
  amount: number;
  frequency: string;
  startDate: string | null;
  endDate: string | null;
  daysToExpiry: number | null;
  totalInstallments: number | null;
  completedInstallments: number;
  pendingInstallments: number | null;
  lastInstallmentAt: string | null;
  bouncedCount: number;
  rmName: string | null;
  status: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * SIPs expiring within `withinDays`, with lifetime installment progress.
 *
 * `totalInstallments` is null for an open-ended SIP (no end date) — those never
 * expire, so a "pending" count would be fiction. They are excluded from the
 * worklist entirely for the same reason.
 */
export async function loadSipExpiry(tx: Tx, withinDays = 90): Promise<SipExpiryRow[]> {
  const rows = (await tx.execute(sql`
    SELECT s.id, s.investor_id, i.name AS investor_name, i.pan,
           s.folio_number, s.scheme_name, s.amc_name, s.amount::numeric AS amount,
           COALESCE(s.frequency, 'monthly') AS frequency,
           s.start_date, s.end_date, s.status,
           (s.end_date - current_date)::int AS days_to_expiry,
           u.name AS rm_name,
           -- Term length in installments, from the SIP's own dates + frequency.
           CASE WHEN s.start_date IS NOT NULL AND s.end_date IS NOT NULL
                THEN GREATEST(1, ROUND(
                     ((s.end_date - s.start_date)::numeric / 365.0) * ${sql.raw(PER_YEAR_SQL)}
                )::int)
                ELSE NULL END AS total_installments,
           -- Completed = SIP instalments that actually PROCESSED on this folio +
           -- scheme. Counting elapsed months instead would credit bounced ones.
           (SELECT count(*) FROM transactions t
             WHERE t.investor_id = s.investor_id
               AND t.type = 'sip'
               AND t.status IN ('processed', 'successful')
               AND (s.folio_number IS NULL OR t.folio_number = s.folio_number)
               AND (s.scheme_code IS NULL OR t.scheme_code = s.scheme_code)
               AND (s.start_date IS NULL OR t.order_date >= s.start_date)
           )::int AS completed_installments,
           (SELECT max(t.order_date) FROM transactions t
             WHERE t.investor_id = s.investor_id AND t.type = 'sip'
               AND t.status IN ('processed', 'successful')
               AND (s.folio_number IS NULL OR t.folio_number = s.folio_number)
           ) AS last_installment_at,
           (SELECT count(*) FROM sip_rejections r
             WHERE r.investor_id = s.investor_id
               AND (s.folio_number IS NULL OR r.folio_number = s.folio_number)
           )::int AS bounced_count
      FROM sips s
      JOIN investors i ON i.id = s.investor_id AND i.deleted_at IS NULL
      LEFT JOIN users u ON u.id = s.rm_id
     WHERE s.status = 'active'
       AND s.end_date IS NOT NULL
       AND s.end_date >= current_date - interval '30 days'
       AND s.end_date <= current_date + ${sql.raw(String(Math.max(1, Math.min(withinDays, 730))))} * interval '1 day'
     ORDER BY s.end_date ASC
     LIMIT 500
  `)).rows as any[];

  return rows.map((r) => {
    const total = r.total_installments != null ? num(r.total_installments) : null;
    const completed = num(r.completed_installments);
    return {
      sipId: String(r.id),
      investorId: String(r.investor_id),
      investorName: r.investor_name ?? "—",
      pan: r.pan ?? null,
      folioNumber: r.folio_number ?? null,
      schemeName: r.scheme_name ?? null,
      amcName: r.amc_name ?? null,
      amount: num(r.amount),
      frequency: String(r.frequency ?? "monthly"),
      startDate: r.start_date ? String(r.start_date) : null,
      endDate: r.end_date ? String(r.end_date) : null,
      daysToExpiry: r.days_to_expiry != null ? num(r.days_to_expiry) : null,
      totalInstallments: total,
      completedInstallments: completed,
      // Never negative: a stepped-up or extended SIP can process more
      // instalments than its original term implies, and "-3 pending" is worse
      // than nothing.
      pendingInstallments: total != null ? Math.max(0, total - completed) : null,
      lastInstallmentAt: r.last_installment_at ? String(r.last_installment_at) : null,
      bouncedCount: num(r.bounced_count),
      rmName: r.rm_name ?? null,
      status: String(r.status),
    };
  });
}

/**
 * End SIPs whose term has run out.
 *
 * Nothing else does this. The only existing write to `sips.status` sets
 * 'active', so a SIP stays active forever past its end date and every SIP
 * figure that reads `status = 'active'` — the SIP book on the dashboard, the
 * client's "Monthly SIP", family SIP totals, trail forecasts — drifts upward
 * permanently.
 *
 * A grace window matters: the last instalment is often collected a few days
 * after the nominal end date, and closing the SIP the morning after would make
 * that instalment arrive against a completed SIP. Seven days is enough for the
 * registrar's settlement to land.
 *
 * Returns how many were closed; the caller refreshes active_sip_amount.
 */
export async function completeExpiredSips(tx: Tx, graceDays = 7): Promise<number> {
  const res = await tx.execute(sql`
    UPDATE sips
       SET status = 'completed', updated_at = now()
     WHERE status = 'active'
       AND end_date IS NOT NULL
       AND end_date < current_date - ${sql.raw(String(Math.max(0, graceDays)))} * interval '1 day'
    RETURNING id
  `);
  return (res.rows as any[]).length;
}

/** Headline counts for the worklist header. */
export type SipExpirySummary = {
  expiring30: number;
  expiring90: number;
  amount30: number;
  amount90: number;
  overdue: number;
};

export async function loadSipExpirySummary(tx: Tx): Promise<SipExpirySummary> {
  const r = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE end_date BETWEEN current_date AND current_date + 30)::int   AS expiring30,
      count(*) FILTER (WHERE end_date BETWEEN current_date AND current_date + 90)::int   AS expiring90,
      COALESCE(SUM(amount::numeric) FILTER (WHERE end_date BETWEEN current_date AND current_date + 30), 0) AS amount30,
      COALESCE(SUM(amount::numeric) FILTER (WHERE end_date BETWEEN current_date AND current_date + 90), 0) AS amount90,
      count(*) FILTER (WHERE end_date < current_date)::int                                AS overdue
      FROM sips
     WHERE status = 'active' AND end_date IS NOT NULL
  `)).rows[0] as any;
  return {
    expiring30: num(r?.expiring30),
    expiring90: num(r?.expiring90),
    amount30: num(r?.amount30),
    amount90: num(r?.amount90),
    overdue: num(r?.overdue),
  };
}
