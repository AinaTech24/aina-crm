/**
 * "One-time lumpsum today" beside every "SIP needed for a goal" figure.
 *
 * For each new lumpsum figure: growing it at the SAME return, over the SAME
 * time to the goal and in the SAME rate convention as the calculator's SIP
 * (effective monthly for lib/calculators, nominal r/12 for the advisory pack
 * and goal-planning) lands exactly on the target the SIP solves for, net of
 * any savings the SIP nets off — and one hand-computed value per function.
 */

import { describe, expect, it } from "vitest";
import { fvLumpsum as fvEff } from "@/lib/calculators/sip360";
import { fvLumpsum as fvNom, vacationPlan } from "@/lib/goal-planning/calc";
import { limitedSipNeed, lumpsumNeededToday, sipForTarget, stepUpSipForTarget } from "@/lib/calculators/sip-suite";
import { computeGoalCollision, lumpsumNeededToday as collisionLumpsum } from "@/lib/calculators/goal-collision";
import { computeGoalFeasibility } from "@/lib/calculators/goal-feasibility";
import { youthBucketStrategy } from "@/lib/calculators/bucket-strategy";
import { computeEmiSip, lumpsumNeededToday as emiLumpsum } from "@/lib/calculators/emi-sip";
import { termPlusSipGoal } from "@/lib/calculators/term-plus-sip";
import { computeSalaryWealth } from "@/lib/calculators/salary-wealth";
import { sipForSwp } from "@/lib/calculators/swp-target";
import { computeIncomeBridge, type IncomeBridgeInput } from "@/lib/calculators/income-bridge";
import { computeReadyReckoner } from "@/lib/calculators/ready-reckoner";
import { dreamCar, emergencyFund, inflatedGoalSip, lumpsumNetOfSavings, passiveIncome } from "@/lib/calculators/advisory";

/** Relative closeness for large rupee figures (1e-9 of the target). */
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(Math.max(1e-6, Math.abs(b) * 1e-9));

describe("sip-suite (effective rate)", () => {
  it("lumpsumNeededToday — hand value and round trip", () => {
    // ₹10,00,000 in 2 years at 10%: 10,00,000 ÷ 1.21
    expect(lumpsumNeededToday(1_000_000, 10, 2)).toBeCloseTo(826_446.28, 2);
    near(fvEff(lumpsumNeededToday(5_000_000, 12, 15), 12, 180), 5_000_000);
    expect(lumpsumNeededToday(0, 12, 10)).toBe(0);
  });

  it("SIP for a target (#39): a lumpsum per scenario, same target and years", () => {
    const res = sipForTarget({ target: 5_000_000, years: 15, ratesPct: [12, 15], stepUpPct: 10, costOfDelay: true });
    for (const sc of res) near(fvEff(sc.lumpsumToday, sc.ratePct, 15 * 12), 5_000_000);
    // existing figures untouched
    expect(Math.round(res[0].sip)).toBe(10506);
    expect(Math.round(res[1].sip)).toBe(8112);
    expect(res[0].lumpsumToday).toBeCloseTo(5_000_000 / Math.pow(1.12, 15), 6);
  });

  it("Step-up SIP for a target (#43)", () => {
    const res = stepUpSipForTarget({ target: 5_000_000, years: 15, stepUpPct: 5, ratesPct: [10, 13] });
    for (const sc of res) near(fvEff(sc.lumpsumToday, sc.ratePct, 15 * 12), 5_000_000);
  });

  it("Limited-period SIP (#20): the lumpsum stays invested for SIP + deferment years", () => {
    const res = limitedSipNeed({ target: 2_500_000, sipYears: 5, deferYears: 10, ratesPct: [12, 15] });
    for (const sc of res) near(fvEff(sc.lumpsumToday, sc.ratePct, 15 * 12), 2_500_000);
    // hand: ₹12,10,000 over 1 + 1 years at 10% → ₹10,00,000
    expect(limitedSipNeed({ target: 1_210_000, sipYears: 1, deferYears: 1, ratesPct: [10] })[0].lumpsumToday).toBeCloseTo(1_000_000, 6);
  });
});

