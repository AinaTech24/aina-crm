/**
 * SWP End Period — math engine.
 *
 * Estimates how long a corpus lasts under a Systematic Withdrawal Plan. The
 * corpus is built either from a lumpsum (optionally deferred/grown) or an
 * SIP accumulated over a deferment period, then drawn down monthly — at a
 * fixed amount or a % of the starting corpus — optionally rising with
 * inflation.
 *
 * CONVENTION — effective monthly rate ((1+annual)^(1/12)−1), and:
 *   • Accumulation SIPs are begin-mode (annuity-due, sip360.fvSip).
 *   • The accumulated corpus is ROUNDED TO THE RUPEE before the SWP starts.
 *   • SWP withdrawals are END-of-month: each month the balance grows, then the
 *     withdrawal is taken (bal = bal·(1+m) − W).
 *   • The duration counts FULL withdrawals only: a month is paid while
 *     bal·(1+m) ≥ W; what is left after the last full one is reported as the
 *     leftover, never paid out as a partial withdrawal.
 *   • With inflation on, the withdrawal rises every month at the effective
 *     monthly inflation (1+i)^(1/12)−1 — the convention of the reference SWP
 *     calculators; this calculator's own case has inflation off.
 * Reference case (SIP ₹25,000/mo × 20y @12% → ₹2,29,96,434; SWP ₹2,00,000/mo
 * @9%) lasts 245 months = 20 years 5 months, ₹1,37,225 left. Every year-end
 * value of both tables matches to the rupee (tests/ms-calc-c.test.ts).
 */

import { monthlyRate, fvSip, fvLumpsum } from "./sip360";

export type InvestmentType = "lumpsum" | "sip";
export type SwpMode = "amount" | "percentage";

export type SwpEndInput = {
  investmentType: InvestmentType;
  initialInvestment: number; // lumpsum amount OR monthly SIP amount
  defermentRequired: boolean;
  defermentYears: number; // SIP duration, or lumpsum grow-before-SWP period
  accumulationRatePct: number; // return during SIP / deferment
  swpRatePct: number; // return during SWP
  includeInflation: boolean;
  inflationPct: number;
  swpMode: SwpMode;
  swpAmount: number; // mode = amount
  swpPercentage: number; // mode = percentage (annual % of starting corpus)
};

export type SwpYearRow = {
  /** SWP year, counted from the first withdrawal (1, 2, …). */
  year: number;
  /** Year counted from the start of the plan (accumulation years + SWP year). */
  planYear: number;
  /** Withdrawal in the year's first month. */
  monthlyWithdrawal: number;
  withdrawnThisYear: number;
  endBalance: number;
};

export type AccYearRow = { year: number; annualInvestment: number; yearEndValue: number };

export type SwpEndResult = {
  /** Corpus when the SWP starts, rounded to the rupee. */
  accumulatedValue: number;
  /** Years before the first withdrawal (SIP period, or a lumpsum's deferment). */
  accumulationYears: number;
  accRows: AccYearRow[];
  baseMonthlyWithdrawal: number;
  /** Full withdrawals the corpus paid; null = beyond the cap (perpetual). */
  monthsLasted: number | null;
  perpetual: boolean;
  totalWithdrawn: number;
  /** Balance left after the last full withdrawal (not paid out). */
  leftover: number;
  /** One row per COMPLETE SWP year. */
  yearRows: SwpYearRow[];
  capYears: number;
};

const CAP_YEARS = 100;

export function computeSwpEndPeriod(input: SwpEndInput): SwpEndResult {
  // ── Phase 1: accumulate the corpus ──
  const accYears = Math.max(0, Math.round(input.defermentYears));
  const defMonths = accYears * 12;
  const isSip = input.investmentType === "sip";
  const grows = isSip || input.defermentRequired;
  const accRows: AccYearRow[] = [];
  let rawCorpus: number;
  if (isSip) {
    rawCorpus = fvSip(input.initialInvestment, input.accumulationRatePct, defMonths);
    for (let y = 1; y <= accYears; y++) {
      accRows.push({
        year: y,
        annualInvestment: input.initialInvestment * 12,
        yearEndValue: fvSip(input.initialInvestment, input.accumulationRatePct, y * 12),
      });
    }
  } else if (grows) {
    rawCorpus = fvLumpsum(input.initialInvestment, input.accumulationRatePct, defMonths);
    for (let y = 1; y <= accYears; y++) {
      accRows.push({
        year: y,
        annualInvestment: y === 1 ? input.initialInvestment : 0,
        yearEndValue: fvLumpsum(input.initialInvestment, input.accumulationRatePct, y * 12),
      });
    }
  } else {
    rawCorpus = input.initialInvestment;
  }
  const accumulatedValue = Math.round(Math.max(0, rawCorpus));
  const accumulationYears = grows ? accYears : 0;

  // ── Base monthly withdrawal ──
  const baseMonthly =
    input.swpMode === "percentage"
      ? (accumulatedValue * (input.swpPercentage / 100)) / 12
      : input.swpAmount;

  const empty = (lastsForever: boolean): SwpEndResult => ({
    accumulatedValue,
    accumulationYears,
    accRows,
    baseMonthlyWithdrawal: baseMonthly,
    monthsLasted: lastsForever ? null : 0,
    perpetual: lastsForever,
    totalWithdrawn: 0,
    leftover: accumulatedValue,
    yearRows: [],
    capYears: CAP_YEARS,
  });
  // No withdrawal from a funded corpus never runs out; an empty corpus lasts 0.
  if (baseMonthly <= 0 || accumulatedValue <= 0) return empty(baseMonthly <= 0 && accumulatedValue > 0);

  // ── Phase 2: end-of-month drawdown, full withdrawals only ──
  const m = monthlyRate(input.swpRatePct);
  const g = input.includeInflation ? monthlyRate(input.inflationPct) : 0;
  const capMonths = CAP_YEARS * 12;
  let bal = accumulatedValue;
  let withdrawn = 0;
  let months = 0;
  let withdrawnThisYear = 0;
  let yearFirst = baseMonthly;
  const yearRows: SwpYearRow[] = [];

  while (months < capMonths) {
    const w = baseMonthly * Math.pow(1 + g, months);
    const grown = bal * (1 + m);
    if (grown < w) break;
    if (months % 12 === 0) yearFirst = w;
    bal = grown - w;
    withdrawn += w;
    withdrawnThisYear += w;
    months++;
    if (months % 12 === 0) {
      yearRows.push({
        year: months / 12,
        planYear: accumulationYears + months / 12,
        monthlyWithdrawal: yearFirst,
        withdrawnThisYear,
        endBalance: bal,
      });
      withdrawnThisYear = 0;
    }
  }

  const perpetual = months >= capMonths;
  return {
    accumulatedValue,
    accumulationYears,
    accRows,
    baseMonthlyWithdrawal: baseMonthly,
    monthsLasted: perpetual ? null : months,
    perpetual,
    totalWithdrawn: withdrawn,
    leftover: bal,
    yearRows,
    capYears: CAP_YEARS,
  };
}
