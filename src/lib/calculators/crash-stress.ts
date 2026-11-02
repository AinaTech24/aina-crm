/**
 * Market-Crash Stress Test — math engine.
 *
 * Simulates an SIP (+ optional lumpsum) through a market crash of −X% at a
 * chosen year, and contrasts three behaviours:
 *   • Stay invested   — keep SI-ing through the crash and recovery
 *   • No crash        — the smooth baseline (for reference)
 *   • Panic sell      — redeem at the crash bottom, park in cash/FD, keep saving there
 *
 * Reports the final corpus for each path, the recovery time, and the "cost of
 * panic". Convention: effective monthly rate, SIP at month start (begin mode);
 * the crash is a one-time shock applied at the end of the crash year's month.
 */

import { monthlyRate } from "./sip360";

export type CrashStressInput = {
  monthlySip: number;
  lumpsum: number;
  years: number;
  expectedReturnPct: number;
  crashYear: number; // the year the crash hits
  crashPct: number; // drop, e.g. 40
  fdRatePct: number; // where a panicker parks the money
};

export type CrashPoint = { month: number; stay: number; noCrash: number; panic: number };

export type CrashStressResult = {
  totalInvested: number;
  finalStay: number;
  finalNoCrash: number;
  finalPanic: number;
  costOfPanic: number;
  crashDropAmount: number;
  crashInHorizon: boolean; // false when the crash year falls after the horizon
  /** Months for the MARKET (unit NAV) to regain its pre-crash level — new SIP money excluded. */
  recoveryMonths: number | null;
  gapToNoCrash: number; // no-crash − stayed-invested at the horizon (≥ 0 = never caught up)
  series: CrashPoint[]; // yearly snapshots
};

export function computeCrashStress(input: CrashStressInput): CrashStressResult {
  const m = monthlyRate(input.expectedReturnPct);
  const mFd = monthlyRate(input.fdRatePct);
  const n = Math.max(0, Math.round(input.years * 12));
  const crashMonth = Math.max(1, Math.round(input.crashYear * 12));
  const drop = Math.min(100, Math.max(0, input.crashPct)) / 100; // a fall can't exceed 100%

  let stay = input.lumpsum;
  let noCrash = input.lumpsum;
  let panic = input.lumpsum;
  let panicked = false;
  let invested = input.lumpsum;
  let nav = 1; // unit NAV — recovery is the market's, not the corpus topped up by new SIPs
  let preCrashNav = 0;
  let recoveryMonths: number | null = null;
  let crashDropAmount = 0;

  const series: CrashPoint[] = [{ month: 0, stay, noCrash, panic }];

  for (let i = 1; i <= n; i++) {
    // SIP at month start, then grow.
    stay += input.monthlySip;
    noCrash += input.monthlySip;
    panic += input.monthlySip;
    invested += input.monthlySip;

    stay *= 1 + m;
    noCrash *= 1 + m;
    panic *= panicked ? 1 + mFd : 1 + m;
    nav *= 1 + m;

    if (i === crashMonth) {
      preCrashNav = nav;
      nav *= 1 - drop;
      crashDropAmount = stay * drop;
      stay *= 1 - drop;
      // Panic seller redeems at the bottom and moves to cash/FD.
      panic *= 1 - drop;
      panicked = true;
    }

    if (panicked && recoveryMonths === null && i > crashMonth && nav >= preCrashNav - 1e-9) {
      recoveryMonths = i - crashMonth;
    }

    if (i % 12 === 0 || i === n) series.push({ month: i, stay, noCrash, panic });
  }

  return {
    totalInvested: invested,
    finalStay: stay,
    finalNoCrash: noCrash,
    finalPanic: panic,
    costOfPanic: Math.max(0, stay - panic),
    crashDropAmount,
    crashInHorizon: crashMonth <= n,
    recoveryMonths,
    gapToNoCrash: noCrash - stay,
    series,
  };
}