describe("goal collision & feasibility (effective rate)", () => {
  it("per goal and total", () => {
    // hand: ₹1,21,000 in 2 years at 10% effective → ₹1,00,000
    expect(collisionLumpsum(121_000, 10, 2)).toBeCloseTo(100_000, 6);
    const goals = [
      { name: "Car", yearsAway: 3, futureCost: 1_500_000, returnPct: 9 },
      { name: "Edu", yearsAway: 12, futureCost: 8_000_000, returnPct: 12 },
      { name: "Now", yearsAway: 0, futureCost: 300_000, returnPct: 8 },
    ];
    const res = computeGoalCollision(goals);
    for (const g of res.goals) near(fvEff(g.lumpsumToday, g.returnPct, Math.round(g.yearsAway * 12)), g.futureCost);
    expect(res.goals[2].lumpsumToday).toBe(300_000); // due now: the cost itself
    near(res.totalLumpsumToday, res.goals.reduce((s, g) => s + g.lumpsumToday, 0));
  });

  it("feasibility nets off the existing corpus goal by goal", () => {
    const base = { monthlyIncome: 200_000, currentMonthlySip: 10_000, corpusReturnPct: 10 };
    const one = [{ name: "G", futureCost: 1_210_000, yearsAway: 2, returnPct: 10 }];
    expect(computeGoalFeasibility({ ...base, existingCorpus: 0, goals: one }).netLumpsumToday).toBeCloseTo(1_000_000, 6);
    // ₹5,00,000 corpus grows to ₹6,05,000 → ₹6,05,000 left → ₹5,00,000 today
    const withCorpus = computeGoalFeasibility({ ...base, existingCorpus: 500_000, goals: one });
    expect(withCorpus.netLumpsumToday).toBeCloseTo(500_000, 6);
    near(fvEff(withCorpus.netLumpsumToday + 500_000, 10, 24), 1_210_000);
    // corpus covers it all → 0
    expect(computeGoalFeasibility({ ...base, existingCorpus: 5_000_000, goals: one }).netLumpsumToday).toBe(0);
    expect(computeGoalFeasibility({ ...base, existingCorpus: 0, goals: one }).goals[0].lumpsumToday).toBeCloseTo(1_000_000, 6);
  });
});

describe("youth 4-bucket strategy", () => {
  it("each lumpsum grows to its corpus at the large-cap rate by the freedom age", () => {
    const res = youthBucketStrategy({
      monthlyExpenseToday: 80_000, inflationPct: 6, ageNow: 25, freedomAge: 41, longevity: 90,
      debtReturnPct: 8, hybridReturnPct: 10, largeCapReturnPct: 12, midCapReturnPct: 15,
    });
    near(fvEff(res.lumpsumBucket, 12, 16 * 12), res.corpusBucket);
    near(fvEff(res.lumpsumWithout, 12, 16 * 12), res.corpusWithout);
    expect(res.lumpsumBucket).toBeCloseTo(res.corpusBucket / Math.pow(1.12, 16), 4);
  });
});

describe("EMI recovery", () => {
  it("the lumpsum grows to the total repayment over the tenure", () => {
    const res = computeEmiSip({ mode: "loan", loanAmount: 2_500_000, interestRatePct: 9, emiAmount: 0, tenureMonths: 180, sipReturnPct: 12 });
    near(fvEff(res.lumpsumRequired, 12, 180), res.totalRepayment);
    expect(Math.round(res.monthlySipRequired)).toBe(9590); // unchanged
    // hand: EMI ₹1,000 × 24 months at 10% → ₹24,000 ÷ 1.21
    expect(computeEmiSip({ mode: "emi", loanAmount: 0, interestRatePct: 0, emiAmount: 1000, tenureMonths: 24, sipReturnPct: 10 }).lumpsumRequired)
      .toBeCloseTo(19_834.71, 2);
    expect(emiLumpsum(121, 10, 24)).toBeCloseTo(100, 9);
  });
});

describe("term + SIP, goal view", () => {
  it("lumpsum reaches the cover amount by the end of the term", () => {
    const res = termPlusSipGoal({ age: 30, goal: 10_000_000, termYears: 30, premium: 10_000, returnPct: 12 });
    near(fvEff(res.lumpsumToday, 12, 360), 10_000_000);
    expect(res.sipMonthly).toBeCloseTo(3245.7277, 3); // unchanged
    expect(termPlusSipGoal({ age: 30, goal: 121_000, termYears: 2, premium: 0, returnPct: 10 }).lumpsumToday).toBeCloseTo(100_000, 6);
  });
});

