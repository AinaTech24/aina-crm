/**
 * "Firm pulse" — the headline strip at the top of the cockpit and the
 * transaction-activity tiles under it. SERVER-ONLY (imports the DB).
 *
 * Two loaders, deliberately separate because they answer different questions and
 * change at different rates:
 *
 *   loadFirmPulse()      — Total AUM · Total Investment · SIP Book, each with a
 *                          Day and MoM delta and a 30-point trend line.
 *   loadActivityTiles()  — what actually happened in the last N days, by
 *                          transaction type, as count + rupees.
 *
 * Deltas come from `firm_snapshots` (written daily by firm-snapshot-recorder),
 * NOT from recomputing history — AUM is a point-in-time market value that cannot
 * be reconstructed retrospectively once NAV moves. That has one consequence
 * worth stating plainly: a tenant only has deltas from its first snapshot
 * onward, so both loaders return `null` deltas rather than a fake 0% when the
 * history isn't there yet. The UI renders "—" for those; a confident "0.00%" on
 * a firm that simply has no yesterday is worse than an obvious blank.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type Delta = {
  /** Absolute change in rupees. */
  abs: number;
  /** Fractional change, e.g. -0.0053 for -0.53%. Null when the base was 0. */
  pct: number | null;
} | null;

export type PulseMetric = {
  key: "aum" | "invested" | "sip_book" | "clients";
  label: string;
  value: number;
  day: Delta;
  mom: Delta;
  /** Oldest → newest, for the sparkline. */
  series: number[];
  /** Secondary line for the SIP card — average SIP rather than a Day delta. */
  /** `value: null` = genuinely unknown; render a dash, never a fabricated 0. */
  footnote?: { label: string; value: number | null; hint?: string } | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function delta(current: number, previous: number | null | undefined): Delta {
  if (previous == null || !Number.isFinite(previous)) return null;
  const abs = current - previous;
  return { abs, pct: previous === 0 ? null : abs / previous };
}

export async function loadFirmPulse(tx: Tx): Promise<PulseMetric[]> {
  // Live figures — the same expressions the firm snapshot uses, so today's card
  // and tomorrow's snapshot can never disagree about what "the book" means.
  const live = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(aum::numeric)              FILTER (WHERE alive), 0) AS aum,
      COALESCE(SUM(active_sip_amount::numeric) FILTER (WHERE alive), 0) AS sip_book,
      COUNT(*) FILTER (WHERE alive AND active_sip_amount::numeric > 0)::int AS sip_clients,
      COUNT(*) FILTER (WHERE alive)::int AS clients
    FROM (
      SELECT aum, active_sip_amount,
             (deleted_at IS NULL AND status <> 'closed' AND merged_into_id IS NULL) AS alive
        FROM investors
    ) s
  `)).rows[0] as any;

  // Total Investment = net money actually put in (inflows − outflows) across the
  // completed ledger. Deliberately NOT "sum of purchases": a book that has
  // redeemed half of what it bought has not invested the gross figure, and the
  // gap between this and AUM is the gain the card exists to make visible.
  //
  // Switches and STPs are excluded. Both move money BETWEEN schemes — neither is
  // new money into the book, whichever leg a given row is. They were being
  // counted because the feed parser collapses a switch-in and a switch-out into
  // one "switch" type and then read direction off that, making every leg an
  // inflow: on VSN Financial Services, 1,666 switch rows, all inflow, none
  // outflow, Rs 39.56 Cr booked as fresh investment. That is what pushed Total
  // Investment above Total AUM and showed the book at an unrealised LOSS.
  //
  // Dropping them is right even once the legs are told apart, because a matched
  // pair nets to zero anyway — and it does not depend on the registrar spelling
  // the leg out, which several of them do not.
  const invested = (await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END), 0) AS v
      FROM transactions
     WHERE status IN ('processed', 'successful') AND amount IS NOT NULL
       AND type NOT IN ('switch', 'stp')
  `)).rows[0] as any;

  // 30 days of history in one pass; the sparkline reads it oldest → newest.
  const hist = (await tx.execute(sql`
    SELECT snapshot_date, total_aum::numeric AS aum, monthly_sip::numeric AS sip,
           active_clients::numeric AS clients
      FROM firm_snapshots
     WHERE snapshot_date >= current_date - interval '35 days'
     ORDER BY snapshot_date ASC
  `)).rows as Array<{
    snapshot_date: string; aum: string; sip: string; clients: string;
  }>;

  // "Yesterday" is the most recent snapshot STRICTLY before today — not
  // `now - 1 day`. A tenant whose worker missed a night would otherwise show a
  // day-delta against nothing; this quietly compares against the last real one.
  const today = new Date().toISOString().slice(0, 10);
  const past = hist.filter((h) => String(h.snapshot_date).slice(0, 10) < today);
  const prev = past.length ? past[past.length - 1] : null;

  // MoM baseline: the snapshot closest to 30 days ago, not an exact date match.
  const monthAgoTs = Date.now() - 30 * 864e5;
  let momRow: (typeof hist)[number] | null = null;
  let bestGap = Infinity;
  for (const h of past) {
    const gap = Math.abs(new Date(String(h.snapshot_date)).getTime() - monthAgoTs);
    if (gap < bestGap) {
      bestGap = gap;
      momRow = h;
    }
  }
  // Only honour it if it really is ~a month back; otherwise there is no MoM yet.
  if (bestGap > 12 * 864e5) momRow = null;

  const aum = num(live?.aum);
  const sipBook = num(live?.sip_book);
  const sipClients = num(live?.sip_clients);
  const clients = num(live?.clients);

  return [
    {
      key: "aum",
      label: "Total AUM",
      value: aum,
      day: delta(aum, prev ? num(prev.aum) : null),
      mom: delta(aum, momRow ? num(momRow.aum) : null),
      series: hist.map((h) => num(h.aum)),
    },
    {
      key: "invested",
      label: "Total Investment",
      value: num(invested?.v),
      // The ledger has no daily snapshot, so a Day delta would be invented.
      // Show the gain against AUM instead — the number an MFD actually reads.
      day: null,
      mom: null,
      series: [],
      // Gain is only meaningful when we actually KNOW what was invested. A firm
      // that has not imported a transaction ledger has invested = 0, and
      // `aum - 0` then claims the entire book as unrealised gain — production
      // showed "Total Investment Rs 0 / Unrealised gain Rs 1.90 Cr", which is
      // not a gain, it is a missing ledger. Suppress it instead of inventing it.
      footnote:
        num(invested?.v) > 0
          ? { label: "Unrealised gain", value: aum - num(invested?.v) }
          : { label: "Unrealised gain", value: null, hint: "import transactions to see this" },
    },
    {
      key: "sip_book",
      label: "SIP Book",
      value: sipBook,
      day: delta(sipBook, prev ? num(prev.sip) : null),
      mom: delta(sipBook, momRow ? num(momRow.sip) : null),
      series: hist.map((h) => num(h.sip)),
      footnote: { label: "Average SIP", value: sipClients > 0 ? sipBook / sipClients : 0 },
    },
    {
      // A fourth headline metric, from a column the snapshot table already
      // carried — `active_clients` was being written nightly and read by
      // nothing. The strip needs four to balance, and client count is the one
      // figure an owner checks alongside the money.
      key: "clients",
      label: "Active clients",
      value: clients,
      day: delta(clients, prev ? num(prev.clients) : null),
      mom: delta(clients, momRow ? num(momRow.clients) : null),
      series: hist.map((h) => num(h.clients)),
      footnote: null,
    },
  ];
}

