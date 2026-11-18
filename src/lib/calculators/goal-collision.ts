/**
 * Goal-Collision Timeline — math engine.
 *
 * Plots every family goal on one timeline and sums the monthly SIP each goal
 * demands, year by year. Every SIP starts now and stops when its goal is due,
 * so the commitment is highest now (year 1) and eases as goals are reached.
 *
 * Required monthly SIP per goal uses an effective-monthly annuity-due factor;
 * the one-time lumpsum today beside it discounts the same cost at the same
 * effective monthly rate over the same months.
 */

import { monthlyRate } from "./sip360";

export type CollisionGoal = {
  name: string;
  yearsAway: number; // when the goal is due
  futureCost: number;
  returnPct: number;
};

/** A goal less than half a month away has no SIP horizon — it needs a lumpsum. */
export const isDueNow = (years: number): boolean => Math.round(years * 12) <= 0;

/** Monthly SIP to reach `futureCost` in `years` at `ratePct` (begin mode).
 *  0 for a goal due now (see isDueNow) — never the whole cost as a "monthly" SIP. */
export function requiredMonthlySip(futureCost: number, ratePct: number, years: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (months <= 0) return 0;
  const m = monthlyRate(ratePct);
  const factor = m === 0 ? months : ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
  return factor > 0 ? futureCost / factor : 0;
}

/** One-time lumpsum invested today that grows to `futureCost` in `years` at
 *  `ratePct` — the same effective monthly rate and the same whole months as
 *  requiredMonthlySip. A goal due now needs its whole cost. */
export function lumpsumNeededToday(futureCost: number, ratePct: number, years: number): number {
  if (!(futureCost > 0)) return 0;
  const months = Math.max(0, Math.round(years * 12));
  return futureCost / Math.pow(1 + monthlyRate(ratePct), months);
}

export type CollisionGoalResult = CollisionGoal & { monthlySip: number; lumpsumToday: number };

export type CollisionYear = {
  year: number;
  totalMonthly: number;
  activeGoals: string[];
};

export type GoalCollisionResult = {
  goals: CollisionGoalResult[];
  timeline: CollisionYear[];
  peakMonthly: number;
  peakYear: number;
  horizon: number;
  /** Σ of every goal's one-time lumpsum today. */
  totalLumpsumToday: number;
};

export function computeGoalCollision(goals: CollisionGoal[]): GoalCollisionResult {
  const withSip: CollisionGoalResult[] = goals.map((g) => ({
    ...g,
    monthlySip: requiredMonthlySip(g.futureCost, g.returnPct, g.yearsAway),
    lumpsumToday: lumpsumNeededToday(g.futureCost, g.returnPct, g.yearsAway),
  }));

  const horizon = Math.max(1, ...withSip.map((g) => Math.ceil(g.yearsAway)));
  const timeline: CollisionYear[] = [];
  let peakMonthly = 0;
  let peakYear = 1;

  for (let year = 1; year <= horizon; year++) {
    let totalMonthly = 0;
    const activeGoals: string[] = [];
    for (const g of withSip) {
      // A goal's SIP runs from now until the year it is due.
      if (!isDueNow(g.yearsAway) && year <= Math.ceil(g.yearsAway)) {
        totalMonthly += g.monthlySip;
        activeGoals.push(g.name);
      }
    }
    if (totalMonthly > peakMonthly) {
      peakMonthly = totalMonthly;
      peakYear = year;
    }
    timeline.push({ year, totalMonthly, activeGoals });
  }

  const totalLumpsumToday = withSip.reduce((s, g) => s + g.lumpsumToday, 0);
  return { goals: withSip, timeline, peakMonthly, peakYear, horizon, totalLumpsumToday };
}
