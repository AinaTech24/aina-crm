/**
 * Compound interest — a principal growing at a nominal annual rate compounded
 * m times a year, with an optional regular addition.
 *
 *   A = P · (1 + r/m)^(m·t)          (standard compound-interest formula)
 *   Effective annual rate = (1 + r/m)^m − 1;   daily = 365 periods a year.
 *
 * Regular additions follow the same fractional-period convention Indian banks
 * use for recurring deposits: an addition made at a point that is not a
 * compounding date grows by (1 + r/m)^(m × time held in years). So a monthly
 * addition under quarterly compounding grows by (1 + r/4)^(1/3) a month.
 * Additions can be made at the START or the END of each addition period.
 *
 * Hand checks: ₹1,00,000 at 10% compounded quarterly for 5 years →
 * 1,00,000 × 1.025^20 = ₹1,63,862; effective rate 10.3813%. ₹1,000 added at
 * the end of every month at 12% compounded monthly for a year → ₹12,682.50.
 *
 * Not an effective-rate module in the sip360 sense (the rate is nominal per
 * compounding period, as quoted on deposits).
 */

export type CompoundFrequency = "yearly" | "half_yearly" | "quarterly" | "monthly" | "daily";
export type AdditionFrequency = "yearly" | "half_yearly" | "quarterly" | "monthly";

export const COMPOUND_PERIODS: Record<CompoundFrequency, number> = {
  yearly: 1,
  half_yearly: 2,
  quarterly: 4,
  monthly: 12,
  daily: 365,
};

export const ADDITION_PERIODS: Record<AdditionFrequency, number> = {
  yearly: 1,
  half_yearly: 2,
  quarterly: 4,
  monthly: 12,
};

/** Effective annual rate (%) of a nominal rate compounded `m` times a year. */
export function effectiveAnnualRate(nominalPct: number, m: number): number {
  return (Math.pow(1 + nominalPct / 100 / m, m) - 1) * 100;
}

/** Lumpsum value after `years`: P(1 + r/m)^(m·t). */
export function compoundValue(principal: number, nominalPct: number, m: number, years: number): number {
  return principal * Math.pow(1 + nominalPct / 100 / m, m * years);
}

export type CompoundingInput = {
  principal: number;
  ratePct: number;
  years: number;
  frequency: CompoundFrequency;
  /** Optional regular addition (0 = none). */
  addition: number;
  additionFrequency: AdditionFrequency;
  additionTiming: "start" | "end";
};

export type CompoundingRow = {
  year: number;
  /** Money put in to date (principal + additions). */
  invested: number;
  /** Interest earned to date. */
  interest: number;
  /** Interest earned in this year. */
  interestThisYear: number;
  total: number;
};

export type CompoundingResult = {
  rows: CompoundingRow[];
  invested: number;
  interest: number;
  total: number;
  effectiveRatePct: number;
};

export function compounding(input: CompoundingInput): CompoundingResult {
  const m = COMPOUND_PERIODS[input.frequency];
  const a = ADDITION_PERIODS[input.additionFrequency];
  const years = Math.max(0, Math.round(input.years));
  // Growth over one addition period (1/a of a year).
  const g = Math.pow(1 + input.ratePct / 100 / m, m / a);
  const add = Math.max(0, input.addition);
  let bal = Math.max(0, input.principal);
  let invested = bal;
  const rows: CompoundingRow[] = [];
  let prevInterest = 0;
  for (let y = 1; y <= years; y++) {
    for (let k = 0; k < a; k++) {
      if (input.additionTiming === "start") { bal += add; invested += add; }
      bal *= g;
      if (input.additionTiming === "end") { bal += add; invested += add; }
    }
    const interest = bal - invested;
    rows.push({ year: y, invested, interest, interestThisYear: interest - prevInterest, total: bal });
    prevInterest = interest;
  }
  return {
    rows,
    invested,
    interest: bal - invested,
    total: bal,
    effectiveRatePct: effectiveAnnualRate(input.ratePct, m),
  };
}
