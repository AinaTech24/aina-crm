/**
 * Retirement Need Based — math engine.
 *
 * From today's monthly expense: the expense at retirement (inflated at the
 * pre-retirement rate), the corpus that pays it every month until the annuity
 * end age (rising at the post-retirement rate) and still leaves a chosen balance,
 * the gap after the existing investment and any money receivable at retirement,
 * and four ways to fund that gap: a SIP till retirement, a SIP for 5 or 10 years
 * then held, or a lumpsum today. Up to two return scenarios.
 *
 * CONVENTIONS (verified to the reference case: age 32 → 55, ₹40,000/month,
 * 6% / 5% inflation, 12% / 8% returns, ₹2,00,000 @ 7.5%, ₹50,00,000 receivable,
 * annuity to 85, ₹1,00,00,000 left → expense ₹1,52,790, corpus ₹3,81,67,725,
 * gap ₹3,21,12,306, SIP ₹24,047 / ₹51,488 / ₹32,849, lumpsum ₹23,69,501, and
 * every row of the annuity table):
 *   • Rates are EFFECTIVE: monthly m = (1 + r)^(1/12) − 1 (sip360 convention).
 *   • Annuity payments are made at the START of each month (annuity-due) —
 *     unlike the SWP calculators, which pay at month end. Payment k (k = 0…N−1)
 *     = expense at retirement × (1 + g)^k, g = (1 + post inflation)^(1/12) − 1,
 *     so the first payment equals the expense at retirement.
 *   • The existing investment compounds ANNUALLY at its own rate.
 *   • SIPs are begin-mode at the accumulation rate (sip360 fvSip / limitedPeriodFv).
 *   • Table: balance(k+1) = (balance(k) − payment(k)) · (1 + m_dist), printed
 *     every 12 months; "monthly annuity" = the average of that year's payments.
 */

import { fvSip, limitedPeriodFv, monthlyRate } from "./sip360";

export type RetirementScenarioInput = { accPct: number; distPct: number };

export type RetirementNeedInput = {
  currentAge: number;
  retirementAge: number;
  monthlyExpense: number;
  inflPrePct: number;
  inflPostPct: number;
  scenarios: RetirementScenarioInput[];
  currentInvestment: number;
  currentInvestmentPct: number;
  receivable: number;
  annuityEndAge: number;
  endBalance: number;
};

export type RetirementNeedRow = { age: number; avgMonthlyAnnuity: number; balanceEoy: number };

export type RetirementNeedScenario = {
  accPct: number;
  distPct: number;
  corpus: number;
  gap: number; // corpus − FV(current) − receivable (may be negative)
  sipTillRetirement: number;
  /** null when the years to retirement do not exceed the SIP period. */
  sip5y: number | null;
  sip10y: number | null;
  lumpsum: number;
  rows: RetirementNeedRow[];
};

export type RetirementNeedResult = {
  yearsToRetirement: number;
  annuityYears: number;
  expenseAtRetirement: number;
  fvCurrent: number;
  scenarios: RetirementNeedScenario[];
};

export function retirementNeed(input: RetirementNeedInput): RetirementNeedResult {
  const nAcc = Math.max(0, Math.round(input.retirementAge - input.currentAge));
  const annuityYears = Math.max(0, Math.round(input.annuityEndAge - input.retirementAge));
  const N = annuityYears * 12;
  const expenseAtRetirement = input.monthlyExpense * Math.pow(1 + input.inflPrePct / 100, nAcc);
  const g = monthlyRate(input.inflPostPct);
  const fvCurrent = input.currentInvestment * Math.pow(1 + input.currentInvestmentPct / 100, nAcc);

  const scenarios = input.scenarios.map((sc): RetirementNeedScenario => {
    const md = monthlyRate(sc.distPct);
    // Corpus = PV (begin-mode) of the rising payments + PV of the end balance.
    let corpus = 0;
    for (let k = 0; k < N; k++) corpus += (expenseAtRetirement * Math.pow(1 + g, k)) / Math.pow(1 + md, k);
    corpus += input.endBalance / Math.pow(1 + md, N);

    const gap = corpus - fvCurrent - input.receivable;
    const need = Math.max(0, gap);
    const sipFactor = fvSip(1, sc.accPct, 12 * nAcc);
    const limited = (k: number): number | null => {
      if (nAcc <= k) return null;
      const f = limitedPeriodFv(1, k, nAcc, sc.accPct);
      return f > 0 ? need / f : null;
    };
    const sipTillRetirement = sipFactor > 0 ? need / sipFactor : need > 0 ? NaN : 0;
    const lumpsum = need / Math.pow(1 + sc.accPct / 100, nAcc);

    // Year-wise drawdown.
    const rows: RetirementNeedRow[] = [];
    let balance = corpus;
    let yearSum = 0;
    for (let k = 0; k < N; k++) {
      const pay = expenseAtRetirement * Math.pow(1 + g, k);
      yearSum += pay;
      balance = (balance - pay) * (1 + md);
      if ((k + 1) % 12 === 0) {
        rows.push({ age: input.retirementAge + (k + 1) / 12, avgMonthlyAnnuity: yearSum / 12, balanceEoy: balance });
        yearSum = 0;
      }
    }

    return {
      accPct: sc.accPct,
      distPct: sc.distPct,
      corpus,
      gap,
      sipTillRetirement,
      sip5y: limited(5),
      sip10y: limited(10),
      lumpsum,
      rows,
    };
  });

  return { yearsToRetirement: nAcc, annuityYears, expenseAtRetirement, fvCurrent, scenarios };
}
