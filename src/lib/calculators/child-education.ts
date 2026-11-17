/**
 * Child Education Cost Projector — math engine.
 *
 * Education costs inflate far faster than CPI (≈10%/yr), so a generic goal
 * calculator understates them. This projects each education milestone (school /
 * UG / PG / abroad) at education inflation, then computes the monthly SIP and
 * lumpsum needed, offsetting any savings already earmarked.
 *
 * Convention: future cost compounds at education inflation; required SIP uses an
 * effective-monthly annuity-due factor.
 *
 * Funding options per goal and per return scenario (verified to the reference
 * case: child 4, ₹1,00,00,000 today needed at 21, ₹5,00,000 saved @ 12%,
 * inflation 6%, scenarios 12% / 15% → inflated cost ₹2,69,27,728, savings grow
 * to ₹34,33,020, balance ₹2,34,94,707; SIP till 21 ₹37,647 / ₹27,871, SIP for
 * 5 yrs then hold ₹74,356 / ₹50,277, for 10 yrs ₹47,438 / ₹33,581, lumpsum
 * ₹34,21,871 / ₹21,83,267):
 *   • Savings already earmarked grow ANNUALLY at their own return
 *     (`currentInvestmentReturnPct`, default = scenario 1).
 *   • The balance is the UNROUNDED difference (inflated cost − grown savings).
 *   • SIP till the goal: begin-mode, effective monthly (sip360 requiredSip).
 *   • SIP for k years then hold: balance / limitedPeriodFv(1, k, n, r); offered
 *     only when k < years to the goal.
 *   • Lumpsum today: balance / (1 + r)^n.
 */

import { requiredMonthlySip } from "./goal-collision";
import { limitedPeriodFv } from "./sip360";

export type EduMilestone = {
  name: string;
  childAgeAtStart: number; // age when this course begins
  currentCost: number; // today's cost of the course
};

export type ChildEducationInput = {
  childCurrentAge: number;
  eduInflationPct: number;
  expectedReturnPct: number; // scenario 1 return on fresh investment
  existingSavings: number; // already earmarked for education
  milestones: EduMilestone[];
  /** Return on the savings already earmarked (default: expectedReturnPct). */
  currentInvestmentReturnPct?: number;
  /** Optional second return scenario for fresh investment. */
  scenario2Pct?: number | null;
};

export type EduFundingOption = {
  ratePct: number;
  sipTillGoal: number;
  /** null when the goal is not more than 5 / 10 years away. */
  sip5y: number | null;
  sip10y: number | null;
  lumpsum: number;
};

export type EduMilestoneResult = {
  name: string;
  yearsAway: number;
  futureCost: number;
  savingsApplied: number; // grown value of earmarked savings set against this goal
  balance: number; // futureCost − savingsApplied (≥ 0)
  monthlySip: number;
  lumpsum: number;
  /** One per return scenario (scenario 1 first). */
  options: EduFundingOption[];
};

export type ChildEducationResult = {
  milestones: EduMilestoneResult[];
  totalFutureCost: number;
  totalMonthlySip: number;
  totalLumpsum: number;
  existingSavingsFutureValue: number; // grown to the nearest milestone
  netAfterSavings: number;
};

export function computeChildEducation(input: ChildEducationInput): ChildEducationResult {
  const r = input.expectedReturnPct / 100;
  const g = input.eduInflationPct / 100;
  const rCi = (input.currentInvestmentReturnPct ?? input.expectedReturnPct) / 100;
  const rates = [input.expectedReturnPct];
  if (input.scenario2Pct != null && input.scenario2Pct > 0) rates.push(input.scenario2Pct);

  const sorted = [...input.milestones].sort((a, b) => a.childAgeAtStart - b.childAgeAtStart);
  const nearestYears = sorted.length ? Math.max(0, sorted[0].childAgeAtStart - input.childCurrentAge) : 0;
  const existingSavingsFutureValue = input.existingSavings * Math.pow(1 + rCi, nearestYears);

  // Earmarked savings are applied nearest-milestone first. Track the UNUSED
  // portion in TODAY's rupees and grow it to EACH milestone's own date, so a
  // later milestone's offset earns the extra years of compounding (the previous
  // code grew everything only to the nearest milestone, understating later offsets).
  let remainingSavingsToday = input.existingSavings;
  const milestones: EduMilestoneResult[] = sorted.map((mlt) => {
    const yearsAway = Math.max(0, mlt.childAgeAtStart - input.childCurrentAge);
    const grow = Math.pow(1 + r, yearsAway);
    const growCi = Math.pow(1 + rCi, yearsAway);
    const grossFuture = mlt.currentCost * Math.pow(1 + g, yearsAway);
    const availableAtMilestone = remainingSavingsToday * growCi;
    const offset = Math.min(availableAtMilestone, grossFuture);
    remainingSavingsToday -= offset / growCi; // consume in present-value terms
    const netFuture = Math.max(0, grossFuture - offset);
    const options: EduFundingOption[] = rates.map((ratePct) => {
      const limited = (k: number): number | null => {
        if (yearsAway <= k) return null;
        const f = limitedPeriodFv(1, k, yearsAway, ratePct);
        return f > 0 ? netFuture / f : null;
      };
      return {
        ratePct,
        sipTillGoal: requiredMonthlySip(netFuture, ratePct, yearsAway),
        sip5y: limited(5),
        sip10y: limited(10),
        lumpsum: yearsAway > 0 ? netFuture / Math.pow(1 + ratePct / 100, yearsAway) : netFuture,
      };
    });
    return {
      name: mlt.name,
      yearsAway,
      futureCost: grossFuture,
      savingsApplied: offset,
      balance: netFuture,
      monthlySip: requiredMonthlySip(netFuture, input.expectedReturnPct, yearsAway),
      lumpsum: yearsAway > 0 ? netFuture / grow : netFuture,
      options,
    };
  });

  const totalFutureCost = milestones.reduce((s, m) => s + m.futureCost, 0);
  const totalMonthlySip = milestones.reduce((s, m) => s + m.monthlySip, 0);
  const totalLumpsum = milestones.reduce((s, m) => s + m.lumpsum, 0);

  return {
    milestones,
    totalFutureCost,
    totalMonthlySip,
    totalLumpsum,
    existingSavingsFutureValue,
    netAfterSavings: Math.max(0, totalFutureCost - existingSavingsFutureValue),
  };
}
