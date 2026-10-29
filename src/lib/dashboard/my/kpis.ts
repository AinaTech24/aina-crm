/**
 * §1 My business KPIs, §3 target meters, §21 monthly summary, §22 FY scorecard.
 * SERVER-ONLY.
 *
 * ── The one distinction the whole strip rests on ────────────────────────────
 *
 *   stock — a balance right now (AUM, SIP book). It does not belong to the
 *           selected period. Its month-on-month change is mostly the market.
 *   flow  — money that moved DURING the period (investment, redemption, new
 *           SIP, premium, new clients), against the previous corresponding one.
 *
 * Treating AUM movement as net business is the classic error, and the brief
 * calls it out by name ("Do not treat AUM movement as net business"). Every
 * tile here declares which kind it is and the UI labels the comparison
 * accordingly.
 *
 * ── Why AUM's "previous month" can read Data unavailable ────────────────────
 *
 * AUM a month ago is units x NAV a month ago. It cannot be recomputed today;
 * it has to have been recorded. `rm_snapshots` records it nightly from
 * migration 0217 onward, so a firm that has just upgraded sees "—" with an
 * explanation for the first month and a real figure after that. The rejected
 * alternative — AUM-now minus net flow — credits the RM with every point the
 * market moved, which is precisely the lie the stock/flow split exists to stop.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { formatDate } from "@/lib/format";

/** A raw SQL result row. Postgres hands numerics back as strings, so every
 *  field goes through num() / numOrNull() before it is used. */
type Row = Record<string, unknown>;
import {
  clientsHref, clientsWhere, clientsWhereOn, clientRecordsWhereOn, delta,
  onboardedDateSql, onboardedInSql,
  loadBookTargets, num, premiumMatch, snapshotSource, staffMatch,
  staffParam, type Delta, type MyWindow, type TargetKey,
} from "./window";
import { entriesHref, loadBookedByMonth, loadBookedFlows } from "./booked";

export type MyTarget = {
  /** The FY target for this metric. */
  value: number;
  /** FY-to-date achieved / target. */
  pct: number;
  /**
   * 0..1 through the FY, so "50%" can be read as ahead or behind. NULL for a
   * balance (AUM, SIP book): a closing target is not reached a twelfth at a
   * time, so pacing it against the calendar would call a book "behind" every
   * April and "ahead" every March for reasons that have nothing to do with it.
   */
  pace: number | null;
};

export type MyKpi = {
  key:
    | "aum" | "sip_book" | "gross_sip" | "sip_stop" | "net_sip"
    | "gross_investment" | "redemption" | "net_business" | "new_clients" | "insurance"
    | "meetings";
  label: string;
  kind: "stock" | "flow";
  format: "currency" | "count";
  /** null = GENUINELY UNKNOWN (the source table is empty). 0 = a real zero. */
  value: number | null;
  compare: Delta;
  /** What `compare` is measured against, in words. */
  compareLabel: string;
  /** FY-to-date, shown beside a shorter selected period. */
  fytd: number | null;
  target: MyTarget | null;
  /** At most two supporting figures. More than that and the tile stops being a tile. */
  notes: Array<{ label: string; value: string }>;
  href: string;
  /** True when a RISE is the bad direction. */
  inverse?: boolean;
};

