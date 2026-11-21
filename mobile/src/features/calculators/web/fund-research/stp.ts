// Copied verbatim from src/lib/fund-research/stp.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * STP return on two schemes' real NAV histories.
 *
 * A lumpsum is bought in the FROM scheme (its date's NAV, else the next
 * available). On each scheduled date between the STP start and end, units are
 * redeemed from it and the money buys the TO scheme — both legs at the
 * transfer date's NAV, else the next available one (nav.ts). Two modes:
 *
 *   fixed        — transfer the STP amount each time; when the FROM scheme
 *                  holds less than that, the last transfer takes what is left
 *                  and the STP ends.
 *   appreciation — the "profit transfer" STP: transfer only the value above
 *                  the initial investment on that date (value − initial); a
 *                  period with no appreciation transfers nothing.
 *
 * Each leg is valued at the STP end (latest NAV on or before it) and on
 * `valueOn` (default: the STP end). Leg returns: absolute % and XIRR on the
 * leg's own dated flows; the total is the whole investment.
 */

import { xirr } from "../xirr";
import {
  type Frequency, type NavSeries, type Outcome,
  absoluteReturnPct, dmy, execute, fail, firstNav, navOnOrAfter, navOnOrBefore, scheduleDates,
} from "./nav";

export type StpMode = "fixed" | "appreciation";

export type StpReturnInput = {
  initialAmount: number;
  investDate: string;
  mode: StpMode;
  /** Fixed mode: the amount moved each time. Ignored for appreciation. */
  stpAmount: number;
  frequency: Frequency;
  /** Day of the month for monthly / quarterly transfers. */
  stpDay: number;
  stpStart: string;
  stpEnd: string;
  valueOn?: string;
};

export type StpRow = {
  scheduled: string;
  date: string;
  fromNav: number;
  unitsOut: number;
  amount: number;
  fromUnitsLeft: number;
  fromValue: number;
  toDate: string;
  toNav: number;
  unitsIn: number;
  toUnits: number;
  toValue: number;
};

export type StpLeg = {
  units: number;
  valueAtEnd: number;
  valueAtEndDate: string;
  currentValue: number;
  currentValueDate: string;
  profit: number;
  absolutePct: number | null;
  xirrPct: number | null;
};

export type StpReturn = {
  rows: StpRow[];
  buyDate: string;
  buyNav: number;
  initialUnits: number;
  transfers: number;
  transferred: number;
  /** Appreciation mode: scheduled periods with nothing above the initial. */
  periodsWithoutTransfer: number;
  /** Fixed mode: the FROM scheme ran out before the STP end. */
  exhausted: boolean;
  from: StpLeg;
  to: StpLeg;
  total: { invested: number; currentValue: number; profit: number; absolutePct: number | null; xirrPct: number | null };
};

const PAISA = 0.005;

const pct = (r: number | null) => (r === null ? null : r * 100);

