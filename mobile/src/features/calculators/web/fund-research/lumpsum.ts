// Copied verbatim from src/lib/fund-research/lumpsum.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Lumpsum return on a scheme's real NAV history: bought at the start date's
 * NAV (else the next available one), valued at the latest NAV on or before
 * the end date. CAGR over the days between those two NAV dates (none under a
 * year); absolute return always. The tool runs this once per scheme (≤ 5).
 */

import {
  type NavSeries, type Outcome,
  absoluteReturnPct, cagrPct, daysBetween, dmy, fail, firstNav, navOnOrAfter, navOnOrBefore,
} from "./nav";

export type LumpsumReturnInput = { amount: number; startDate: string; endDate: string };

export type LumpsumReturn = {
  amount: number;
  buyDate: string;
  buyNav: number;
  units: number;
  valueDate: string;
  valueNav: number;
  value: number;
  profit: number;
  days: number;
  absolutePct: number | null;
  cagrPct: number | null;
};

export function lumpsumReturn(s: NavSeries, inp: LumpsumReturnInput): Outcome<LumpsumReturn> {
  const launch = firstNav(s);
  if (!launch) return fail("No NAV history for this scheme.");
  if (!(inp.amount > 0)) return fail("Enter an amount.");
  if (!(inp.startDate < inp.endDate)) return fail("The start date must be before the end date.");
  if (inp.startDate < launch.date) return fail(`Launched on ${dmy(launch.date)} — after the start date.`);
  const buy = navOnOrAfter(s, inp.startDate);
  const val = navOnOrBefore(s, inp.endDate);
  if (!buy || !val || val.date < buy.date) return fail("No NAV between the start and end dates.");
  const units = inp.amount / buy.nav;
  const value = units * val.nav;
  const days = daysBetween(buy.date, val.date);
  return {
    ok: true,
    amount: inp.amount,
    buyDate: buy.date,
    buyNav: buy.nav,
    units,
    valueDate: val.date,
    valueNav: val.nav,
    value,
    profit: value - inp.amount,
    days,
    absolutePct: absoluteReturnPct(inp.amount, value),
    cagrPct: cagrPct(inp.amount, value, days),
  };
}