// ── Activity tiles ──────────────────────────────────────────────────────────

export const ACTIVITY_RANGES = [3, 7, 10, 15, 30] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export type ActivityTile = {
  key: string;
  label: string;
  count: number;
  amount: number;
  /** Drill-through target on the transactions list. */
  href: string;
  tone: "in" | "out" | "sip" | "neutral";
};

/**
 * Transaction activity over the last `days` days, bucketed the way an MFD
 * reads their day: money in, money out, SIP movement, and failures.
 *
 * One grouped query rather than eight counts — on a 200k-row ledger the
 * difference is a single index scan versus eight.
 */
export async function loadActivityTiles(tx: Tx, days: ActivityRange): Promise<ActivityTile[]> {
  const rows = (await tx.execute(sql`
    SELECT type, status, direction,
           count(*)::int AS n,
           COALESCE(SUM(amount::numeric), 0) AS amt
      FROM transactions
     WHERE order_date >= current_date - ${sql.raw(String(days))} * interval '1 day'
     GROUP BY type, status, direction
  `)).rows as Array<{ type: string; status: string; direction: string; n: number; amt: string }>;

  const ok = (r: (typeof rows)[number]) => r.status === "processed" || r.status === "successful";
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => {
    let count = 0;
    let amount = 0;
    for (const r of rows) if (pred(r)) { count += num(r.n); amount += num(r.amt); }
    return { count, amount };
  };

  const q = `?days=${days}`;
  const purchase = sum((r) => ok(r) && (r.type === "purchase" || r.type === "lumpsum"));
  const redemption = sum((r) => ok(r) && r.type === "redemption");
  const sipTxns = sum((r) => ok(r) && r.type === "sip");
  const stp = sum((r) => ok(r) && r.type === "stp");
  const swp = sum((r) => ok(r) && r.type === "swp");
  const switches = sum((r) => ok(r) && r.type === "switch");
  const stopped = sum((r) => ok(r) && (r.type === "sip_stop" || r.type === "sip_pause"));
  const rejected = sum((r) => r.status === "rejected");

  return [
    { key: "purchase", label: "Purchases", ...purchase, href: `/dashboard/transactions${q}&type=purchase`, tone: "in" },
    { key: "redemption", label: "Redemptions", ...redemption, href: `/dashboard/transactions${q}&type=redemption`, tone: "out" },
    { key: "sip", label: "SIP instalments", ...sipTxns, href: `/dashboard/transactions${q}&type=sip`, tone: "sip" },
    { key: "switch", label: "Switches", ...switches, href: `/dashboard/transactions${q}&type=switch`, tone: "neutral" },
    { key: "stp", label: "STP", ...stp, href: `/dashboard/transactions${q}&type=stp`, tone: "neutral" },
    { key: "swp", label: "SWP", ...swp, href: `/dashboard/transactions${q}&type=swp`, tone: "out" },
    { key: "sip_stop", label: "SIP stopped / paused", ...stopped, href: `/dashboard/transactions${q}&type=sip_stop`, tone: "out" },
    { key: "rejected", label: "Rejections", ...rejected, href: `/dashboard/transactions${q}&status=rejected`, tone: "out" },
  ];
}
