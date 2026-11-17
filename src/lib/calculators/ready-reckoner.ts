/**
 * Ready Reckoners — math engine for four grid calculators that share one shape:
 * one amount, up to 3 return rates (rows) × up to 5 periods in years (columns).
 *
 *   • lumpsum_fv   — what a one-time investment grows to          (₹ lakh, 2 dp)
 *   • lumpsum_need — one-time investment needed today for a target (₹ lakh, 2 dp)
 *   • sip_fv       — what a monthly SIP grows to                   (₹ lakh, 2 dp)
 *   • sip_need     — monthly SIP needed for a target               (₹, to the rupee)
 *
 * CONVENTIONS (each verified cell-for-cell against the reference case studies):
 *   • Lumpsum: ANNUAL compounding, (1 + r)^Y. Over whole years this equals the
 *     effective-monthly convention; fractional years use the power directly.
 *   • SIP: sip360's EFFECTIVE monthly rate m = (1 + r)^(1/12) − 1, payments at
 *     the START of each month (annuity-due), N = round(12 × years) months.
 *     A nominal r/12 engine would NOT match (12%/10y gives 23.23 L, not 22.40 L).
 *
 * Grid orientation is rows = rates, columns = years, kept in the order the
 * user entered them (never sorted). Blank / invalid boxes are skipped.
 * Cells are exact rupees; `displayCell` applies the reference rounding.
 */

import { fvSip, requiredSip } from "./sip360";

export type ReckonerMode = "lumpsum_fv" | "lumpsum_need" | "sip_fv" | "sip_need";

export const MAX_RATES = 3;
export const MAX_PERIODS = 5;

/** How a mode's cells are displayed: ₹ lakh to 2 dp, or whole rupees. */
export const CELL_UNIT: Record<ReckonerMode, "lakh" | "rupee"> = {
  lumpsum_fv: "lakh",
  lumpsum_need: "lakh",
  sip_fv: "lakh",
  sip_need: "rupee",
};

/** FV of a one-time investment, annual compounding. Rate 0 → the amount. */
export function lumpsumFv(amount: number, ratePct: number, years: number): number {
  if (!(amount > 0) || !(years >= 0)) return 0;
  return amount * Math.pow(1 + ratePct / 100, years);
}

/** One-time investment needed today to reach `target` in `years`. */
export function lumpsumNeeded(target: number, ratePct: number, years: number): number {
  if (!(target > 0) || !(years >= 0)) return 0;
  return target / Math.pow(1 + ratePct / 100, years);
}

/** FV of a monthly SIP (effective monthly rate, month-start payments). */
export function sipFv(monthly: number, ratePct: number, years: number): number {
  return fvSip(monthly, ratePct, Math.round(years * 12));
}

/** Monthly SIP needed to reach `target` (effective monthly rate, month-start). */
export function sipNeeded(target: number, ratePct: number, years: number): number {
  return requiredSip(target, ratePct, Math.round(years * 12));
}

export function reckonerCell(mode: ReckonerMode, amount: number, ratePct: number, years: number): number {
  switch (mode) {
    case "lumpsum_fv": return lumpsumFv(amount, ratePct, years);
    case "lumpsum_need": return lumpsumNeeded(amount, ratePct, years);
    case "sip_fv": return sipFv(amount, ratePct, years);
    case "sip_need": return sipNeeded(amount, ratePct, years);
  }
}

/** Keep valid entries in entry order, capped. Rates may be 0; periods must be > 0. */
export function cleanRates(values: Array<number | null | undefined>): number[] {
  return values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100)
    .slice(0, MAX_RATES);
}
export function cleanPeriods(values: Array<number | null | undefined>): number[] {
  return values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100)
    .slice(0, MAX_PERIODS);
}

export type ReadyReckonerInput = {
  mode: ReckonerMode;
  /** Lumpsum / monthly SIP (FV modes) or target corpus (need modes), ₹. */
  amount: number;
  ratesPct: Array<number | null | undefined>;
  years: Array<number | null | undefined>;
};

export type ReadyReckonerResult = {
  mode: ReckonerMode;
  unit: "lakh" | "rupee";
  rates: number[];
  years: number[];
  /** cells[rateIndex][yearIndex], exact rupees. */
  cells: number[][];
  /** False when the amount is ≤ 0 or no rate / period is usable. */
  valid: boolean;
};

export function computeReadyReckoner(input: ReadyReckonerInput): ReadyReckonerResult {
  const rates = cleanRates(input.ratesPct);
  const years = cleanPeriods(input.years);
  const valid = input.amount > 0 && rates.length > 0 && years.length > 0;
  const cells = valid
    ? rates.map((r) => years.map((y) => reckonerCell(input.mode, input.amount, r, y)))
    : [];
  return { mode: input.mode, unit: CELL_UNIT[input.mode], rates, years, cells, valid };
}

/**
 * The reference rounding of one cell: ₹ lakh to 2 dp (rounded from the exact
 * rupee figure to the nearest ₹1,000, then scaled) or whole rupees.
 */
export function displayCell(value: number, unit: "lakh" | "rupee"): number {
  return unit === "lakh" ? Math.round(value / 1000) / 100 : Math.round(value);
}