export async function loadMyKpis(tx: Tx, w: MyWindow): Promise<MyKpi[]> {
  // ── Stock: what my book is worth right now ────────────────────────────────
  const live = (await tx.execute(sql`
    SELECT COALESCE(SUM(aum::numeric), 0)               AS aum,
           COALESCE(SUM(active_sip_amount::numeric), 0) AS sip_book,
           COUNT(*)::int                                AS clients,
           COUNT(*) FILTER (WHERE active_sip_amount::numeric > 0)::int AS sip_clients
      FROM investors
     WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Row | undefined;

  // ── My recorded history, for the month-on-month lines ─────────────────────
  //    Nearest real snapshot to 30 days back, not an exact date match, so a
  //    night the worker missed does not blank the comparison.
  const hist = (await tx.execute(sql`
    SELECT snapshot_date, aum::numeric AS aum, monthly_sip::numeric AS sip
      FROM ${snapshotSource(w.scope)}
       AND snapshot_date >= current_date - interval '45 days'
       AND snapshot_date < current_date
     ORDER BY snapshot_date ASC
  `)).rows as Array<{ snapshot_date: string; aum: string; sip: string }>;

  const monthAgoTs = Date.now() - 30 * 864e5;
  let momRow: (typeof hist)[number] | null = null;
  let bestGap = Infinity;
  for (const h of hist) {
    const gap = Math.abs(new Date(String(h.snapshot_date)).getTime() - monthAgoTs);
    if (gap < bestGap) { bestGap = gap; momRow = h; }
  }
  // More than 12 days off "a month ago" is not a month-on-month comparison.
  if (bestGap > 12 * 864e5) momRow = null;

  // ── Flow: business BOOKED on my book, three windows in one pass ───────────
  //    Business Entries, every product (lib/dashboard/my/booked.ts) — not the
  //    RTA ledger. SIP added and stopped are booked SIP and SIP-stop lines at
  //    their monthly equivalent.
  const booked = await loadBookedFlows(tx, w.scope, {
    cur: { from: w.from, to: w.to },
    prev: { from: w.prevFrom, to: w.prevTo },
    fy: { from: w.fyStart, to: w.to },
  });
  const bc = booked.flows.cur;
  const bp = booked.flows.prev;
  const bf = booked.flows.fy;

  // ── New clients on my book — by onboarding date, never created_at ─────────
  const clients = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${onboardedInSql({ from: w.from, to: w.to }, "i")})::int         AS cur,
      COUNT(*) FILTER (WHERE ${onboardedInSql({ from: w.prevFrom, to: w.prevTo }, "i")})::int AS prev,
      COUNT(*) FILTER (WHERE ${onboardedInSql({ from: w.fyStart, to: w.to }, "i")})::int      AS fy
      FROM investors i
     WHERE ${clientRecordsWhereOn("i", w.scope)}
  `)).rows[0] as Row | undefined;

  // ── Insurance booked by the book. NEW premium is cover that STARTED in the period;
  //    RENEWAL premium is premium COLLECTED in the period (last_premium_date)
  //    on cover that started before it. The first version defined renewal as
  //    "started in the period AND started before this FY" — two conditions
  //    that cannot both hold inside the current year, so renewal read ₹0.
  const ins = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(annual_premium) FILTER (WHERE cur), 0)                AS cur,
      COALESCE(SUM(annual_premium) FILTER (WHERE prev), 0)               AS prev,
      COALESCE(SUM(annual_premium) FILTER (WHERE fy), 0)                 AS fy,
      COALESCE(SUM(annual_premium) FILTER (WHERE cur), 0)                AS new_cur,
      COALESCE(SUM(annual_premium) FILTER (WHERE renewed), 0)            AS renew_cur,
      COUNT(*)::int AS has_any
    FROM (
      SELECT annual_premium::numeric AS annual_premium,
             (policy_start_date >= ${w.from}::date     AND policy_start_date <= ${w.to}::date)     AS cur,
             (policy_start_date >= ${w.prevFrom}::date AND policy_start_date <= ${w.prevTo}::date) AS prev,
             (policy_start_date >= ${w.fyStart}::date  AND policy_start_date <= ${w.to}::date)     AS fy,
             (policy_start_date < ${w.from}::date
              AND last_premium_date >= ${w.from}::date AND last_premium_date <= ${w.to}::date) AS renewed
        FROM insurance_policies
       WHERE ${premiumMatch(w)}
         AND status NOT IN ('lapsed','surrendered','cancelled')
    ) p
  `)).rows[0] as Row | undefined;

  // ── Meetings HELD (new + review), for the branch strip's KPI 10 ─────────
  //    Staff facts: meetings the book's people held, whoever the client was.
  const meet = w.scope.kind === "branch"
    ? ((await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE cur)::int                          AS cur,
          COUNT(*) FILTER (WHERE prev)::int                         AS prev,
          COUNT(*) FILTER (WHERE fy)::int                           AS fy,
          COUNT(*) FILTER (WHERE cur AND category = 'new')::int    AS new_cur,
          COUNT(*) FILTER (WHERE cur AND category = 'review')::int AS review_cur,
          (SELECT COUNT(*)::int FROM review_meetings WHERE ${staffMatch("rm_id", w)}) AS any_ever
        FROM (
          SELECT category,
                 (meeting_date >= ${w.from}::date     AND meeting_date < (${w.to}::date + 1))     AS cur,
                 (meeting_date >= ${w.prevFrom}::date AND meeting_date < (${w.prevTo}::date + 1)) AS prev,
                 (meeting_date >= ${w.fyStart}::date  AND meeting_date < (${w.to}::date + 1))     AS fy
            FROM review_meetings
           WHERE ${staffMatch("rm_id", w)} AND status = 'completed'
        ) m
      `)).rows[0] as Row | undefined)
    : null;

  // ── FY targets for this book ──────────────────────────────────────────────
  const targetOf = await loadBookTargets(tx, w);

  /** No target set, or nothing measured — show neither, rather than a fake 0%. */
  const target = (key: TargetKey, achieved: number | null, stock = false): MyTarget | null => {
    const value = targetOf(key);
    if (!value || achieved == null) return null;
    return { value, pct: achieved / value, pace: stock ? null : w.fyPace };
  };
  /** "My AUM" / "Branch AUM" / plain "AUM" when neither word is true. */
  const own = (label: string) => (w.possessive ? `${w.possessive} ${label}` : label.charAt(0).toUpperCase() + label.slice(1));

  // A firm that has never confirmed a business entry has no booked figure:
  // unknown ("—"), not ₹0. Once it has, an empty period is a real ₹0.
  const hasBooked = booked.ever;
  const hasPolicies = num(ins?.has_any) > 0;

  const aum = num(live?.aum);
  const sipBook = num(live?.sip_book);
  const sipClients = num(live?.sip_clients);

  const grossSipCur = hasBooked ? bc.newSip : null;
  const sipStopCur = hasBooked ? bc.stoppedSip : null;
  const netSipCur = hasBooked ? bc.netSip : null;
  const netSipFy = hasBooked ? bf.netSip : null;
  const grossCur = hasBooked ? bc.gross : null;
  const redCur = hasBooked ? bc.redemption : null;
  const netCur = hasBooked ? bc.net : null;
  const netFy = hasBooked ? bf.net : null;
  const entries = entriesHref(w.scope, w.from, w.to);

  const money = (n: number) => n;
  const PREV_PERIOD = "vs previous period";
  const PREV_MONTH = "vs a month ago";

  return [
    {
      key: "aum",
      label: own("AUM"),
      kind: "stock",
      format: "currency",
      value: aum,
      compare: delta(aum, momRow ? num(momRow.aum) : null),
      compareLabel: PREV_MONTH,
      fytd: null,
      target: target("aum", aum, true),
      notes: [
        { label: "Clients", value: String(num(live?.clients)) },
        // Named so nobody reads the tile's own delta as sales.
        { label: "Moves with the market, not only with sales", value: "" },
      ],
      href: clientsHref(w.scope, "sort=aum"),
    },
    {
      key: "sip_book",
      label: own("SIP book"),
      kind: "stock",
      format: "currency",
      value: sipBook,
      compare: delta(sipBook, momRow ? num(momRow.sip) : null),
      compareLabel: PREV_MONTH,
      fytd: null,
      // A balance against a closing target: current book / target, unpaced.
      target: target("sip_book", sipBook, true),
      notes: [
        { label: "SIP clients", value: String(sipClients) },
        { label: "Average SIP", value: sipClients > 0 ? String(Math.round(sipBook / sipClients)) : "" },
      ],
      href: "/dashboard/sips",
    },
    {
      key: "gross_sip",
      label: "Gross SIP added",
      kind: "flow",
      format: "currency",
      value: grossSipCur,
      compare: hasBooked ? delta(bc.newSip, bp.newSip) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasBooked ? bf.newSip : null,
      target: null,
      notes: [{ label: "SIPs booked", value: hasBooked ? String(bc.newSipCount) : "" }],
      href: entries,
    },
    {
      key: "sip_stop",
      label: "SIP stopped",
      kind: "flow",
      format: "currency",
      value: sipStopCur,
      compare: hasBooked ? delta(bc.stoppedSip, bp.stoppedSip) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasBooked ? bf.stoppedSip : null,
      target: null,
      inverse: true,
      notes: [{ label: "Stops booked", value: hasBooked ? String(bc.stoppedSipCount) : "" }],
      href: entries,
    },
    {
      key: "net_sip",
      label: "Net SIP",
      kind: "flow",
      format: "currency",
      value: netSipCur,
      compare: hasBooked ? delta(bc.netSip, bp.netSip) : null,
      compareLabel: PREV_PERIOD,
      fytd: netSipFy,
      target: target("net_sip", netSipFy),
      notes: [{ label: "Gross added − stopped", value: "" }],
      href: entries,
    },
    {
      key: "gross_investment",
      label: "Gross investment",
      kind: "flow",
      format: "currency",
      value: grossCur,
      compare: hasBooked ? delta(bc.gross, bp.gross) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasBooked ? bf.gross : null,
      target: null,
      notes: [{ label: "Booked, all products", value: "" }],
      href: entries,
    },
    {
      key: "redemption",
      label: "Redemption",
      kind: "flow",
      format: "currency",
      value: redCur,
      compare: hasBooked ? delta(bc.redemption, bp.redemption) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasBooked ? bf.redemption : null,
      target: null,
      inverse: true,
      notes: [{ label: "Clients", value: hasBooked ? String(bc.redeemingClients) : "" }],
      href: entries,
    },
    {
      key: "net_business",
      label: "Net business",
      kind: "flow",
      format: "currency",
      value: netCur,
      compare: hasBooked ? delta(bc.net, bp.net) : null,
      compareLabel: PREV_PERIOD,
      fytd: netFy,
      target: target("net_business", netFy),
      notes: [{ label: "Gross investment − redemption", value: "" }],
      href: entries,
    },
    {
      key: "new_clients",
      label: "New clients",
      kind: "flow",
      format: "count",
      value: num(clients?.cur),
      compare: delta(num(clients?.cur), num(clients?.prev)),
      compareLabel: PREV_PERIOD,
      fytd: num(clients?.fy),
      target: target("new_clients", num(clients?.fy)),
      notes: [],
      href: clientsHref(w.scope, "sort=created&dir=desc"),
    },
    {
      key: "insurance",
      label: "Insurance business",
      kind: "flow",
      format: "currency",
      value: hasPolicies ? money(num(ins?.cur)) : null,
      compare: hasPolicies ? delta(num(ins?.cur), num(ins?.prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasPolicies ? num(ins?.fy) : null,
      target: target("insurance", hasPolicies ? num(ins?.fy) : null),
      // The headline is NEW premium (what the insurance target is set on);
      // renewals and the total sit underneath, as the briefs ask.
      notes: hasPolicies
        ? [
            { label: "Renewal premium", value: String(num(ins?.renew_cur)) },
            { label: "Total premium", value: String(num(ins?.new_cur) + num(ins?.renew_cur)) },
          ]
        : [],
      href: "/dashboard/insurance",
    },
    // KPI 10 on the branch brief; the personal brief has no meetings tile.
    ...(meet
      ? [{
          key: "meetings" as const,
          label: "Meetings",
          kind: "flow" as const,
          format: "count" as const,
          // Nothing ever logged is unknown, not zero meetings held.
          value: num(meet.any_ever) > 0 ? num(meet.cur) : null,
          compare: num(meet.any_ever) > 0 ? delta(num(meet.cur), num(meet.prev)) : null,
          compareLabel: PREV_PERIOD,
          fytd: num(meet.any_ever) > 0 ? num(meet.fy) : null,
          target: target("meetings", num(meet.any_ever) > 0 ? num(meet.fy) : null),
          notes: num(meet.any_ever) > 0
            ? [
                { label: "New", value: String(num(meet.new_cur)) },
                { label: "Review", value: String(num(meet.review_cur)) },
              ]
            : [],
          href: `/dashboard/review-meetings?rm=${staffParam(w)}&status=completed`,
        }]
      : []),
  ];
}

/* ─────────────────────────── §3 target meters ─────────────────────────── */

export type TargetMeter = {
  key: string;
  label: string;
  format: "currency" | "count";
  /** null = no target to compare with. NOT 0 — see `missing` for why. */
  target: number | null;
  actual: number;
  /** actual − target. Negative is the gap still to close. */
  variance: number | null;
  pct: number | null;
  /** 0..1 through the FY, or NULL when the target is already phased or is a
   *  balance — see MyTarget.pace. */
  pace: number | null;
  /** Why `target` is null, in the reader's words: "Not set" (nobody entered
   *  one) or "Not phased" (an annual target the firm has chosen not to spread
   *  across shorter periods). Two different statements; neither is 0%. */
  missing?: string;
  /** The annual target a phased one was derived from, for the tooltip. */
  annual?: number | null;
  /** A balance (AUM, SIP book): compared as it stands, never phased. */
  stock?: boolean;
  href: string;
};

/**
 * How a horizon's target is derived from the ANNUAL one.
 *
 *   undefined  the personal cockpit's view — FY-to-date against the annual
 *              target, with the pace notch showing where "on track" sits.
 *   number     a phased share of the annual target for the horizon (the branch
 *              toggle under linear phasing). The phased target IS the
 *              expectation, so no separate pace is drawn.
 *   null       phasing is switched off for the firm: flow metrics have no
 *              target for a shorter horizon ("Not phased").
 *
 * Balances (AUM, SIP book) are never phased: a closing target is compared with
 * today's balance whatever horizon is selected.
 */
export type TargetHorizon = {
  /** yyyy-mm-dd the actuals are counted from. */
  since: string;
  phase?: number | null;
};

/**
 * The brief is explicit: "Do not show achievement percentage alone. Always
 * display Target + Actual + Gap." So every field above is returned, and the UI
 * renders all four. A metric with no target returns `target: null` with the
 * reason in `missing`.
 */
export async function loadTargetMeters(
  tx: Tx, w: MyWindow, horizon?: TargetHorizon,
): Promise<TargetMeter[]> {
  const since = horizon?.since ?? w.fyStart;
  // Net new SIP and net business are BOOKED — the same definition as the KPI strip.
  const booked = (await loadBookedFlows(tx, w.scope, { t: { from: since, to: w.to } })).flows.t;

  const actuals = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(aum::numeric), 0) FROM investors WHERE ${clientsWhere(w.scope)})               AS aum,
      (SELECT COALESCE(SUM(active_sip_amount::numeric), 0) FROM investors WHERE ${clientsWhere(w.scope)}) AS sip_book,
      (SELECT COUNT(*)::int FROM investors i
        WHERE ${clientRecordsWhereOn("i", w.scope)}
          AND ${onboardedInSql({ from: since, to: w.to }, "i")}) AS new_clients,
      (SELECT COUNT(*)::int FROM review_meetings
        WHERE ${staffMatch("rm_id", w)} AND status = 'completed'
          AND meeting_date >= ${since}::date AND meeting_date < (${w.to}::date + 1)) AS meetings,
      (SELECT COUNT(*)::int FROM review_meetings
        WHERE ${staffMatch("rm_id", w)} AND status = 'completed' AND category = 'review'
          AND meeting_date >= ${since}::date AND meeting_date < (${w.to}::date + 1)) AS reviews,
      (SELECT COALESCE(SUM(annual_premium::numeric), 0) FROM insurance_policies
        WHERE ${premiumMatch(w)}
          AND status NOT IN ('lapsed','surrendered','cancelled')
          AND policy_start_date >= ${since}::date AND policy_start_date <= ${w.to}::date) AS insurance
  `)).rows[0] as Row | undefined;

  const targetOf = await loadBookTargets(tx, w);

  const meter = (
    key: TargetKey, label: string, format: "currency" | "count",
    actual: number, href: string, stock = false,
  ): TargetMeter => {
    const annual = targetOf(key);
    let t: number | null = annual;
    let pace: number | null = stock ? null : w.fyPace;
    let missing: string | undefined = annual == null ? "Not set" : undefined;
    if (horizon && horizon.phase !== undefined && !stock && annual != null) {
      pace = null;
      if (horizon.phase == null) {
        t = null;
        missing = "Not phased";
      } else {
        t = annual * horizon.phase;
      }
    }
    return {
      key, label, format,
      target: t,
      actual,
      variance: t != null ? actual - t : null,
      pct: t != null && t > 0 ? actual / t : null,
      pace,
      missing,
      annual,
      stock,
      href,
    };
  };

  return [
    // AUM is a branch-level target (branch-target settings carry it); a
    // person's AUM target only exists once the Team Scorecard offers one.
    ...(w.scope.kind === "branch"
      ? [meter("aum", "AUM", "currency", num(actuals?.aum), clientsHref(w.scope, "sort=aum"), true)]
      : []),
    meter("sip_book", "SIP book", "currency", num(actuals?.sip_book), "/dashboard/sips", true),
    meter("net_sip", "Net new SIP", "currency", booked.netSip, entriesHref(w.scope, since, w.to)),
    meter("net_business", "Net business", "currency", booked.net, entriesHref(w.scope, since, w.to)),
    meter("new_clients", "New clients", "count", num(actuals?.new_clients), clientsHref(w.scope, `onboarded_from=${since}&onboarded_to=${w.to}`)),
    meter("meetings", "Meetings", "count", num(actuals?.meetings), `/dashboard/review-meetings?rm=${staffParam(w)}`),
    // The RM brief tracks review meetings as their own target; the branch
    // brief does not, and its meter row stays as it was.
    ...(w.scope.kind === "rm"
      ? [meter("reviews", "Review meetings", "count", num(actuals?.reviews),
          `/dashboard/review-meetings?rm=${staffParam(w)}&category=review`)]
      : []),
    meter("insurance", "Insurance business", "currency", num(actuals?.insurance), "/dashboard/insurance"),
  ];
}

/**
 * The share of an annual target a horizon should carry under LINEAR phasing:
 * the horizon's days so far over the FY's days. Returns null when the firm has
 * switched phasing off — the caller then says "Not phased" rather than
 * inventing an expectation the brief forbids ("only if an approved
 * target-phasing methodology exists").
 */
export function phaseFraction(
  since: string, to: string, fyStart: string, phasing: "linear" | "none",
): number | null {
  if (phasing === "none") return null;
  const day = 864e5;
  const start = Date.parse(`${since}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  const fy0 = Date.parse(`${fyStart}T00:00:00`);
  const fyDays = Math.round((Date.parse(`${Number(fyStart.slice(0, 4)) + 1}-04-01T00:00:00`) - fy0) / day);
  const days = Math.max(1, Math.round((end - start) / day) + 1);
  return Math.min(1, days / fyDays);
}

