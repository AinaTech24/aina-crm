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

/** What one expiry pass did. `closed` is the only figure that moves the book. */
export type SipExpiryOutcome = {
  /** Term over AND the instalments genuinely stopped — closed. */
  closed: number;
  /** Term over on paper, but instalments are STILL arriving. Left active. */
  keptRenewed: number;
  /** Term over, but we hold no instalment history for the folio, so cessation
   *  cannot be established either way. Left active. */
  keptUnknown: number;
};

/**
 * End SIPs whose term has run out AND that have actually stopped collecting.
 *
 * Nothing else does this. The only other write to `sips.status` sets 'active',
 * so a SIP stays active forever past its end date and every SIP figure that
 * reads `status = 'active'` — the SIP book on the dashboard, the client's
 * "Monthly SIP", family SIP totals, trail forecasts — drifts upward
 * permanently.
 *
 * `end_date` ALONE IS NOT EVIDENCE THAT A SIP ENDED. It records the term the
 * investor originally registered for, and in India that term is routinely
 * extended or renewed at the AMC without a fresh registration row — so the
 * registrar keeps collecting while our `end_date` stays at the original value.
 * A perpetual SIP often carries an arbitrary far-past or placeholder date too.
 *
 * Closing on the date alone therefore deletes live SIPs from the book. It did:
 * the first run of this pass closed 775 SIPs worth ₹1.59 Cr/month for one firm,
 * and 137 of them (₹0.36 Cr) had collected an instalment within the previous
 * 45 days — including a ₹2.35 Lakh/month SIP whose `end_date` said 2021 and
 * whose last instalment was three weeks earlier. The firm watched its SIP book
 * fall by a quarter overnight.
 *
 * So a SIP is closed only on POSITIVE evidence that it stopped:
 *   1. its term is over (past `end_date`, plus a grace window — the final
 *      instalment often settles a few days late, and closing the morning after
 *      would land it against a completed SIP), AND
 *   2. we actually hold instalment history for that folio, AND
 *   3. nothing has been collected on it for `quietDays`.
 *
 * When (2) fails we cannot tell a finished SIP from one whose transaction feed
 * we never received — and this platform routinely holds only part of a firm's
 * feed — so the SIP stays active and is counted in `keptUnknown`. Overstating a
 * book slightly, visibly, beats silently erasing live SIPs from it.
 *
 * The caller refreshes `active_sip_amount` afterwards.
 */
export async function completeExpiredSips(
  tx: Tx,
  graceDays = 7,
  quietDays = 120
): Promise<SipExpiryOutcome> {
  const grace = sql.raw(String(Math.max(0, graceDays)));
  const quiet = sql.raw(String(Math.max(0, quietDays)));

  // Last instalment per folio, computed once. RLS scopes it to the tenant, the
  // same way the UPDATE below is scoped.
  const lastInstalment = sql`
    SELECT folio_id, max(order_date) AS last_sip
      FROM transactions
     WHERE type = 'sip' AND folio_id IS NOT NULL
     GROUP BY folio_id`;

  const expired = sql`
    s.status = 'active'
    AND s.end_date IS NOT NULL
    AND s.end_date < current_date - ${grace} * interval '1 day'`;

  const res = await tx.execute(sql`
    WITH life AS (${lastInstalment})
    UPDATE sips s
       SET status = 'completed', updated_at = now()
      FROM life l
     WHERE ${expired}
       -- INNER join on purpose: a folio with no instalment history never
       -- matches, so "we have no data" can never close a SIP.
       AND l.folio_id = s.folio_id
       AND l.last_sip < current_date - ${quiet} * interval '1 day'
    RETURNING s.id
  `);

  // What we deliberately left alone, so the caller can say so out loud rather
  // than let the book move without explanation.
  const kept = (await tx.execute(sql`
    WITH life AS (${lastInstalment})
    SELECT
      count(*) FILTER (WHERE l.folio_id IS NOT NULL)::int AS kept_renewed,
      count(*) FILTER (WHERE l.folio_id IS NULL)::int     AS kept_unknown
      FROM sips s LEFT JOIN life l ON l.folio_id = s.folio_id
     WHERE ${expired}
  `)).rows[0] as any;

  return {
    closed: (res.rows as any[]).length,
    keptRenewed: num(kept?.kept_renewed),
    keptUnknown: num(kept?.kept_unknown),
  };
}