describe("salary-linked wealth, saving mode", () => {
  it("lumpsum + grown existing fund = target", () => {
    const base = {
      currentAge: 32, retirementAge: 60, currentMonthlySalary: 120000, sipPctOfSalary: 10,
      annualIncrementPct: 8, investTillAge: 60, assumedReturnPct: 12, includeExisting: true,
      existingInvestment: 600000, existingReturnPct: 12, targetWealth: 100_000_000,
    };
    const r = computeSalaryWealth({ ...base, mode: "saving" });
    expect(Math.round(r.requiredMonthlySip!)).toBe(17594); // unchanged
    near(fvEff(r.requiredLumpsumToday!, 12, 28 * 12) + r.existingFutureValue, 100_000_000);
    const hand = computeSalaryWealth({ ...base, currentAge: 30, retirementAge: 32, investTillAge: 32, includeExisting: false, assumedReturnPct: 10, targetWealth: 1_210_000, mode: "saving" });
    expect(hand.requiredLumpsumToday!).toBeCloseTo(1_000_000, 6);
    expect(computeSalaryWealth({ ...base, mode: "wealth" }).requiredLumpsumToday).toBeUndefined();
  });
});

describe("SIP for a target SWP", () => {
  it("lumpsum grows to the SWP corpus over the SIP + waiting years", () => {
    const res = sipForSwp({ firstMonthlySwp: 100_000, sipYears: 20, deferYears: 0, swpYears: 30, accPct: 12, distPct: 7, inflationPct: 0, endBalance: 5_000_000, currentAge: null });
    expect(Math.round(res.corpus)).toBe(16_019_597); // unchanged
    near(fvEff(res.lumpsumToday, 12, 240), res.corpus);
    const deferred = sipForSwp({ firstMonthlySwp: 100_000, sipYears: 15, deferYears: 5, swpYears: 30, accPct: 12, distPct: 7, inflationPct: 5, endBalance: 0, currentAge: 40 });
    near(fvEff(deferred.lumpsumToday, 12, 240), deferred.corpus);
    // hand: no withdrawals, leave ₹12,10,000, 1 + 1 years at 10% → ₹10,00,000
    expect(sipForSwp({ firstMonthlySwp: 0, sipYears: 1, deferYears: 1, swpYears: 0, accPct: 10, distPct: 7, inflationPct: 0, endBalance: 1_210_000, currentAge: null }).lumpsumToday)
      .toBeCloseTo(1_000_000, 6);
  });
});

describe("income bridge, 'how much to invest?'", () => {
  const base: IncomeBridgeInput = {
    calcType: "investment_need", investMode: "sip", planningType: "retirement",
    startAge: 35, sipTillAge: 50, retirementAge: 60, swpTillAge: 85,
    monthlySip: 0, topUpPct: 5, lumpsum: 0, monthlySalary: 100000, savingsPct: 0, salaryGrowthPct: 8,
    accumReturnPct: 12, distReturnPct: 8, distInflationPct: 5, endBalance: 10_000_000, desiredMonthlySwp: 150_000,
  };
  it("SIP and salary modes: lumpsum grows to the required corpus", () => {
    for (const investMode of ["sip", "salary"] as const) {
      const res = computeIncomeBridge({ ...base, investMode });
      near(fvEff(res.lumpsumInsteadOfSip!, 12, 25 * 12), res.requiredCorpus!);
    }
  });
  it("lumpsum + SIP mode: the extra lumpsum replaces the SIP on top of the given lumpsum", () => {
    const res = computeIncomeBridge({ ...base, investMode: "lumpsum_sip", lumpsum: 1_000_000 });
    near(fvEff(res.lumpsumInsteadOfSip! + 1_000_000, 12, 25 * 12), res.requiredCorpus!);
  });
  it("hand value, and absent where no SIP is solved", () => {
    const hand = { ...base, startAge: 30, sipTillAge: 32, retirementAge: 32, swpTillAge: 32, accumReturnPct: 10, endBalance: 1_210_000 };
    expect(computeIncomeBridge(hand).lumpsumInsteadOfSip!).toBeCloseTo(1_000_000, 6);
    expect(computeIncomeBridge({ ...hand, investMode: "lumpsum_sip", lumpsum: 400_000 }).lumpsumInsteadOfSip!).toBeCloseTo(600_000, 6);
    expect(computeIncomeBridge({ ...hand, investMode: "lumpsum" }).lumpsumInsteadOfSip).toBeUndefined();
    expect(computeIncomeBridge({ ...hand, calcType: "monthly_swp" }).lumpsumInsteadOfSip).toBeUndefined();
  });
});

