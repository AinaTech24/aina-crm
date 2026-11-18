/**
 * Term Insurance + SIP — math engine (three related views).
 *
 *   1. From a budget  (`termPlusSip`): a yearly outlay pays the term premium and
 *      the rest goes into a monthly SIP of (outlay − premium) / 12.
 *   2. From a goal    (`termPlusSipGoal`): the monthly SIP needed so the SIP
 *      corpus at the end of the term equals the cover amount.
 *   3. Against a traditional policy (`insuranceVsTermSip`): the same premium in
 *      an endowment-style policy vs a term plan + monthly SIP of the difference.
 *
 * CONVENTION — sip360's: EFFECTIVE monthly rate m = (1 + r)^(1/12) − 1, SIP paid
 * at the START of each month (annuity-due). Figures are PRE-TAX. The monthly SIP
 * is kept UNROUNDED in every projection (rounding it moves the year values).
 * The traditional policy's maturity is premium at the start of each year,
 * annual compounding.
 *
 * Verified to the reference cases:
 *   • Age 30, outlay ₹4,00,000, cover ₹1 cr, 30 yrs, premium ₹10,000, 12%
 *     → SIP ₹32,500/month, fund at 60 ₹10,01,31,629 (all 30 rows).
 *   • Goal ₹1 cr, 30 yrs, premium ₹10,000, 12% → SIP ₹3,246 (3,245.7277 used
 *     unrounded), annual investment ₹48,949, year 30 ₹1,00,00,000.
 *   • Premium ₹5,00,000, cover ₹50 L, 20 yrs, policy 7%, term ₹15,000, SIP 12%
 *     → maturity ₹2,19,32,588; SIP ₹40,417; fund ₹3,71,77,568.
 */

import { fvLumpsum, fvSip, requiredSip } from "./sip360";

export type TermSipRow = {
  year: number;
  age: number;
  /** What the client spends in the year: outlay (budget view) or premium + 12 × SIP (goal view). */
  annualOutlay: number;
  cover: number;
  sipValue: number;
  /** Paid out on an unfortunate event in this year: cover + SIP value. */
  payout: number;
};

export type TermPlusSipInput = {
  age: number;
  annualOutlay: number;
  sumAssured: number;
  termYears: number;
  premium: number;
  returnPct: number;
};

export type TermPlusSipResult = {
  balanceForSip: number; // yearly
  sipMonthly: number;
  finalValue: number;
  finalAge: number;
  rows: TermSipRow[];
};

function rowsFor(
  age: number,
  years: number,
  sipMonthly: number,
  returnPct: number,
  cover: number,
  outlay: number
): TermSipRow[] {
  const rows: TermSipRow[] = [];
  for (let y = 1; y <= years; y++) {
    const sipValue = fvSip(sipMonthly, returnPct, 12 * y);
    rows.push({ year: y, age: age + y, annualOutlay: outlay, cover, sipValue, payout: cover + sipValue });
  }
  return rows;
}

/** Budget view (#52): the outlay left after the premium becomes a monthly SIP. */
export function termPlusSip(input: TermPlusSipInput): TermPlusSipResult {
  const n = Math.max(0, Math.round(input.termYears));
  const balanceForSip = Math.max(0, input.annualOutlay - input.premium);
  const sipMonthly = balanceForSip / 12;
  const rows = rowsFor(input.age, n, sipMonthly, input.returnPct, input.sumAssured, input.annualOutlay);
  return {
    balanceForSip,
    sipMonthly,
    finalValue: rows.length ? rows[rows.length - 1].sipValue : 0,
    finalAge: input.age + n,
    rows,
  };
}

export type TermPlusSipGoalInput = {
  age: number;
  goal: number; // cover = goal
  termYears: number;
  premium: number;
  returnPct: number;
};

export type TermPlusSipGoalResult = {
  sipMonthly: number; // unrounded
  annualOutlay: number; // premium + 12 × SIP
  /** One-time lumpsum today that grows to the goal by the end of the term (same rate, same months). */
  lumpsumToday: number;
  finalAge: number;
  rows: TermSipRow[];
};

/** Goal view (#53): the SIP that grows to the cover amount by the end of the term. */
export function termPlusSipGoal(input: TermPlusSipGoalInput): TermPlusSipGoalResult {
  const n = Math.max(0, Math.round(input.termYears));
  const sipMonthly = requiredSip(input.goal, input.returnPct, 12 * n);
  const annualOutlay = input.premium + 12 * sipMonthly;
  // fvLumpsum(₹1) is the growth factor over the same 12 × n months.
  const growth = fvLumpsum(1, input.returnPct, 12 * n);
  const lumpsumToday = input.goal > 0 && growth > 0 ? input.goal / growth : 0;
  return {
    sipMonthly,
    annualOutlay,
    lumpsumToday,
    finalAge: input.age + n,
    rows: rowsFor(input.age, n, sipMonthly, input.returnPct, input.goal, annualOutlay),
  };
}

export type InsuranceVsTermSipInput = {
  premium: number;
  sumAssured: number;
  years: number;
  termPremium: number;
  sipRatePct: number;
  insuranceRatePct: number;
};

export type InsuranceVsTermSipRow = {
  year: number;
  policyValue: number;
  sipValue: number;
};

export type InsuranceVsTermSipResult = {
  maturity: number;
  monthlySip: number; // unrounded
  fundValue: number;
  difference: number; // fund − maturity
  rows: InsuranceVsTermSipRow[];
};

/** Policy view (#19): same yearly budget, policy vs term + monthly SIP. */
export function insuranceVsTermSip(input: InsuranceVsTermSipInput): InsuranceVsTermSipResult {
  const n = Math.max(0, Math.round(input.years));
  const i = input.insuranceRatePct / 100;
  const monthlySip = Math.max(0, input.premium - input.termPremium) / 12;
  const rows: InsuranceVsTermSipRow[] = [];
  let policy = 0;
  for (let y = 1; y <= n; y++) {
    policy = (policy + input.premium) * (1 + i); // premium at the start of the year
    rows.push({ year: y, policyValue: policy, sipValue: fvSip(monthlySip, input.sipRatePct, 12 * y) });
  }
  const maturity = rows.length ? rows[rows.length - 1].policyValue : 0;
  const fundValue = rows.length ? rows[rows.length - 1].sipValue : 0;
  return { maturity, monthlySip, fundValue, difference: fundValue - maturity, rows };
}
