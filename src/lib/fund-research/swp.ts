/**
 * SWP return on a scheme's real NAV history.
 *
 * A lumpsum is bought on its date's NAV (else the next available); on each
 * scheduled date between the SWP start and end, the withdrawal amount is
 * redeemed at that date's NAV (else the next available). When the holding is
 * worth less than one withdrawal, the last one takes what is left and the SWP
 * ends. What remains is valued at the latest NAV on or before `valueOn`
 * (default: the SWP end).
 *
 * Capital gain per withdrawal: units leave FIFO (oldest purchase first), so
 * gain = amount − the purchase cost of exactly those units. With one lumpsum
 * there is one lot; the lot machinery is general so a top-up keeps FIFO honest.
 * "Days invested" is the age of the oldest lot the withdrawal touched.
 */

import { xirr } from "@/lib/calculators/xirr";
import {
  type Frequency, type NavSeries, type Outcome,
  absoluteReturnPct, daysBetween, dmy, execute, fail, firstNav, navOnOrAfter, navOnOrBefore, scheduleDates,
} from "./nav";

export type SwpReturnInput = {
  amount: number;
  investDate: string;
  withdrawal: number;
  frequency: Frequency;
  swpDay: number;
  swpStart: string;
  swpEnd: string;
  valueOn?: string;
};

export type Lot = { date: string; units: number; nav: number };

export type SwpRow = {
  scheduled: string;
  date: string;
  nav: number;
  amount: number;
  unitsRedeemed: number;
  unitsLeft: number;
  /** Purchase cost of the units redeemed (FIFO). */
  cost: number;
  capitalGain: number;
  daysInvested: number;
  /** Units left × this NAV. */
  value: number;
};

export type SwpReturn = {
  rows: SwpRow[];
  buyDate: string;
  buyNav: number;
  initialUnits: number;
  withdrawals: number;
  totalWithdrawn: number;
  totalCapitalGain: number;
  exhausted: boolean;
  unitsLeft: number;
  valueDate: string;
  valueNav: number;
  remainingValue: number;
  profit: number;
  absolutePct: number | null;
  xirrPct: number | null;
};

/**
 * Take `units` out of `lots` oldest-first (mutates `lots`). Returns the cost of
 * the units taken and the date of the oldest lot touched.
 */
export function redeemFifo(lots: Lot[], units: number): { cost: number; oldest: string | null } {
  let left = units;
  let cost = 0;
  let oldest: string | null = null;
  while (left > 1e-12 && lots.length) {
    const lot = lots[0];
    oldest ??= lot.date;
    const take = Math.min(lot.units, left);
    cost += take * lot.nav;
    lot.units -= take;
    left -= take;
    if (lot.units <= 1e-12) lots.shift();
  }
  return { cost, oldest };
}

const PAISA = 0.005;

export function swpReturn(s: NavSeries, inp: SwpReturnInput): Outcome<SwpReturn> {
  const launch = firstNav(s);
  if (!launch) return fail("No NAV history for this scheme.");
  if (!(inp.amount > 0)) return fail("Enter the lumpsum.");
  if (!(inp.withdrawal > 0)) return fail("Enter the withdrawal amount.");
  if (!(inp.swpStart <= inp.swpEnd)) return fail("The SWP start must be on or before the SWP end.");
  if (inp.swpStart < inp.investDate) return fail("The SWP cannot start before the investment date.");
  if (inp.investDate < launch.date) return fail(`Launched on ${dmy(launch.date)} — after the investment date.`);
  const valueOn = inp.valueOn ?? inp.swpEnd;
  if (valueOn < inp.swpEnd) return fail("The valuation date cannot be before the SWP end.");
  const buy = navOnOrAfter(s, inp.investDate);
  if (!buy || buy.date > inp.swpEnd) return fail("No NAV for the investment date before the SWP end.");
  const val = navOnOrBefore(s, valueOn);
  if (!val) return fail("No NAV to value the holding on.");

  const lots: Lot[] = [{ date: buy.date, units: inp.amount / buy.nav, nav: buy.nav }];
  const initialUnits = lots[0].units;
  let units = initialUnits;
  let withdrawn = 0;
  let gains = 0;
  let exhausted = false;
  const rows: SwpRow[] = [];

  for (const d of scheduleDates(inp.frequency, inp.swpStart, inp.swpEnd, inp.swpDay)) {
    const ex = execute(s, d, inp.swpEnd);
    if (!ex.ok || ex.hit.date < buy.date) continue;
    const worth = units * ex.hit.nav;
    const last = worth - inp.withdrawal < PAISA;
    const amount = last ? worth : inp.withdrawal;
    const out = last ? units : amount / ex.hit.nav;
    const { cost, oldest } = redeemFifo(lots, out);
    units = last ? 0 : units - out;
    withdrawn += amount;
    gains += amount - cost;
    rows.push({
      scheduled: d, date: ex.hit.date, nav: ex.hit.nav, amount, unitsRedeemed: out, unitsLeft: units,
      cost, capitalGain: amount - cost, daysInvested: oldest ? daysBetween(oldest, ex.hit.date) : 0,
      value: units * ex.hit.nav,
    });
    if (last) { exhausted = true; break; }
  }

  const remainingValue = units * val.nav;
  const rate = xirr([
    { date: buy.date, amount: -inp.amount },
    ...rows.map((r) => ({ date: r.date, amount: r.amount })),
    { date: val.date, amount: remainingValue },
  ]);
  return {
    ok: true,
    rows,
    buyDate: buy.date,
    buyNav: buy.nav,
    initialUnits,
    withdrawals: rows.length,
    totalWithdrawn: withdrawn,
    totalCapitalGain: gains,
    exhausted,
    unitsLeft: units,
    valueDate: val.date,
    valueNav: val.nav,
    remainingValue,
    profit: withdrawn + remainingValue - inp.amount,
    absolutePct: absoluteReturnPct(inp.amount, withdrawn + remainingValue),
    xirrPct: rate === null ? null : rate * 100,
  };
}
