/**
 * Cockpit chart data — AUM breakup, monthly flows, SIP business, client mix and
 * the compliance-gap table. SERVER-ONLY (imports the DB).
 *
 * Every loader here is ONE query. These render together in a single section, so
 * a per-card query pattern would mean a dozen sequential round-trips before the
 * section paints; the callers run them with Promise.all inside one transaction.
 *
 * Asset-class bucketing reuses `CLASS_CASE` from portfolio/intelligence rather
 * than restating the ILIKE ladder. There must be exactly one definition of what
 * counts as Equity in this codebase — a second copy silently drifts and then two
 * screens disagree about the same book, which is the bug this import prevents.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { CLASS_CASE } from "@/lib/portfolio/intelligence";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "2026-04" → "Apr 26" for a compact axis tick. */
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[m - 1]} ${String(y).slice(2)}`;
}

// ── AUM breakup by asset class ──────────────────────────────────────────────

export type AumSlice = { label: string; value: number; pct: number };

export async function loadAumBreakup(tx: Tx): Promise<AumSlice[]> {
  const rows = (await tx.execute(sql`
    SELECT ${sql.raw(CLASS_CASE)} AS label,
           COALESCE(SUM(COALESCE((s->>'value')::numeric, 0)), 0) AS value
      FROM folios f
      JOIN investors i ON i.id = f.investor_id AND i.deleted_at IS NULL,
           jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) s
     GROUP BY 1
     ORDER BY value DESC
  `)).rows as Array<{ label: string; value: string }>;

  const total = rows.reduce((a, r) => a + num(r.value), 0);
  return rows
    .filter((r) => num(r.value) > 0)
    .map((r) => ({
      label: r.label,
      value: num(r.value),
      pct: total > 0 ? Math.round((num(r.value) / total) * 1000) / 10 : 0,
    }));
}

// ── Monthly flows (the "MIS" area chart) ────────────────────────────────────

export type FlowPoint = { month: string; inflow: number; outflow: number; net: number };

export async function loadMonthlyFlows(tx: Tx, months = 6): Promise<FlowPoint[]> {
  const rows = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', order_date), 'YYYY-MM') AS period,
           COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'inflow'), 0)  AS inflow,
           COALESCE(SUM(amount::numeric) FILTER (WHERE direction = 'outflow'), 0) AS outflow
      FROM transactions
     WHERE status IN ('processed', 'successful')
       AND order_date >= date_trunc('month', current_date) - ${sql.raw(String(months - 1))} * interval '1 month'
     GROUP BY 1
     ORDER BY 1
  `)).rows as Array<{ period: string; inflow: string; outflow: string }>;

  return rows.map((r) => {
    const inflow = num(r.inflow);
    const outflow = num(r.outflow);
    // Outflow is plotted POSITIVE (it is a magnitude, not a debit) and netflow
    // carries the sign. Plotting outflow negative would put two different
    // meanings on one axis and make the crossover unreadable.
    return { month: monthLabel(r.period), inflow, outflow, net: inflow - outflow };
  });
}

// ── SIP business (started / closed / running) ───────────────────────────────

export type SipPoint = { month: string; started: number; closed: number; running: number };

/**
 * SIPs started and ended per month, plus the running book at each month end.
 *
 * `running` is a cumulative count derived from start/end dates rather than from
 * today's `status` column, because status is a CURRENT flag — using it would
 * draw a flat line at today's value across every past month.
 */
export async function loadSipBusiness(tx: Tx, months = 6): Promise<SipPoint[]> {
  const rows = (await tx.execute(sql`
    WITH span AS (
      SELECT generate_series(
        date_trunc('month', current_date) - ${sql.raw(String(months - 1))} * interval '1 month',
        date_trunc('month', current_date),
        interval '1 month'
      )::date AS m
    )
    SELECT to_char(span.m, 'YYYY-MM') AS period,
           (SELECT count(*) FROM sips s
             WHERE s.start_date >= span.m AND s.start_date < span.m + interval '1 month')::int AS started,
           (SELECT count(*) FROM sips s
             WHERE s.end_date >= span.m AND s.end_date < span.m + interval '1 month')::int AS closed,
           (SELECT count(*) FROM sips s
             WHERE s.start_date < span.m + interval '1 month'
               AND (s.end_date IS NULL OR s.end_date >= span.m + interval '1 month'))::int AS running
      FROM span
     ORDER BY 1
  `)).rows as Array<{ period: string; started: number; closed: number; running: number }>;

  return rows.map((r) => ({
    month: monthLabel(r.period),
    started: num(r.started),
    closed: num(r.closed),
    running: num(r.running),
  }));
}

