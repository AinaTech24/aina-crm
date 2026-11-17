/**
 * SIP return on a scheme's real NAV history.
 *
 * Each instalment is bought at its date's NAV, else the next available one
 * (nav.ts). The portfolio is valued at the latest NAV on or before `valueOn`
 * (default: the end date). XIRR runs on the dated instalments (outflows) and
 * that value (inflow) — `xirr` from lib/calculators/xirr.ts.
 *
 * Yearly enhancement (top-up): from each anniversary of the first instalment
 * the amount rises by `stepUpPct` % — amount × (1 + p)^(full years since the
 * first instalment), rounded to the rupee.
 */

import { xirr } from "@/lib/calculators/xirr";
import {
  type Frequency, type NavSeries, type Outcome,
  absoluteReturnPct, dmy, execute, fail, firstNav, fullYearsBetween, navOnOrBefore, scheduleDates,
} from "./nav";

export type SipReturnInput = {
  amount: number;
  frequency: Frequency;
  /** Day of the month for monthly / quarterly (1–31, clamped to short months). */
  sipDay: number;
  startDate: string;
  endDate: string;
  /** Value the holding on this date (default: endDate). */
  valueOn?: string;
  /** Yearly enhancement of the instalment, % (0 = none). */
  stepUpPct?: number;
};

export type SipCashflowRow = {
  scheduled: string;
  date: string;
  nav: number;
  amount: number;
  units: number;
  cumulativeUnits: number;
  cumulativeInvested: number;
  /** Cumulative units × this NAV. */
  value: number;
};

export type SipReturn = {
  rows: SipCashflowRow[];
  instalments: number;
  invested: number;
  units: number;
  valueDate: string;
  valueNav: number;
  currentValue: number;
  profit: number;
  absolutePct: number | null;
  xirrPct: number | null;
  skippedBeforeLaunch: number;
};

export function sipReturn(s: NavSeries, inp: SipReturnInput): Outcome<SipReturn> {
  const launch = firstNav(s);
  if (!launch) return fail("No NAV history for this scheme.");
  if (!(inp.amount > 0)) return fail("Enter an instalment amount.");
  if (!(inp.startDate <= inp.endDate)) return fail("The start date must be on or before the end date.");
  const valueOn = inp.valueOn ?? inp.endDate;
  const val = navOnOrBefore(s, valueOn);
  if (!val) return fail(`The scheme has no NAV on or before ${dmy(valueOn)}.`);

  const step = Math.max(0, inp.stepUpPct ?? 0) / 100;
  const sched = scheduleDates(inp.frequency, inp.startDate, inp.endDate, inp.sipDay);
  const bound = inp.endDate < val.date ? inp.endDate : val.date;
  const rows: SipCashflowRow[] = [];
  let units = 0;
  let invested = 0;
  let skipped = 0;
  let firstSched: string | null = null;
  for (const d of sched) {
    const ex = execute(s, d, bound);
    if (!ex.ok) { if (ex.reason === "before_launch") skipped++; continue; }
    firstSched ??= d;
    const years = step > 0 ? fullYearsBetween(firstSched, d) : 0;
    const amount = step > 0 ? Math.round(inp.amount * Math.pow(1 + step, years)) : inp.amount;
    const u = amount / ex.hit.nav;
    units += u;
    invested += amount;
    rows.push({
      scheduled: d, date: ex.hit.date, nav: ex.hit.nav, amount, units: u,
      cumulativeUnits: units, cumulativeInvested: invested, value: units * ex.hit.nav,
    });
  }
  if (!rows.length) {
    return fail(skipped
      ? `No instalment falls on or after the scheme's launch (${dmy(launch.date)}).`
      : "No instalment falls inside these dates.");
  }

  const currentValue = units * val.nav;
  const rate = xirr([
    ...rows.map((r) => ({ date: r.date, amount: -r.amount })),
    { date: val.date, amount: currentValue },
  ]);
  return {
    ok: true,
    rows,
    instalments: rows.length,
    invested,
    units,
    valueDate: val.date,
    valueNav: val.nav,
    currentValue,
    profit: currentValue - invested,
    absolutePct: absoluteReturnPct(invested, currentValue),
    xirrPct: rate === null ? null : rate * 100,
    skippedBeforeLaunch: skipped,
  };
}
