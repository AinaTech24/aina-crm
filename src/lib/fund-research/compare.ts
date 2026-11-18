/**
 * Point-to-point comparison of a scheme over one period, from its real NAVs.
 *
 * Growth: the amount bought at the start date's NAV (else the next available)
 * and valued at the latest NAV on or before the end date; absolute return and
 * CAGR (none under a year) as nav.ts.
 *
 * Risk, from the period's NAV-to-NAV returns r_i = NAV_i ÷ NAV_(i−1) − 1
 * (every published NAV between the two dates):
 *   mean   = average r_i × 252           (annualised arithmetic mean, %)
 *   σ      = sample std of r_i × √252    (annualised standard deviation, %)
 *   Sharpe = (mean − risk-free rate) ÷ σ
 * 252 trading days a year. No alpha or beta: they need a benchmark index
 * series, which this data does not carry.
 */

import {
  type NavSeries, type Outcome,
  absoluteReturnPct, cagrPct, daysBetween, fail, firstNav, dmy, mean, navOnOrAfter, navOnOrBefore, sampleStd,
} from "./nav";

export const TRADING_DAYS = 252;

export type PointToPoint = {
  startDate: string;
  startNav: number;
  endDate: string;
  endNav: number;
  days: number;
  growthValue: number;
  absolutePct: number | null;
  cagrPct: number | null;
  observations: number;
  meanPct: number | null;
  stdDevPct: number | null;
  sharpe: number | null;
};

export function pointToPoint(
  s: NavSeries,
  inp: { amount: number; startDate: string; endDate: string; riskFreePct: number },
): Outcome<PointToPoint> {
  const launch = firstNav(s);
  if (!launch) return fail("No NAV history for this scheme.");
  if (!(inp.startDate < inp.endDate)) return fail("The start date must be before the end date.");
  if (inp.startDate < launch.date) return fail(`Launched on ${dmy(launch.date)} — after the start date.`);
  const a = navOnOrAfter(s, inp.startDate);
  const b = navOnOrBefore(s, inp.endDate);
  if (!a || !b || b.index <= a.index) return fail("Fewer than two NAVs in this period.");
  const rets: number[] = [];
  for (let i = a.index + 1; i <= b.index; i++) rets.push(s.navs[i] / s.navs[i - 1] - 1);
  const m = rets.length ? mean(rets) * TRADING_DAYS * 100 : NaN;
  const sd = sampleStd(rets) * Math.sqrt(TRADING_DAYS) * 100;
  const days = daysBetween(a.date, b.date);
  const amount = inp.amount > 0 ? inp.amount : 0;
  const growthValue = (amount * b.nav) / a.nav;
  return {
    ok: true,
    startDate: a.date,
    startNav: a.nav,
    endDate: b.date,
    endNav: b.nav,
    days,
    growthValue,
    absolutePct: absoluteReturnPct(a.nav, b.nav),
    cagrPct: cagrPct(a.nav, b.nav, days),
    observations: rets.length,
    meanPct: Number.isFinite(m) ? m : null,
    stdDevPct: Number.isFinite(sd) ? sd : null,
    sharpe: Number.isFinite(m) && Number.isFinite(sd) && sd > 1e-9 ? (m - inp.riskFreePct) / sd : null,
  };
}