export function stpReturn(from: NavSeries, to: NavSeries, inp: StpReturnInput): Outcome<StpReturn> {
  const fl = firstNav(from);
  const tl = firstNav(to);
  if (!fl || !tl) return fail("Both schemes need NAV history.");
  if (!(inp.initialAmount > 0)) return fail("Enter the initial investment.");
  if (inp.mode === "fixed" && !(inp.stpAmount > 0)) return fail("Enter the STP amount.");
  if (!(inp.stpStart <= inp.stpEnd)) return fail("The STP start must be on or before the STP end.");
  if (inp.stpStart < inp.investDate) return fail("The STP cannot start before the investment date.");
  if (inp.investDate < fl.date) return fail(`The transfer-from scheme launched on ${dmy(fl.date)} — after the investment date.`);
  const valueOn = inp.valueOn ?? inp.stpEnd;
  if (valueOn < inp.stpEnd) return fail("The valuation date cannot be before the STP end.");

  const buy = navOnOrAfter(from, inp.investDate);
  if (!buy || buy.date > inp.stpEnd) return fail("No NAV for the investment date before the STP end.");

  const initial = inp.initialAmount;
  let fromUnits = initial / buy.nav;
  const initialUnits = fromUnits;
  let toUnits = 0;
  let transferred = 0;
  let idle = 0;
  let exhausted = false;
  const rows: StpRow[] = [];

  for (const d of scheduleDates(inp.frequency, inp.stpStart, inp.stpEnd, inp.stpDay)) {
    const out = execute(from, d, inp.stpEnd);
    if (!out.ok || out.hit.date < buy.date) continue;
    const into = execute(to, out.hit.date, inp.stpEnd);
    if (!into.ok) continue;
    const fromValue = fromUnits * out.hit.nav;
    let amount = inp.mode === "fixed" ? Math.min(inp.stpAmount, fromValue) : Math.max(0, fromValue - initial);
    if (amount < PAISA) { idle++; continue; }
    const last = inp.mode === "fixed" && fromValue - amount < PAISA;
    const unitsOut = last ? fromUnits : amount / out.hit.nav;
    if (last) amount = fromValue;
    fromUnits = last ? 0 : fromUnits - unitsOut;
    const unitsIn = amount / into.hit.nav;
    toUnits += unitsIn;
    transferred += amount;
    rows.push({
      scheduled: d, date: out.hit.date, fromNav: out.hit.nav, unitsOut, amount,
      fromUnitsLeft: fromUnits, fromValue: fromUnits * out.hit.nav,
      toDate: into.hit.date, toNav: into.hit.nav, unitsIn, toUnits, toValue: toUnits * into.hit.nav,
    });
    if (last) { exhausted = true; break; }
  }

  const fEnd = navOnOrBefore(from, inp.stpEnd);
  const tEnd = navOnOrBefore(to, inp.stpEnd);
  const fNow = navOnOrBefore(from, valueOn);
  const tNow = navOnOrBefore(to, valueOn);
  if (!fEnd || !fNow) return fail("The transfer-from scheme has no NAV to value it on.");

  const fromCurrent = fromUnits * fNow.nav;
  const toCurrent = tNow ? toUnits * tNow.nav : 0;
  const fromLeg: StpLeg = {
    units: fromUnits,
    valueAtEnd: fromUnits * fEnd.nav,
    valueAtEndDate: fEnd.date,
    currentValue: fromCurrent,
    currentValueDate: fNow.date,
    profit: transferred + fromCurrent - initial,
    absolutePct: absoluteReturnPct(initial, transferred + fromCurrent),
    xirrPct: pct(xirr([
      { date: buy.date, amount: -initial },
      ...rows.map((r) => ({ date: r.date, amount: r.amount })),
      { date: fNow.date, amount: fromCurrent },
    ])),
  };
  const toLeg: StpLeg = {
    units: toUnits,
    valueAtEnd: tEnd ? toUnits * tEnd.nav : 0,
    valueAtEndDate: tEnd?.date ?? inp.stpEnd,
    currentValue: toCurrent,
    currentValueDate: tNow?.date ?? valueOn,
    profit: toCurrent - transferred,
    absolutePct: absoluteReturnPct(transferred, toCurrent),
    xirrPct: rows.length && tNow ? pct(xirr([
      ...rows.map((r) => ({ date: r.toDate, amount: -r.amount })),
      { date: tNow.date, amount: toCurrent },
    ])) : null,
  };
  const totalValue = fromCurrent + toCurrent;
  const totalFlows = [{ date: buy.date, amount: -initial }, { date: fNow.date, amount: fromCurrent }];
  if (tNow && toCurrent > 0) totalFlows.push({ date: tNow.date, amount: toCurrent });
  return {
    ok: true,
    rows,
    buyDate: buy.date,
    buyNav: buy.nav,
    initialUnits,
    transfers: rows.length,
    transferred,
    periodsWithoutTransfer: idle,
    exhausted,
    from: fromLeg,
    to: toLeg,
    total: {
      invested: initial,
      currentValue: totalValue,
      profit: totalValue - initial,
      absolutePct: absoluteReturnPct(initial, totalValue),
      xirrPct: pct(xirr(totalFlows)),
    },
  };
}