/* ─────────────────── §21 monthly performance summary ─────────────────── */

export type MonthRow = {
  key: string;
  label: string;
  format: "currency" | "count";
  previous: number | null;
  current: number | null;
  /** null when previous is 0 or unknown — the brief asks for N/A, not ÷0. */
  changePct: number | null;
  inverse?: boolean;
};

/**
 * This month against last month, twelve metrics. The brief's rule — "If
 * previous value is zero, show N/A instead of divide-by-zero" — is enforced
 * here rather than in the component, so no future caller can reintroduce
 * Infinity%.
 *
 * Both months are FULL-MONTH-to-date windows of the same shape: 1–22 Sept
 * against 1–22 Aug. Comparing 22 days against 31 would show every metric
 * collapsing on the 1st of every month.
 */
export async function loadMonthlySummary(tx: Tx, w: MyWindow): Promise<MonthRow[]> {
  // The same two windows the query below builds in SQL, for the booked pass.
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = Number(w.to.slice(0, 4));
  const m = Number(w.to.slice(5, 7));
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const prevLast = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const prevMonth = `${py}-${pad(pm)}`;
  const { flows: bk } = await loadBookedFlows(tx, w.scope, {
    cur: { from: `${w.to.slice(0, 7)}-01`, to: w.to },
    prev: { from: `${prevMonth}-01`, to: `${prevMonth}-${pad(Math.min(Number(w.to.slice(8, 10)), prevLast))}` },
  });

  const r = (await tx.execute(sql`
    WITH bounds AS (
      SELECT date_trunc('month', ${w.to}::date)::date                        AS cur_from,
             ${w.to}::date                                                   AS cur_to,
             (date_trunc('month', ${w.to}::date) - interval '1 month')::date AS prev_from,
             -- Same DAY of the previous month, clamped to its last day so
             -- 31 March against February lands on the 28th, not in March.
             LEAST(
               (date_trunc('month', ${w.to}::date) - interval '1 month'
                 + (${w.to}::date - date_trunc('month', ${w.to}::date)::date) * interval '1 day')::date,
               (date_trunc('month', ${w.to}::date) - interval '1 day')::date
             ) AS prev_to
    )
    SELECT
      (SELECT COUNT(*) FILTER (WHERE ${onboardedDateSql("i")} BETWEEN b.cur_from AND b.cur_to)::int FROM investors i WHERE ${clientRecordsWhereOn("i", w.scope)})   AS nc_cur,
      (SELECT COUNT(*) FILTER (WHERE ${onboardedDateSql("i")} BETWEEN b.prev_from AND b.prev_to)::int FROM investors i WHERE ${clientRecordsWhereOn("i", w.scope)}) AS nc_prev,
      (SELECT COUNT(*) FILTER (WHERE m.meeting_date::date BETWEEN b.cur_from AND b.cur_to)::int FROM review_meetings m WHERE ${staffMatch("rm_id", w, "m")} AND m.status = 'completed')   AS mt_cur,
      (SELECT COUNT(*) FILTER (WHERE m.meeting_date::date BETWEEN b.prev_from AND b.prev_to)::int FROM review_meetings m WHERE ${staffMatch("rm_id", w, "m")} AND m.status = 'completed') AS mt_prev,
      (SELECT COUNT(*) FILTER (WHERE m.meeting_date::date BETWEEN b.cur_from AND b.cur_to)::int FROM review_meetings m WHERE ${staffMatch("rm_id", w, "m")} AND m.status = 'completed' AND m.category = 'review')   AS rv_cur,
      (SELECT COUNT(*) FILTER (WHERE m.meeting_date::date BETWEEN b.prev_from AND b.prev_to)::int FROM review_meetings m WHERE ${staffMatch("rm_id", w, "m")} AND m.status = 'completed' AND m.category = 'review') AS rv_prev,
      (SELECT COUNT(*) FILTER (WHERE p.created_at::date BETWEEN b.cur_from AND b.cur_to)::int FROM proposals p WHERE ${staffMatch("prepared_by_user_id", w, "p")})   AS pr_cur,
      (SELECT COUNT(*) FILTER (WHERE p.created_at::date BETWEEN b.prev_from AND b.prev_to)::int FROM proposals p WHERE ${staffMatch("prepared_by_user_id", w, "p")}) AS pr_prev,
      (SELECT COALESCE(SUM(annual_premium::numeric) FILTER (WHERE ip.policy_start_date BETWEEN b.cur_from AND b.cur_to), 0) FROM insurance_policies ip WHERE ${premiumMatch(w, "ip")} AND ip.status NOT IN ('lapsed','surrendered','cancelled'))   AS ins_cur,
      (SELECT COALESCE(SUM(annual_premium::numeric) FILTER (WHERE ip.policy_start_date BETWEEN b.prev_from AND b.prev_to), 0) FROM insurance_policies ip WHERE ${premiumMatch(w, "ip")} AND ip.status NOT IN ('lapsed','surrendered','cancelled')) AS ins_prev
    FROM bounds b
  `)).rows[0] as Row | undefined;

  // AUM and SIP book are balances, so their "previous month" is the recorded
  // snapshot, not a re-aggregation. No snapshot yet → null → "Data unavailable".
  const snap = (await tx.execute(sql`
    SELECT aum::numeric AS aum, monthly_sip::numeric AS sip
      FROM ${snapshotSource(w.scope)}
       AND snapshot_date < date_trunc('month', ${w.to}::date)::date
     ORDER BY snapshot_date DESC
     LIMIT 1
  `)).rows[0] as Row | undefined;

  const live = (await tx.execute(sql`
    SELECT COALESCE(SUM(aum::numeric), 0) AS aum,
           COALESCE(SUM(active_sip_amount::numeric), 0) AS sip
      FROM investors WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Row | undefined;

  const row = (
    key: string, label: string, format: "currency" | "count",
    previous: number | null, current: number | null, inverse = false,
  ): MonthRow => ({
    key, label, format, previous, current,
    // Zero base, or no base at all, has no percentage. N/A, never ÷0.
    changePct: previous != null && previous !== 0 && current != null ? (current - previous) / previous : null,
    inverse,
  });

  return [
    row("aum", "AUM", "currency", snap ? num(snap.aum) : null, num(live?.aum)),
    row("sip_book", "SIP book", "currency", snap ? num(snap.sip) : null, num(live?.sip)),
    // Booked business (Business Entries) — see loadMyKpis.
    row("gross_sip", "Gross SIP", "currency", bk.prev.newSip, bk.cur.newSip),
    row("sip_stop", "SIP stopped", "currency", bk.prev.stoppedSip, bk.cur.stoppedSip, true),
    row("net_sip", "Net SIP", "currency", bk.prev.netSip, bk.cur.netSip),
    row("gross_investment", "Gross investment", "currency", bk.prev.gross, bk.cur.gross),
    row("redemption", "Redemption", "currency", bk.prev.redemption, bk.cur.redemption, true),
    row("net_business", "Net business", "currency", bk.prev.net, bk.cur.net),
    row("new_clients", "New clients", "count", num(r?.nc_prev), num(r?.nc_cur)),
    row("meetings", "Meetings", "count", num(r?.mt_prev), num(r?.mt_cur)),
    // Both briefs list review meetings separately from meetings in general.
    row("reviews", "Reviews", "count", num(r?.rv_prev), num(r?.rv_cur)),
    row("proposals", "Proposals", "count", num(r?.pr_prev), num(r?.pr_cur)),
    row("insurance", "Insurance business", "currency", num(r?.ins_prev), num(r?.ins_cur)),
  ];
}

/**
 * The two column headings for loadMonthlySummary: the month `to` falls in and
 * the one before it ("September 2026", "August 2026"). Taken from the same
 * date the query bounds come from, so a past period is labelled as that period.
 */
export function monthLabels(to: string): { monthLabel: string; prevMonthLabel: string } {
  const [y, m] = to.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return {
    monthLabel: formatDate(`${to.slice(0, 7)}-01`, "monthYear"),
    prevMonthLabel: formatDate(`${prev}-01`, "monthYear"),
  };
}

/* ───────────────────────── §4 my business trend ───────────────────────── */

export const TREND_METRICS = [
  { key: "gross_sip", label: "Gross SIP", format: "currency" as const },
  { key: "sip_stop", label: "SIP stopped", format: "currency" as const, inverse: true },
  { key: "net_sip", label: "Net SIP", format: "currency" as const },
  { key: "gross_investment", label: "Gross investment", format: "currency" as const },
  { key: "redemption", label: "Redemption", format: "currency" as const, inverse: true },
  { key: "net_business", label: "Net business", format: "currency" as const },
  { key: "new_clients", label: "New clients", format: "count" as const },
  { key: "insurance", label: "Insurance premium", format: "currency" as const },
] as const;

export type TrendMetricKey = (typeof TREND_METRICS)[number]["key"];

export type MyTrend = {
  /** April … March, always twelve entries so the axis does not move. */
  months: string[];
  /** metric → { current FY, previous FY }, both twelve long. */
  series: Record<TrendMetricKey, { current: number[]; previous: number[] }>;
  /**
   * BALANCES by month — AUM and SIP book at the last snapshot recorded in each
   * month. A month with no snapshot is null, drawn as a gap: those figures are
   * recorded forward from migrations 0217/0218 and cannot be rebuilt, so a
   * missing month is unknown, never ₹0.
   */
  balances: Record<"aum" | "sip_book", { current: Array<number | null>; previous: Array<number | null> }>;
  /** First snapshot date for this book, or null when none has been recorded. */
  balancesSince: string | null;
  /**
   * Months of the running FY that have begun, 1..12 (April = 1). A year-on-year
   * figure must compare the SAME months: this FY's April–September against
   * last FY's April–September, not against all twelve of last year's, which
   * read as "−55% year on year" every October for no reason but the calendar.
   */
  monthsElapsed: number;
  fyLabel: string;
  prevFyLabel: string;
};

const FY_MONTH_LABELS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

/**
 * Each KPI tile's sparkline: this FY's months so far from the trend — money
 * that moved per month for a flow, the recorded month-end for a balance (a
 * month never recorded is left out, never drawn as zero).
 */
export function kpiSparks(trend: MyTrend): Partial<Record<string, number[]>> {
  const n = Math.max(0, Math.min(12, trend.monthsElapsed));
  const out: Partial<Record<string, number[]>> = {};
  for (const [key, s] of Object.entries(trend.series)) out[key] = s.current.slice(0, n);
  for (const key of ["aum", "sip_book"] as const) {
    out[key] = trend.balances[key].current.slice(0, n).filter((v): v is number => v != null);
  }
  return out;
}

/**
 * Month-by-month for this financial year and the last, for every metric at once.
 *
 * All eight metrics are computed in one pass rather than one query per metric,
 * so the metric switch in the UI costs nothing — it flips between series
 * already in the payload instead of re-querying. Eight round trips to redraw
 * one line is the sort of thing that makes a dashboard feel slow for no reason.
 *
 * The axis is always twelve months, April to March, even where a month has no
 * data. A chart whose x-axis grows as the year passes cannot be compared with
 * itself, and a firm's fifth month should sit under "Aug", not at the right-hand
 * edge.
 */
export async function loadMyTrend(tx: Tx, w: MyWindow): Promise<MyTrend> {
  const fyY = Number(w.fyStart.slice(0, 4));
  const prevStart = `${fyY - 1}-04-01`;
  const prevEnd = `${fyY}-03-31`;
  const fyEnd = `${fyY + 1}-03-31`;

  /** FY month index 0..11 (April = 0) from a date expression. */
  const fyIdx = (col: string) => sql.raw(`((EXTRACT(MONTH FROM ${col})::int + 8) % 12)`);

  // The six money lines are BOOKED business by month (lib/dashboard/my/booked.ts).
  const booked = await loadBookedByMonth(tx, w.scope, prevStart, fyEnd);

  const rows = (await tx.execute(sql`
    WITH
    -- New clients by onboarding date (India), never created_at.
    clients AS (
      SELECT ${fyIdx("(i.onboarded_at AT TIME ZONE 'Asia/Kolkata')::date")} AS m,
             (${onboardedDateSql("i")} BETWEEN ${w.fyStart}::date AND ${fyEnd}::date) AS cur,
             (${onboardedDateSql("i")} BETWEEN ${prevStart}::date AND ${prevEnd}::date) AS prv
        FROM investors i
       WHERE ${clientRecordsWhereOn("i", w.scope)}
         AND ${onboardedDateSql("i")} BETWEEN ${prevStart}::date AND ${fyEnd}::date
    ),
    premium AS (
      SELECT ${fyIdx("policy_start_date")} AS m,
             (policy_start_date >= ${w.fyStart}::date AND policy_start_date <= ${fyEnd}::date) AS cur,
             (policy_start_date >= ${prevStart}::date AND policy_start_date <= ${prevEnd}::date) AS prv,
             annual_premium::numeric AS amount
        FROM insurance_policies
       WHERE ${premiumMatch(w)}
         AND status NOT IN ('lapsed','surrendered','cancelled')
         AND policy_start_date >= ${prevStart}::date AND policy_start_date <= ${fyEnd}::date
    ),
    -- Each source is GROUPED ONCE and then joined, rather than re-scanned per
    -- output cell. The obvious shape — a 24-row grid of (month x year) with a
    -- correlated SUM per metric — runs 144 subqueries over the same CTEs, which
    -- is invisible on a 13-client book and very much not on a 5,000-client one.
    clients_g  AS (SELECT m, cur, COUNT(*)    AS v FROM clients WHERE cur OR prv GROUP BY m, cur),
    premium_g  AS (SELECT m, cur, SUM(amount) AS v FROM premium WHERE cur OR prv GROUP BY m, cur),
    grid AS (
      SELECT gs.m, c.cur
        FROM generate_series(0, 11) AS gs(m), (VALUES (true), (false)) AS c(cur)
    )
    SELECT g.m, g.cur,
           COALESCE(cl.v, 0)               AS new_clients,
           COALESCE(pr.v, 0)               AS insurance
      FROM grid g
      LEFT JOIN clients_g cl ON cl.m = g.m AND cl.cur = g.cur
      LEFT JOIN premium_g pr ON pr.m = g.m AND pr.cur = g.cur
     ORDER BY g.m
  `)).rows as Array<Record<string, unknown>>;

  const blank = () => ({ current: new Array(12).fill(0) as number[], previous: new Array(12).fill(0) as number[] });
  const series = {
    gross_sip: blank(), sip_stop: blank(), net_sip: blank(),
    gross_investment: blank(), redemption: blank(), net_business: blank(),
    new_clients: blank(), insurance: blank(),
  } as MyTrend["series"];

  for (const r of rows) {
    const m = num(r.m);
    if (m < 0 || m > 11) continue;
    const side = r.cur === true ? "current" : "previous";
    series.new_clients[side][m] = num(r.new_clients);
    series.insurance[side][m] = num(r.insurance);
  }
  for (const [month, f] of booked.months) {
    const m = (Number(month.slice(5, 7)) + 8) % 12; // April = 0
    const side = `${month}-01` >= w.fyStart ? "current" : "previous";
    series.gross_sip[side][m] = f.newSip;
    series.sip_stop[side][m] = f.stoppedSip;
    series.net_sip[side][m] = f.netSip;
    series.gross_investment[side][m] = f.gross;
    series.redemption[side][m] = f.redemption;
    series.net_business[side][m] = f.net;
  }

  return {
    months: FY_MONTH_LABELS,
    series,
    ...(await loadBalanceTrend(tx, w, prevStart, fyEnd)),
    monthsElapsed: ((Number(w.today.slice(5, 7)) + 8) % 12) + 1,
    fyLabel: w.fiscalYear,
    prevFyLabel: `${fyY - 1}-${String(fyY % 100).padStart(2, "0")}`,
  };
}

/** Month-end balances from the book's snapshot history — see MyTrend.balances. */
async function loadBalanceTrend(
  tx: Tx, w: MyWindow, prevStart: string, fyEnd: string,
): Promise<Pick<MyTrend, "balances" | "balancesSince">> {
  const fyStart = w.fyStart;
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (date_trunc('month', snapshot_date))
           snapshot_date::text AS d, aum::numeric AS aum, monthly_sip::numeric AS sip
      FROM ${snapshotSource(w.scope)}
       AND snapshot_date >= ${prevStart}::date AND snapshot_date <= ${fyEnd}::date
     ORDER BY date_trunc('month', snapshot_date), snapshot_date DESC
  `)).rows as Array<{ d: string; aum: string; sip: string }>;
  const since = (await tx.execute(sql`
    SELECT MIN(snapshot_date)::text AS d FROM ${snapshotSource(w.scope)}
  `)).rows[0] as { d: string | null } | undefined;

  const blank = () => ({ current: new Array(12).fill(null) as Array<number | null>, previous: new Array(12).fill(null) as Array<number | null> });
  const balances = { aum: blank(), sip_book: blank() };
  for (const r of rows) {
    const d = String(r.d).slice(0, 10);
    const m = (Number(d.slice(5, 7)) + 8) % 12; // April = 0
    const side = d >= fyStart ? "current" : "previous";
    balances.aum[side][m] = num(r.aum);
    balances.sip_book[side][m] = num(r.sip);
  }
  return { balances, balancesSince: since?.d ? String(since.d).slice(0, 10) : null };
}