/** The remark that marks a registration as a transfer, not a SIP. Imports
 *  check for it so a later registrar report cannot bring the row back. */
export const NOT_A_SIP_REMARK = "Not a SIP: an STP/SWP registration — money leaves this scheme each month";

/**
 * Take STP and SWP registrations out of the SIP book.
 *
 * The registrar's "systematic registrations" report (KFintech MFSD243/313,
 * CAMS WBR49) lists SIPs, STPs and SWPs together, and they all imported as
 * SIPs. An STP out of a liquid fund then counted as a SIP INTO it: on Nimesh C
 * Shah Financial Services, 225 such rows were Rs 68.28 L of a Rs 1.10 Cr
 * "SIP book" — e.g. Rs 2,00,000 a month leaving Nippon Ultra Short Duration
 * for an equity fund, booked as a Rs 2 L SIP.
 *
 * Positive evidence only, from the transaction ledger, on the same folio and
 * scheme code: at least two OUTFLOWS of the registered amount (within 1%) and
 * not a single SIP instalment, ever. (CAMS books an STP-out as a payout from
 * the source scheme and the matching STP-in as a "sip" into the TARGET one, so
 * the source scheme itself never shows a SIP.) A SIP brings money in; a scheme that only
 * ever sends the instalment out is the source of a transfer or withdrawal. A
 * registration with no transactions at all is left alone — no evidence either
 * way.
 *
 * Marked 'stopped' with {@link NOT_A_SIP_REMARK}; the caller refreshes
 * `active_sip_amount`.
 */
export async function markSystematicTransfers(tx: Tx, tenantId: string): Promise<number> {
  // ONE pass over the firm's transactions, joined to its active SIPs on
  // (folio, scheme code). `transactions` has no folio index, so a per-SIP
  // subquery rescanned the whole ledger for every SIP — on a firm with
  // ~730k transactions that ran past the 30-second statement limit.
  const res = await tx.execute(sql`
    WITH cand AS (
      SELECT s.id, s.folio_number, s.scheme_code, s.amount
        FROM sips s
       WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'active' AND COALESCE(s.amount, 0) > 0
    ), ev AS (
      SELECT c.id,
             bool_or(x.type = 'sip') AS has_sip,
             count(*) FILTER (
               WHERE x.direction = 'outflow' AND x.amount BETWEEN c.amount * 0.99 AND c.amount * 1.01
             ) AS same_amount_outflows
        FROM cand c
        JOIN transactions x
          ON x.tenant_id = ${tenantId}::uuid
         AND x.folio_number = c.folio_number
         -- CAMS writes the scheme code with its AMC letter(s) in the feed
         -- ("P1746") and without them in the registration report ("1746").
         AND (x.scheme_code = c.scheme_code
              OR (length(x.scheme_code) BETWEEN length(c.scheme_code) + 1 AND length(c.scheme_code) + 2
                  AND right(x.scheme_code, length(c.scheme_code)) = c.scheme_code
                  AND left(x.scheme_code, 1) ~ '[A-Za-z]'))
       GROUP BY c.id
    )
    UPDATE sips s
       SET status = 'stopped', remarks = ${NOT_A_SIP_REMARK}, updated_at = now()
      FROM ev
     WHERE s.id = ev.id AND NOT ev.has_sip AND ev.same_amount_outflows >= 2
    RETURNING s.id
  `);
  return res.rows.length;
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
