/**
 * The Total row of the client page's "Portfolio holdings" table.
 *
 * Invested, Gain and Return used to be blank for the WHOLE client as soon as one
 * scheme had no cost on record (a holding whose purchases the RTA history never
 * sent — 2026-11-24, a 10-scheme client with one such scheme showed "—" three
 * times). A total over the schemes that DO have a cost is more useful than none,
 * so it is computed over those, and the caller is told how many were left out so
 * the page can say so — never a silent partial sum.
 *
 * Invested, Gain and Return share one basis (the schemes with a cost and a price),
 * so Return is never a gain on some schemes divided by the cost of others.
 */

export type TotalsHolding = {
  netUnits: number;
  /** Exact remaining cost; null when the ledger is incomplete. */
  investedNet: number | null;
  /** Cost estimated from an incomplete history. */
  investedEstimate?: number | null;
  currentValue: number | null;
  priced: boolean;
  hasTxns?: boolean;
  realisedGain?: number | null;
  dividend?: number | null;
};

export type HoldingsTotals = {
  units: number;
  /** Current value of the priced schemes. */
  current: number;
  /** Cost of every scheme that has one (exact, else estimated); null when none has. */
  invested: number | null;
  /** Current value less cost, over the schemes with BOTH a cost and a price; null when none. */
  gain: number | null;
  /** gain ÷ the cost of those same schemes, in %; null when that cost is not positive. */
  absRet: number | null;
  realised: number;
  dividend: number;
  /** Schemes counted in Invested, and in Gain / Return. */
  costRows: number;
  /** Schemes in the total. */
  rows: number;
  /** True when the totals are not exact: a scheme has no cost, or one used an estimate. */
  approx: boolean;
};

/** A scheme's cost: exact where the ledger is complete, else the estimate, else unknown. */
export function costOf(h: TotalsHolding): { value: number; estimated: boolean } | null {
  if (h.hasTxns && h.investedNet != null) return { value: h.investedNet, estimated: false };
  if (h.investedEstimate != null) return { value: h.investedEstimate, estimated: true };
  return null;
}

export function computeHoldingsTotals(src: TotalsHolding[]): HoldingsTotals {
  const num = (v: number | null | undefined) => Number(v) || 0;
  let invested = 0, costRows = 0, estimated = false;
  let gain = 0, gainCost = 0, gainRows = 0;
  let current = 0;
  for (const h of src) {
    const priced = h.priced && h.currentValue != null;
    if (priced) current += num(h.currentValue);
    const c = costOf(h);
    if (!c) continue;
    invested += c.value; costRows++;
    if (c.estimated) estimated = true;
    if (priced) { gain += num(h.currentValue) - c.value; gainCost += c.value; gainRows++; }
  }
  return {
    units: src.reduce((s, h) => s + num(h.netUnits), 0),
    current,
    invested: costRows > 0 ? invested : null,
    gain: gainRows > 0 ? gain : null,
    absRet: gainRows > 0 && gainCost > 0 ? (gain / gainCost) * 100 : null,
    realised: src.reduce((s, h) => s + num(h.realisedGain), 0),
    dividend: src.reduce((s, h) => s + num(h.dividend), 0),
    costRows,
    rows: src.length,
    approx: estimated || costRows < src.length || gainRows < costRows,
  };
}
