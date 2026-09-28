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

/** A raw SQL result row. Postgres hands numerics back as strings, so every
 *  field goes through num() / numOrNull() before it is used. */
type Row = Record<string, unknown>;
import {
  asInList, clientIds, clientsHref, clientsWhere, clientsWhereOn, delta, GROSS_TYPES,
  loadBookTargets, num, premiumMatch, REDEMPTION_TYPES, SIP_STOP_TYPES, snapshotSource, staffMatch,
  staffParam, type Delta, type MyWindow, type TargetKey,
} from "./window";

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
  const MINE = clientIds(w.scope);
  const GROSS_IN = asInList(GROSS_TYPES);
  const RED_IN = asInList(REDEMPTION_TYPES);
  const STOP_IN = asInList(SIP_STOP_TYPES);

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

  // ── Flow: my clients' ledger, three windows in one pass ───────────────────
  //
  //    `has_any` counts EVERY transaction on my book, whatever its status —
  //    not just the settled ones. The distinction matters: a book whose only
  //    2026 rows are five rejected SIP debits HAS a ledger, so its gross
  //    investment is a real ₹0 and the rejections are the story. Counting only
  //    settled rows made that book read "Data unavailable", which hides the
  //    one thing on it that needs attention.
  const flow = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE ok AND cur  AND type IN (${GROSS_IN})), 0) AS gross_cur,
      COALESCE(SUM(amount) FILTER (WHERE ok AND prev AND type IN (${GROSS_IN})), 0) AS gross_prev,
      COALESCE(SUM(amount) FILTER (WHERE ok AND fy   AND type IN (${GROSS_IN})), 0) AS gross_fy,
      COALESCE(SUM(amount) FILTER (WHERE ok AND cur  AND type IN (${RED_IN})), 0)   AS red_cur,
      COALESCE(SUM(amount) FILTER (WHERE ok AND prev AND type IN (${RED_IN})), 0)   AS red_prev,
      COALESCE(SUM(amount) FILTER (WHERE ok AND fy   AND type IN (${RED_IN})), 0)   AS red_fy,
      COUNT(DISTINCT investor_id) FILTER (WHERE ok AND cur AND type IN (${RED_IN}))::int AS red_clients,
      COALESCE(SUM(amount) FILTER (WHERE ok AND cur  AND type IN (${STOP_IN})), 0)  AS stop_cur,
      COALESCE(SUM(amount) FILTER (WHERE ok AND prev AND type IN (${STOP_IN})), 0)  AS stop_prev,
      COALESCE(SUM(amount) FILTER (WHERE ok AND fy   AND type IN (${STOP_IN})), 0)  AS stop_fy,
      COUNT(*) FILTER (WHERE ok AND cur AND type IN (${STOP_IN}))::int              AS stop_count,
      COUNT(*)::int AS has_any
    FROM (
      SELECT type, investor_id, amount::numeric AS amount,
             (status IN ('processed','successful'))                                  AS ok,
             (order_date >= ${w.from}::date     AND order_date <= ${w.to}::date)     AS cur,
             (order_date >= ${w.prevFrom}::date AND order_date <= ${w.prevTo}::date) AS prev,
             (order_date >= ${w.fyStart}::date  AND order_date <= ${w.to}::date)     AS fy
        FROM transactions
       WHERE amount IS NOT NULL AND investor_id IN ${MINE}
    ) t
  `)).rows[0] as Row | undefined;

  // ── NEW SIP comes from the register ───────────────────────────────────────
  //    Not from instalment rows: an instalment is an existing mandate
  //    collecting again, not new SIP added to the book. STOPS come from the
  //    ledger pass above — see SIP_STOP_TYPES for why not the register.
  const sipReg = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(amount::numeric) FILTER (WHERE new_cur), 0)   AS new_cur,
      COALESCE(SUM(amount::numeric) FILTER (WHERE new_prev), 0)  AS new_prev,
      COALESCE(SUM(amount::numeric) FILTER (WHERE new_fy), 0)    AS new_fy,
      COUNT(*) FILTER (WHERE new_cur)::int                       AS new_count,
      COUNT(*)::int                                              AS has_any
    FROM (
      SELECT amount,
             (start_date >= ${w.from}::date     AND start_date <= ${w.to}::date)     AS new_cur,
             (start_date >= ${w.prevFrom}::date AND start_date <= ${w.prevTo}::date) AS new_prev,
             (start_date >= ${w.fyStart}::date  AND start_date <= ${w.to}::date)     AS new_fy
        FROM sips
       WHERE investor_id IN ${MINE}
    ) s
  `)).rows[0] as Row | undefined;

  // ── New clients on my book ────────────────────────────────────────────────
  const clients = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= ${w.from}::date     AND created_at < (${w.to}::date + 1))     ::int AS cur,
      COUNT(*) FILTER (WHERE created_at >= ${w.prevFrom}::date AND created_at < (${w.prevTo}::date + 1)) ::int AS prev,
      COUNT(*) FILTER (WHERE created_at >= ${w.fyStart}::date  AND created_at < (${w.to}::date + 1))     ::int AS fy
      FROM investors
     WHERE ${clientsWhere(w.scope)}
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

  const hasLedger = num(flow?.has_any) > 0;
  const hasSips = num(sipReg?.has_any) > 0;
  const hasPolicies = num(ins?.has_any) > 0;

  const aum = num(live?.aum);
  const sipBook = num(live?.sip_book);
  const sipClients = num(live?.sip_clients);

  const grossSipCur = hasSips ? num(sipReg?.new_cur) : null;
  // Net SIP needs BOTH sources: the register for what was added, the ledger
  // for what stopped. Missing either one makes it unknown, not gross − 0.
  const sipStopCur = hasLedger ? num(flow?.stop_cur) : null;
  const hasNetSip = hasSips && hasLedger;
  const netSipCur = hasNetSip ? num(sipReg?.new_cur) - num(flow?.stop_cur) : null;
  const netSipFy = hasNetSip ? num(sipReg?.new_fy) - num(flow?.stop_fy) : null;
  const grossCur = hasLedger ? num(flow?.gross_cur) : null;
  const redCur = hasLedger ? num(flow?.red_cur) : null;
  const netCur = hasLedger ? num(flow?.gross_cur) - num(flow?.red_cur) : null;
  const netFy = hasLedger ? num(flow?.gross_fy) - num(flow?.red_fy) : null;

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
      compare: hasSips ? delta(grossSipCur ?? 0, num(sipReg?.new_prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasSips ? num(sipReg?.new_fy) : null,
      target: null,
      notes: [{ label: "New mandates", value: hasSips ? String(num(sipReg?.new_count)) : "" }],
      href: "/dashboard/sips?status=active",
    },
    {
      key: "sip_stop",
      label: "SIP stopped",
      kind: "flow",
      format: "currency",
      value: sipStopCur,
      compare: hasLedger ? delta(sipStopCur ?? 0, num(flow?.stop_prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasLedger ? num(flow?.stop_fy) : null,
      target: null,
      inverse: true,
      notes: [{ label: "Mandates stopped", value: hasLedger ? String(num(flow?.stop_count)) : "" }],
      href: "/dashboard/sips?status=stopped",
    },
    {
      key: "net_sip",
      label: "Net SIP",
      kind: "flow",
      format: "currency",
      value: netSipCur,
      compare: hasNetSip ? delta(netSipCur ?? 0, num(sipReg?.new_prev) - num(flow?.stop_prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: netSipFy,
      target: target("net_sip", netSipFy),
      notes: [{ label: "Gross added − stopped", value: "" }],
      href: "/dashboard/reports/sip-health",
    },
    {
      key: "gross_investment",
      label: "Gross investment",
      kind: "flow",
      format: "currency",
      value: grossCur,
      compare: hasLedger ? delta(grossCur ?? 0, num(flow?.gross_prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasLedger ? num(flow?.gross_fy) : null,
      target: null,
      notes: [{ label: "Excludes switch / STP — neither is new money", value: "" }],
      href: "/dashboard/transactions",
    },
    {
      key: "redemption",
      label: "Redemption",
      kind: "flow",
      format: "currency",
      value: redCur,
      compare: hasLedger ? delta(redCur ?? 0, num(flow?.red_prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: hasLedger ? num(flow?.red_fy) : null,
      target: null,
      inverse: true,
      notes: [{ label: "Clients", value: hasLedger ? String(num(flow?.red_clients)) : "" }],
      href: "/dashboard/reports/redemption",
    },
    {
      key: "net_business",
      label: "Net business",
      kind: "flow",
      format: "currency",
      value: netCur,
      compare: hasLedger ? delta(netCur ?? 0, num(flow?.gross_prev) - num(flow?.red_prev)) : null,
      compareLabel: PREV_PERIOD,
      fytd: netFy,
      target: target("net_business", netFy),
      notes: [{ label: "Gross investment − redemption", value: "" }],
      href: "/dashboard/transactions",
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
  const MINE = clientIds(w.scope);
  const GROSS_IN = asInList(GROSS_TYPES);
  const RED_IN = asInList(REDEMPTION_TYPES);
  const since = horizon?.since ?? w.fyStart;

  const actuals = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(aum::numeric), 0) FROM investors WHERE ${clientsWhere(w.scope)})               AS aum,
      (SELECT COALESCE(SUM(active_sip_amount::numeric), 0) FROM investors WHERE ${clientsWhere(w.scope)}) AS sip_book,
      -- Net new SIP: added in the register, less the ledger's stop events
      -- (SIP_STOP_TYPES) — the same definition as the KPI strip.
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE start_date >= ${since}::date AND start_date <= ${w.to}::date), 0)
         FROM sips WHERE investor_id IN ${MINE})
      - (SELECT COALESCE(SUM(amount::numeric), 0) FROM transactions
          WHERE investor_id IN ${MINE} AND type IN ('sip_stop','sip_pause')
            AND status IN ('processed','successful')
            AND order_date >= ${since}::date AND order_date <= ${w.to}::date) AS net_sip,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE type IN (${GROSS_IN})), 0)
             - COALESCE(SUM(amount::numeric) FILTER (WHERE type IN (${RED_IN})), 0)
         FROM transactions
        WHERE status IN ('processed','successful') AND investor_id IN ${MINE}
          AND order_date >= ${since}::date AND order_date <= ${w.to}::date) AS net_business,
      (SELECT COUNT(*)::int FROM investors
        WHERE ${clientsWhere(w.scope)}
          AND created_at >= ${since}::date AND created_at < (${w.to}::date + 1)) AS new_clients,
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
    meter("net_sip", "Net new SIP", "currency", num(actuals?.net_sip), "/dashboard/reports/sip-health"),
    meter("net_business", "Net business", "currency", num(actuals?.net_business), "/dashboard/transactions"),
    meter("new_clients", "New clients", "count", num(actuals?.new_clients), clientsHref(w.scope, "sort=created&dir=desc")),
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
  const MINE = clientIds(w.scope);
  const GROSS_IN = asInList(GROSS_TYPES);
  const RED_IN = asInList(REDEMPTION_TYPES);

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
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE t.type IN (${GROSS_IN}) AND t.order_date BETWEEN b.cur_from AND b.cur_to), 0) FROM transactions t WHERE t.status IN ('processed','successful') AND t.investor_id IN ${MINE})  AS gross_cur,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE t.type IN (${GROSS_IN}) AND t.order_date BETWEEN b.prev_from AND b.prev_to), 0) FROM transactions t WHERE t.status IN ('processed','successful') AND t.investor_id IN ${MINE}) AS gross_prev,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE t.type IN (${RED_IN}) AND t.order_date BETWEEN b.cur_from AND b.cur_to), 0) FROM transactions t WHERE t.status IN ('processed','successful') AND t.investor_id IN ${MINE})   AS red_cur,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE t.type IN (${RED_IN}) AND t.order_date BETWEEN b.prev_from AND b.prev_to), 0) FROM transactions t WHERE t.status IN ('processed','successful') AND t.investor_id IN ${MINE})  AS red_prev,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE s.start_date BETWEEN b.cur_from AND b.cur_to), 0) FROM sips s WHERE s.investor_id IN ${MINE})   AS sip_cur,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE s.start_date BETWEEN b.prev_from AND b.prev_to), 0) FROM sips s WHERE s.investor_id IN ${MINE}) AS sip_prev,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE t.type IN ('sip_stop','sip_pause') AND t.order_date BETWEEN b.cur_from AND b.cur_to), 0) FROM transactions t WHERE t.status IN ('processed','successful') AND t.investor_id IN ${MINE})   AS stop_cur,
      (SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE t.type IN ('sip_stop','sip_pause') AND t.order_date BETWEEN b.prev_from AND b.prev_to), 0) FROM transactions t WHERE t.status IN ('processed','successful') AND t.investor_id IN ${MINE}) AS stop_prev,
      (SELECT COUNT(*) FILTER (WHERE i.created_at::date BETWEEN b.cur_from AND b.cur_to)::int FROM investors i WHERE ${clientsWhereOn("i", w.scope)})   AS nc_cur,
      (SELECT COUNT(*) FILTER (WHERE i.created_at::date BETWEEN b.prev_from AND b.prev_to)::int FROM investors i WHERE ${clientsWhereOn("i", w.scope)}) AS nc_prev,
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
    row("gross_sip", "Gross SIP", "currency", num(r?.sip_prev), num(r?.sip_cur)),
    row("sip_stop", "SIP stopped", "currency", num(r?.stop_prev), num(r?.stop_cur), true),
    row("net_sip", "Net SIP", "currency", num(r?.sip_prev) - num(r?.stop_prev), num(r?.sip_cur) - num(r?.stop_cur)),
    row("gross_investment", "Gross investment", "currency", num(r?.gross_prev), num(r?.gross_cur)),
    row("redemption", "Redemption", "currency", num(r?.red_prev), num(r?.red_cur), true),
    row("net_business", "Net business", "currency", num(r?.gross_prev) - num(r?.red_prev), num(r?.gross_cur) - num(r?.red_cur)),
    row("new_clients", "New clients", "count", num(r?.nc_prev), num(r?.nc_cur)),
    row("meetings", "Meetings", "count", num(r?.mt_prev), num(r?.mt_cur)),
    // Both briefs list review meetings separately from meetings in general.
    row("reviews", "Reviews", "count", num(r?.rv_prev), num(r?.rv_cur)),
    row("proposals", "Proposals", "count", num(r?.pr_prev), num(r?.pr_cur)),
    row("insurance", "Insurance business", "currency", num(r?.ins_prev), num(r?.ins_cur)),
  ];
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
  const MINE = clientIds(w.scope);
  const GROSS_IN = asInList(GROSS_TYPES);
  const RED_IN = asInList(REDEMPTION_TYPES);

  const fyY = Number(w.fyStart.slice(0, 4));
  const prevStart = `${fyY - 1}-04-01`;
  const prevEnd = `${fyY}-03-31`;
  const fyEnd = `${fyY + 1}-03-31`;

  /** FY month index 0..11 (April = 0) from a date expression. */
  const fyIdx = (col: string) => sql.raw(`((EXTRACT(MONTH FROM ${col})::int + 8) % 12)`);

  const rows = (await tx.execute(sql`
    WITH ledger AS (
      SELECT ${fyIdx("order_date")} AS m,
             (order_date >= ${w.fyStart}::date AND order_date <= ${fyEnd}::date) AS cur,
             (order_date >= ${prevStart}::date AND order_date <= ${prevEnd}::date) AS prv,
             type, amount::numeric AS amount
        FROM transactions
       WHERE status IN ('processed','successful') AND amount IS NOT NULL
         AND investor_id IN ${MINE}
         AND order_date >= ${prevStart}::date AND order_date <= ${fyEnd}::date
    ),
    sip_new AS (
      SELECT ${fyIdx("start_date")} AS m,
             (start_date >= ${w.fyStart}::date AND start_date <= ${fyEnd}::date) AS cur,
             (start_date >= ${prevStart}::date AND start_date <= ${prevEnd}::date) AS prv,
             amount::numeric AS amount
        FROM sips
       WHERE investor_id IN ${MINE} AND start_date IS NOT NULL
         AND start_date >= ${prevStart}::date AND start_date <= ${fyEnd}::date
    ),
    -- Stops are the ledger's stop events (SIP_STOP_TYPES), by order_date.
    sip_off AS (
      SELECT ${fyIdx("order_date")} AS m,
             (order_date >= ${w.fyStart}::date AND order_date <= ${fyEnd}::date) AS cur,
             (order_date >= ${prevStart}::date AND order_date <= ${prevEnd}::date) AS prv,
             amount::numeric AS amount
        FROM transactions
       WHERE investor_id IN ${MINE} AND type IN ('sip_stop','sip_pause')
         AND status IN ('processed','successful')
         AND order_date >= ${prevStart}::date AND order_date <= ${fyEnd}::date
    ),
    clients AS (
      SELECT ${fyIdx("created_at")} AS m,
             (created_at >= ${w.fyStart}::date AND created_at <= ${fyEnd}::date) AS cur,
             (created_at >= ${prevStart}::date AND created_at <= ${prevEnd}::date) AS prv
        FROM investors
       WHERE ${clientsWhere(w.scope)}
         AND created_at >= ${prevStart}::date AND created_at <= ${fyEnd}::date
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
    ledger_g AS (
      SELECT m, cur,
             SUM(amount) FILTER (WHERE type IN (${GROSS_IN})) AS gross_investment,
             SUM(amount) FILTER (WHERE type IN (${RED_IN}))   AS redemption
        FROM ledger WHERE cur OR prv GROUP BY m, cur
    ),
    sip_new_g  AS (SELECT m, cur, SUM(amount) AS v FROM sip_new WHERE cur OR prv GROUP BY m, cur),
    sip_off_g  AS (SELECT m, cur, SUM(amount) AS v FROM sip_off WHERE cur OR prv GROUP BY m, cur),
    clients_g  AS (SELECT m, cur, COUNT(*)    AS v FROM clients WHERE cur OR prv GROUP BY m, cur),
    premium_g  AS (SELECT m, cur, SUM(amount) AS v FROM premium WHERE cur OR prv GROUP BY m, cur),
    grid AS (
      SELECT gs.m, c.cur
        FROM generate_series(0, 11) AS gs(m), (VALUES (true), (false)) AS c(cur)
    )
    SELECT g.m, g.cur,
           COALESCE(l.gross_investment, 0) AS gross_investment,
           COALESCE(l.redemption, 0)       AS redemption,
           COALESCE(sn.v, 0)               AS gross_sip,
           COALESCE(so.v, 0)               AS sip_stop,
           COALESCE(cl.v, 0)               AS new_clients,
           COALESCE(pr.v, 0)               AS insurance
      FROM grid g
      LEFT JOIN ledger_g  l  ON l.m  = g.m AND l.cur  = g.cur
      LEFT JOIN sip_new_g sn ON sn.m = g.m AND sn.cur = g.cur
      LEFT JOIN sip_off_g so ON so.m = g.m AND so.cur = g.cur
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
    const grossSip = num(r.gross_sip);
    const sipStop = num(r.sip_stop);
    const gross = num(r.gross_investment);
    const red = num(r.redemption);
    series.gross_sip[side][m] = grossSip;
    series.sip_stop[side][m] = sipStop;
    series.net_sip[side][m] = grossSip - sipStop;
    series.gross_investment[side][m] = gross;
    series.redemption[side][m] = red;
    series.net_business[side][m] = gross - red;
    series.new_clients[side][m] = num(r.new_clients);
    series.insurance[side][m] = num(r.insurance);
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