// ── Client mix ──────────────────────────────────────────────────────────────

export type ClientStat = { label: string; count: number; tone: string; href: string };

export async function loadClientStats(tx: Tx): Promise<ClientStat[]> {
  const r = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'active')::int                                    AS active,
      count(*) FILTER (WHERE status IN ('dormant', 'inactive'))::int                    AS dormant,
      count(*) FILTER (WHERE status = 'redemption_risk')::int                           AS at_risk,
      count(*) FILTER (WHERE family_id IS NOT NULL)::int                                AS in_family,
      count(*) FILTER (WHERE created_at >= current_date - interval '30 days')::int      AS new_30d,
      count(*) FILTER (WHERE COALESCE(aum::numeric, 0) > 0)::int                        AS funded
      FROM investors
     WHERE deleted_at IS NULL AND merged_into_id IS NULL
  `)).rows[0] as any;

  return [
    { label: "Active", count: num(r?.active), tone: "emerald", href: "/dashboard/investors?status=active" },
    { label: "Funded", count: num(r?.funded), tone: "cyan", href: "/dashboard/investors" },
    { label: "In a family", count: num(r?.in_family), tone: "violet", href: "/dashboard/families" },
    { label: "New (30d)", count: num(r?.new_30d), tone: "blue", href: "/dashboard/investors" },
    { label: "Dormant", count: num(r?.dormant), tone: "amber", href: "/dashboard/investors?status=dormant" },
    { label: "Redemption risk", count: num(r?.at_risk), tone: "rose", href: "/dashboard/investors?status=redemption_risk" },
  ];
}

// ── Compliance / data-completeness gaps ─────────────────────────────────────

export type ComplianceRow = { label: string; missing: number; total: number };

/**
 * How much of the book is missing each compliance-relevant field.
 *
 * Reported as MISSING out of total, not "active out of total". The reference
 * design highlighted a count whose meaning flipped between rows; a gap table is
 * only actionable if every number means the same thing — here, always "how many
 * still need this".
 */
export async function loadComplianceGaps(tx: Tx): Promise<ComplianceRow[]> {
  const r = (await tx.execute(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE pan IS NULL OR pan = '')::int                                      AS pan,
      count(*) FILTER (WHERE kyc_status IS DISTINCT FROM 'verified')::int                       AS kyc,
      count(*) FILTER (WHERE dob IS NULL)::int                                                  AS dob,
      count(*) FILTER (WHERE email IS NULL OR email = '')::int                                  AS email,
      count(*) FILTER (WHERE phone IS NULL OR phone = '')::int                                  AS mobile,
      count(*) FILTER (WHERE nominee_name IS NULL OR nominee_name = '')::int                    AS nominee,
      count(*) FILTER (WHERE bank_account_masked IS NULL OR bank_account_masked = '')::int      AS bank,
      count(*) FILTER (WHERE bank_ifsc IS NULL OR bank_ifsc = '')::int                          AS ifsc,
      count(*) FILTER (WHERE tax_status IS NULL OR tax_status = '')::int                        AS tax_status,
      count(*) FILTER (WHERE risk_profile IS NULL)::int                                         AS risk_profile,
      count(*) FILTER (WHERE pan_aadhaar_link_status IS DISTINCT FROM 'linked')::int            AS pan_aadhaar
      FROM investors
     WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed'
  `)).rows[0] as any;

  const total = num(r?.total);
  const rows: ComplianceRow[] = [
    { label: "PAN", missing: num(r?.pan), total },
    { label: "KYC verified", missing: num(r?.kyc), total },
    { label: "PAN–Aadhaar link", missing: num(r?.pan_aadhaar), total },
    { label: "Nominee", missing: num(r?.nominee), total },
    { label: "Bank account", missing: num(r?.bank), total },
    { label: "Bank IFSC", missing: num(r?.ifsc), total },
    { label: "Risk profile", missing: num(r?.risk_profile), total },
    { label: "Date of birth", missing: num(r?.dob), total },
    { label: "Email", missing: num(r?.email), total },
    { label: "Mobile", missing: num(r?.mobile), total },
    { label: "Tax status", missing: num(r?.tax_status), total },
  ];
  // Worst gap first — the table is a worklist, so the top row should be the one
  // to act on, not whichever field happened to be declared first.
  return rows.sort((a, b) => b.missing - a.missing);
}