describe("SIP Needed ready reckoner", () => {
  it("lumpsum grid = the Lumpsum Needed reckoner's grid, cell for cell", () => {
    const input = { amount: 10_000_000, ratesPct: [10, 12, 15], years: [10, 15, 20, 25, 30] };
    const sip = computeReadyReckoner({ mode: "sip_need", ...input });
    const lump = computeReadyReckoner({ mode: "lumpsum_need", ...input });
    expect(sip.lumpsumCells).toEqual(lump.cells);
    sip.rates.forEach((r, ri) => sip.years.forEach((y, yi) => near(fvEff(sip.lumpsumCells![ri][yi], r, y * 12), 10_000_000)));
    expect(computeReadyReckoner({ mode: "sip_need", amount: 10_000_000, ratesPct: [10], years: [2] }).lumpsumCells![0][0]).toBeCloseTo(8_264_462.81, 2);
    expect(lump.lumpsumCells).toBeNull();
  });
});

describe("advisory pack (nominal r/12, as its SIPs)", () => {
  it("lumpsumNetOfSavings — hand value, savings netted, floor 0", () => {
    // ₹10,00,000 in 24 months at 12% nominal: ÷ 1.01^24 = 1.26973465 → 7,87,566.13
    expect(lumpsumNetOfSavings(1_000_000, 0, 12, 24)).toBeCloseTo(787_566.13, 1);
    near(fvNom(lumpsumNetOfSavings(1_000_000, 200_000, 12, 24) + 200_000, 12, 24), 1_000_000);
    expect(lumpsumNetOfSavings(1_000_000, 900_000, 12, 24)).toBe(0);
  });
  it("wedding (inflatedGoalSip)", () => {
    const r = inflatedGoalSip({ costToday: 3_000_000, years: 15, inflationPct: 7, existingSavings: 250_000, returnPct: 12 });
    near(fvNom(r.lumpsumToday + 250_000, 12, 180), r.futureCost);
  });
  it("passive income", () => {
    const r = passiveIncome({ targetMonthlyToday: 100_000, inflationPct: 6, postReturnPct: 9, yearsToFreedom: 20, existingCorpus: 1_000_000, buildReturnPct: 12, payoutYears: 30 });
    near(fvNom(r.lumpsumToday + 1_000_000, 12, 240), r.corpusNeeded);
  });
  it("dream car", () => {
    const r = dreamCar({ carPriceToday: 1_500_000, yearsToBuy: 4, carInflationPct: 6, investReturnPct: 11, downPaymentPct: 20, loanRatePct: 9.5, loanYears: 5 });
    near(fvNom(r.lumpsumToBuyCash, 11, 48), r.futurePrice);
  });
  it("emergency fund", () => {
    const r = emergencyFund({ monthlyExpense: 60_000, monthsBuffer: 6, existing: 50_000, buildMonths: 12, parkReturnPct: 6 });
    near(fvNom(r.lumpsumToday + 50_000, 6, 12), r.target);
    // no build period: the gap itself
    expect(emergencyFund({ monthlyExpense: 60_000, monthsBuffer: 6, existing: 50_000, buildMonths: 0, parkReturnPct: 6 }).lumpsumToday).toBe(310_000);
  });
});

describe("advanced vacation planner (goal-planning)", () => {
  it("initial + lumpsum, grown a year, = the corpus needed", () => {
    const res = vacationPlan({ initialInvestment: 2_000_000, equityReturnPct: 12, sipGrowthPct: 15, sipYears: 12, currentVacationCost: 400_000, vacationInflationPct: 4, numVacations: 50 });
    expect(res.amountStillNeeded).toBeGreaterThan(0);
    near((2_000_000 + res.lumpsumToday) * 1.12, res.corpusNeeded);
    const funded = vacationPlan({ initialInvestment: 1e9, equityReturnPct: 12, sipGrowthPct: 15, sipYears: 12, currentVacationCost: 400_000, vacationInflationPct: 4, numVacations: 5 });
    expect(funded.lumpsumToday).toBe(0);
  });
});
