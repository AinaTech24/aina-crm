/**
 * Goal-Feasibility Score — math engine.
 *
 * Scores how on-track a household is (0–100) by comparing the monthly SIP its
 * goals require against what it can actually invest, after crediting the future
 * value of its existing corpus toward the goals. Also factors the savings rate.
 */

import { isDueNow, requiredMonthlySip } from "./goal-collision";

export type FeasGoal = { name: string; futureCost: number; yearsAway: number; returnPct: number };

export type FeasInput = {
  monthlyIncome: number;
  currentMonthlySip: number; // what they invest now
  existingCorpus: number;
  corpusReturnPct: number; // growth assumption for the existing corpus
  goals: FeasGoal[];
};

export type FeasGoalResult = FeasGoal & { requiredMonthly: number };

export type FeasResult = {
  goals: FeasGoalResult[];
  requiredMonthlyTotal: number;
  corpusCoversMonthlyEquivalent: number; // existing corpus expressed as monthly SIP it offsets
  netRequiredMonthly: number;
  availableMonthly: number;
  coverageRatio: number; // available / netRequired
  savingsRatePct: number;
  score: number; // 0-100
  gapMonthly: number;
  dueNowUncovered: number; // goals due now that the corpus cannot pay (no SIP can)
};

export function computeGoalFeasibility(input: FeasInput): FeasResult {
  const goals: FeasGoalResult[] = input.goals.map((g) => ({
    ...g,
    requiredMonthly: requiredMonthlySip(g.futureCost, g.returnPct, g.yearsAway),
  }));
  const requiredMonthlyTotal = goals.reduce((s, g) => s + g.requiredMonthly, 0);

  // Credit the existing corpus goal by goal, nearest first (as child-education.ts
  // does): the unused corpus, tracked in today's rupees, grows at the corpus
  // return to each goal's own date and pays as much of that goal as it can.
  // (Crediting it as one SIP-equivalent at the longest horizon understated it
  // badly for near goals.)
  let remainingToday = Math.max(0, input.existingCorpus);
  let netRequiredMonthly = 0;
  let dueNowUncovered = 0;
  for (const g of [...input.goals].sort((a, b) => a.yearsAway - b.yearsAway)) {
    const grow = Math.pow(1 + input.corpusReturnPct / 100, Math.max(0, g.yearsAway));
    const offset = Math.min(remainingToday * grow, g.futureCost);
    remainingToday -= offset / grow;
    const net = g.futureCost - offset;
    if (isDueNow(g.yearsAway)) dueNowUncovered += net;
    else netRequiredMonthly += requiredMonthlySip(net, g.returnPct, g.yearsAway);
  }
  const corpusCoversMonthlyEquivalent = Math.max(0, requiredMonthlyTotal - netRequiredMonthly);

  const availableMonthly = input.currentMonthlySip;
  // A goal due now that the corpus cannot pay is unfunded whatever the SIP:
  // coverage is capped at the share of total goal cost that is fundable.
  const totalCost = input.goals.reduce((s, g) => s + g.futureCost, 0);
  const fundableShare = totalCost > 0 ? 1 - dueNowUncovered / totalCost : 1;
  const coverageRatio = Math.min(netRequiredMonthly > 0 ? availableMonthly / netRequiredMonthly : 1, fundableShare);

  const savingsRatePct = input.monthlyIncome > 0 ? (input.currentMonthlySip / input.monthlyIncome) * 100 : 0;

  // Score: 85% from coverage, 15% from a healthy (≥20%) savings rate.
  const coverageScore = Math.min(1, coverageRatio) * 85;
  const savingsScore = Math.min(1, savingsRatePct / 20) * 15;
  const score = Math.round(coverageScore + savingsScore);

  return {
    goals,
    requiredMonthlyTotal,
    corpusCoversMonthlyEquivalent,
    netRequiredMonthly,
    availableMonthly,
    coverageRatio,
    savingsRatePct,
    score: Math.max(0, Math.min(100, score)),
    gapMonthly: Math.max(0, netRequiredMonthly - availableMonthly),
    dueNowUncovered,
  };
}
