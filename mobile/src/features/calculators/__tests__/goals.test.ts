/**
 * Goals & Planning: each def against the web CRM — the web module run on the
 * same inputs (webModule) and the reference figures the web component (or its
 * maths module) documents in its header.
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import { DEFS } from "../defs/goals";
import * as appGoal from "../web/goal-planner";
import * as appMulti from "../web/multipurpose";
import * as appGpc from "../web/goal-planning-calc";
import * as appEdu from "../web/child-education";
import * as appChildSip from "../web/child-sip";
import * as appCol from "../web/goal-collision";
import * as appFeas from "../web/goal-feasibility";
import * as appSuite from "../web/sip-suite";
import * as appRet from "../web/retirement-need";
import * as appStp from "../web/stp-comprehensive";
import * as appPpf from "../web/ppf";
import * as appEpf from "../web/epf";
import { inr, inrCompact, fmtPct } from "../fmt";
import type { ResultBlock } from "../types";

const webGoal = webModule<typeof appGoal>("calculators/goal-planner");
const webMulti = webModule<typeof appMulti>("calculators/multipurpose");
const webGpc = webModule<typeof appGpc>("goal-planning/calc");
const webEdu = webModule<typeof appEdu>("calculators/child-education");
const webChildSip = webModule<typeof appChildSip>("calculators/child-sip");
const webCol = webModule<typeof appCol>("calculators/goal-collision");
const webFeas = webModule<typeof appFeas>("calculators/goal-feasibility");
const webSuite = webModule<typeof appSuite>("calculators/sip-suite");
const webRet = webModule<typeof appRet>("calculators/retirement-need");
const webStp = webModule<typeof appStp>("calculators/stp-comprehensive");
const webPpf = webModule<typeof appPpf>("calculators/ppf");
const webEpf = webModule<typeof appEpf>("calculators/epf");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));

describe("every Goals & Planning def", () => {
  it.each(Object.keys(DEFS))("%s survives blank and zero inputs", (key) => {
    const body = DEFS[key];
    const zeros: Record<string, any> = {};
    const blanks: Record<string, any> = {};
    for (const i of body.inputs) {
      if (typeof i.default === "number") {
        zeros[i.key] = 0;
        blanks[i.key] = undefined;
      }
    }
    expect(() => run(body, zeros)).not.toThrow();
    expect(() => run(body, blanks)).not.toThrow();
  });
  it("ports all eighteen keys of the group", () => {
    expect(Object.keys(DEFS).sort()).toEqual([
      "childedu", "childsip", "collision", "delay", "epf", "feasibility", "goalplan", "inflation", "limitedneed",
      "lstarget", "multipurpose", "ppf", "retirement", "siplstarget", "sipstpgoal", "stepuptarget", "stpgoal", "vacation",
    ]);
  });
});

describe("goalplan — Goal Planner", () => {
  it("prints the web's reference case to the rupee", () => {
    // goal-planner.ts: ₹50L / 15y / 12% → lumpsum ₹9,13,481, SIP ₹10,605,
    // limited-10y SIP ₹12,784, ₹5L lumpsum + SIP ₹4,800.
    const b = run(DEFS.goalplan);
    const [g1, g2] = tables(b);
    expect(g1.head).toEqual(["Investment option", "Amount needed"]);
    expect(g1.rows).toEqual([
      ["Lumpsum (one-time, today)", "₹9,13,481"],
      ["Monthly SIP (for 15 yrs)", "₹10,605 / mo"],
      ["Limited-period SIP (10 yrs, then grows)", "₹12,784 / mo"],
      ["Lumpsum ₹5,00,000 + Monthly SIP", "₹4,800 / mo"],
    ]);
    const alloc = { debt: 0, hybrid: 0, equity: 100 };
    const rates = { debt: 6, hybrid: 9, equity: 12 };
    const w1 = webGoal.computeGoal({ costBasis: "future", cost: 5000000, inflationPct: 6, periodYears: 15, alloc, rates, limitedYears: 10, comboLumpsum: 500000 });
    const w2 = webGoal.computeGoal({ costBasis: "future", cost: 100000000, inflationPct: 6, periodYears: 25, alloc, rates, limitedYears: 20, comboLumpsum: 500000 });
    expect(g2.rows[0][1]).toBe(inr(w2.lumpsum));
    expect(statOf(b, "All goals — total lumpsum")).toBe(inr(w1.lumpsum + w2.lumpsum));
    expect(statOf(b, "All goals — total monthly SIP")).toBe(inr(w1.monthlySip + w2.monthlySip));
    expect(statOf(b, "Goals")).toBe("2");
    expect(statOf(b, "Allocation total / return")).toBe("100% · 12%");
    expect(texts(b, "section")).toEqual(["Child Education", "Retirement Corpus"]);
    expect(texts(b, "note")[0]).toBe("Future cost: ₹50,00,000 in 15 years · assumed return 12%");
  });
  it.each([
    { costBasis: "current", cost: 2000000, inflationPct: 7, periodYears: 12, alloc: { debt: 20, hybrid: 30, equity: 50 }, rates: { debt: 6.5, hybrid: 9, equity: 13 }, limitedYears: 6, comboLumpsum: 300000 },
    { costBasis: "future", cost: 7500000, inflationPct: 6, periodYears: 8, alloc: { debt: 40, hybrid: 0, equity: 70 }, rates: { debt: 7, hybrid: 9, equity: 11.5 }, limitedYears: 12, comboLumpsum: 6000000 },
    { costBasis: "future", cost: 900000, inflationPct: 6, periodYears: 0, alloc: { debt: 0, hybrid: 0, equity: 100 }, rates: { debt: 6, hybrid: 9, equity: 12 }, limitedYears: 5, comboLumpsum: 0 },
  ] as const)("computeGoal equals the web module (%#)", (input) => {
    const w = webGoal.computeGoal(input as any);
    expect(appGoal.computeGoal(input as any)).toEqual(w);
    const b = run(DEFS.goalplan, {
      g2on: false, g1basis: input.costBasis, g1costF: input.cost, g1costC: input.cost, g1infl: input.inflationPct,
      g1period: input.periodYears, g1limited: input.limitedYears, g1combo: input.comboLumpsum,
      g1debtRate: input.rates.debt, g1hybridRate: input.rates.hybrid, g1equityRate: input.rates.equity,
      g1debtAlloc: input.alloc.debt, g1hybridAlloc: input.alloc.hybrid, g1equityAlloc: input.alloc.equity,
    });
    const t = tables(b)[0];
    expect(t.rows[0][1]).toBe(inr(w.lumpsum));
    expect(t.rows[1][1]).toBe(w.dueNow ? "Due now — lumpsum" : `${inr(w.monthlySip)} / mo`);
    // One goal: no roll-up.
    expect(statOf(b, "Goals")).toBeUndefined();
    const total = input.alloc.debt + input.alloc.hybrid + input.alloc.equity;
    expect(texts(b, "insight").some((x) => x.startsWith("Allocation should total 100%"))).toBe(total !== 100);
  });
});

describe("multipurpose — Cashflow & Corpus", () => {
  it("prints the web's reference case (₹1 cr @ 12%, age 40 → 90)", () => {
    // multipurpose.ts: ₹289 cr fund value; max SWP ₹95,217/mo now, ₹1,68,250/mo deferred 5y.
    const w = webMulti.computeMultipurpose({ currentAge: 40, reportTillAge: 90, ratePct: 12, calcType: "lumpsum", amount: 10000000, stepUpPct: 10, withdrawal: "both", reportType: "fund_value", customMonthly: 100000 });
    expect(Math.round(w.finalFundValue / 1e7)).toBe(289);
    const b = run(DEFS.multipurpose);
    expect(statOf(b, "Total invested")).toBe("₹1,00,00,000");
    expect(statOf(b, "Fund value at age 90 (no withdrawal)")).toBe(inr(w.finalFundValue));
    expect(statOf(b, "Horizon")).toBe("50 yrs");
    const [fund, swp] = tables(b);
    expect(fund.rows).toHaveLength(w.fundProjection!.length);
    expect(swp.rows[0]).toEqual(["Now (age 40)", inr(w.swpTable![0].corpus), "₹95,217", inr(w.swpTable![0].totalWithdrawn)]);
    expect(swp.rows[1][0]).toBe("Age 45 (+5y)");
    expect(swp.rows[1][2]).toBe("₹1,68,250");
    expect(texts(b, "section")).toEqual(["1. Fund value projection (no withdrawals)", "2. Maximum monthly SWP (sustained till age 90)"]);
  });
  it.each([
    { currentAge: 30, reportTillAge: 75, ratePct: 11, calcType: "sip", amount: 25000, stepUpPct: 10, withdrawal: "swp", reportType: "custom_withdrawal", customMonthly: 400000 },
    { currentAge: 35, reportTillAge: 80, ratePct: 10, calcType: "stepup", amount: 15000, stepUpPct: 8, withdrawal: "periodic", reportType: "fund_value", customMonthly: 0 },
    { currentAge: 50, reportTillAge: 88, ratePct: 9, calcType: "lumpsum", amount: 5000000, stepUpPct: 0, withdrawal: "both", reportType: "custom_withdrawal", customMonthly: 30000 },
  ] as const)("computeMultipurpose equals the web module (%#)", (input) => {
    const w = webMulti.computeMultipurpose(input as any);
    expect(appMulti.computeMultipurpose(input as any)).toEqual(w);
    const b = run(DEFS.multipurpose, { ...input, lumpsum: input.amount, monthly: input.amount });
    expect(statOf(b, `Fund value at age ${input.reportTillAge} (no withdrawal)`)).toBe(inr(w.finalFundValue));
    expect(statOf(b, "Total invested")).toBe(inr(w.finalInvested));
    if (w.customTable) {
      const all = tables(b);
      const t = all[all.length - 1];
      expect(t.rows.map((r) => r[2])).toEqual(w.customTable.map((r) => (r.sustained ? `Sustains till ${input.reportTillAge}` : `Runs out at age ${r.lastsTillAge}`)));
    }
  });
  it("prints the report header first", () => {
    expect(texts(run(DEFS.multipurpose, { reportHeader: "My Financial Plan" }), "section")[0]).toBe("My Financial Plan");
  });
});

describe("vacation — Advanced Vacation Planner", () => {
  const VAC = { initialInvestment: 2000000, equityReturnPct: 12, sipGrowthPct: 15, sipYears: 12, currentVacationCost: 400000, vacationInflationPct: 4, numVacations: 50 };
  it("prints the web's default case, with the lumpsum beside the SIP", () => {
    const w = webGpc.vacationPlan(VAC);
    const b = run(DEFS.vacation);
    expect(statOf(b, "Corpus needed (1 yr out)")).toBe(inr(w.corpusNeeded));
    expect(statOf(b, "Initial grows to (1 yr)")).toBe("₹22,40,000");
    expect(statOf(b, "Gap to fund via SIP")).toBe(inr(w.amountStillNeeded));
    expect(statOf(b, "Growing SIP — monthly (mo 1)")).toBe(inr(w.monthlySip));
    expect(statOf(b, "Growing SIP — annual (yr 1)")).toBe(inr(w.annualSip));
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(w.amountStillNeeded / 1.12));
    expect(statOf(b, "Total vacation spend (nominal)")).toBe(inrCompact(w.totalNominalSpend));
    expect(statOf(b, "Year 1 cost")).toBe("₹4,00,000");
    expect(statOf(b, "Growth-adjusted rate")).toBe(`${w.realRatePct.toFixed(2)}%`);
    expect(statOf(b, "Year 50 cost")).toBe(inr(w.drawdown[49].cost));
  });
  it.each([
    { ...VAC, initialInvestment: 500000, sipYears: 20, numVacations: 25, equityReturnPct: 10 },
    { ...VAC, initialInvestment: 90000000 },
    { ...VAC, sipYears: 0 },
  ])("vacationPlan equals the web module (%#)", (input) => {
    const w = webGpc.vacationPlan(input);
    expect(appGpc.vacationPlan(input)).toEqual(w);
    const b = run(DEFS.vacation, {
      initial: input.initialInvestment, vacationCost: input.currentVacationCost, numVacations: input.numVacations,
      returnPct: input.equityReturnPct, inflationPct: input.vacationInflationPct, growthPct: input.sipGrowthPct, sipYears: input.sipYears,
    });
    if (w.amountStillNeeded <= 0) {
      expect(statOf(b, "Surplus — fully funded")).toBe(inr(w.initialAfterOneYear - w.corpusNeeded));
      expect(statOf(b, "Or one-time lumpsum today")).toBe("—");
    } else {
      expect(statOf(b, "Growing SIP — monthly (mo 1)")).toBe(inr(w.monthlySip));
      expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(w.lumpsumToday));
    }
  });
});

describe("childedu — Child Education & Marriage Planner", () => {
  it("prints the web's reference case to the rupee", () => {
    // child-education.ts: child 4, ₹1,00,00,000 at 21, ₹5,00,000 saved @ 12%, 6% inflation, 12% / 15%.
    const b = run(DEFS.childedu);
    expect(texts(b, "section")).toEqual(["1. Education for the child — in 17 years"]);
    expect(statOf(b, "Cost when needed")).toBe("₹2,69,27,728");
    expect(statOf(b, "Savings will cover")).toBe("₹34,33,020");
    expect(statOf(b, "Balance to fund")).toBe("₹2,34,94,707");
    const t = tables(b)[0];
    expect(t.head).toEqual(["Way to fund the balance", "@ 12%", "@ 15%"]);
    expect(t.rows).toEqual([
      ["Monthly SIP till age 21", "₹37,647", "₹27,871"],
      ["Monthly SIP for 5 years, then hold", "₹74,356", "₹50,277"],
      ["Monthly SIP for 10 years, then hold", "₹47,438", "₹33,581"],
      ["Lumpsum today", "₹34,21,871", "₹21,83,267"],
    ]);
    // One milestone: no "All needs" roll-up.
    expect(statOf(b, "All needs — future cost")).toBeUndefined();
    expect(texts(b, "insight")[0]).toBe("At 6% inflation, today's ₹1,00,00,000 becomes ₹2,69,27,728 in 17 years. Starting now, ₹37,647/month @ 12% closes the gap — a shorter SIP needs more each month, and waiting raises every figure.");
  });
  it.each([
    { childCurrentAge: 6, eduInflationPct: 9, expectedReturnPct: 11, existingSavings: 300000, currentInvestmentReturnPct: 8, scenario2Pct: 14, milestones: [{ name: "UG", childAgeAtStart: 18, currentCost: 2500000 }, { name: "PG abroad", childAgeAtStart: 22, currentCost: 6000000 }] },
    { childCurrentAge: 10, eduInflationPct: 6, expectedReturnPct: 12, existingSavings: 9000000, currentInvestmentReturnPct: 12, scenario2Pct: null, milestones: [{ name: "Marriage", childAgeAtStart: 26, currentCost: 3000000 }] },
    { childCurrentAge: 17, eduInflationPct: 10, expectedReturnPct: 12, existingSavings: 0, currentInvestmentReturnPct: 12, scenario2Pct: 15, milestones: [{ name: "College", childAgeAtStart: 17, currentCost: 800000 }, { name: "Masters", childAgeAtStart: 25, currentCost: 2000000 }] },
  ])("computeChildEducation equals the web module (%#)", (input) => {
    const w = webEdu.computeChildEducation(input);
    expect(appEdu.computeChildEducation(input)).toEqual(w);
    const m = input.milestones;
    const b = run(DEFS.childedu, {
      childCurrentAge: input.childCurrentAge, inflationPct: input.eduInflationPct, scenario1Pct: input.expectedReturnPct,
      existingSavings: input.existingSavings, savingsReturnPct: input.currentInvestmentReturnPct,
      useScenario2: input.scenario2Pct != null, scenario2Pct: input.scenario2Pct ?? 0,
      m1name: m[0].name, m1age: m[0].childAgeAtStart, m1cost: m[0].currentCost,
      m2on: m.length > 1, m2name: m[1]?.name, m2age: m[1]?.childAgeAtStart, m2cost: m[1]?.currentCost,
    });
    expect(texts(b, "section")).toEqual(w.milestones.map((x, i) => `${i + 1}. ${x.name} for the child — in ${x.yearsAway} years`));
    expect(b.filter((x) => x.type === "stat" && x.label === "Balance to fund").map((x) => (x as any).value)).toEqual(w.milestones.map((x) => inr(x.balance)));
    if (m.length > 1) {
      expect(statOf(b, `All needs — monthly SIP @ ${fmtPct(input.expectedReturnPct)}`)).toBe(inr(w.totalMonthlySip));
      expect(statOf(b, `All needs — lumpsum @ ${fmtPct(input.expectedReturnPct)}`)).toBe(inr(w.totalLumpsum));
    }
  });
  it("says a need due now can only be met by a lumpsum", () => {
    const b = run(DEFS.childedu, { childCurrentAge: 21, existingSavings: 0 });
    expect(texts(b, "insight")[0]).toBe("This need is due now — only a lumpsum (₹1,00,00,000) can meet it.");
    expect(tables(b)).toHaveLength(0);
  });
});

describe("childsip — Early-Start Child SIP", () => {
  it("prints the web's default case", () => {
    const w = webChildSip.computeChildSip({ startAge: 0, monthlySip: 25000, investTillAge: 20, returnPct: 12, projectToAge: 50 });
    const b = run(DEFS.childsip);
    expect(statOf(b, "Invested (20y of SIP)")).toBe("₹60,00,000");
    expect(statOf(b, "Corpus at age 20")).toBe(inr(w.corpusAtTill));
    expect(statOf(b, "Value at age 50")).toBe(inr(w.finalValue));
    expect(statOf(b, "Multiple on invested")).toBe(`${w.finalMultiple.toFixed(1)}×`);
    const t = tables(b)[0];
    expect(t.rows[0][0]).toBe("Age 20 (SIP ends)");
    expect(t.rows.map((r) => r[1])).toEqual(w.milestones.map((m) => inr(m.value)));
    expect(texts(b, "section")).toEqual(["1. The headline", "2. Value at each milestone age"]);
  });
  it.each([
    { startAge: 3, monthlySip: 10000, investTillAge: 18, returnPct: 11, projectToAge: 47 },
    { startAge: 0, monthlySip: 5000, investTillAge: 10, returnPct: 0, projectToAge: 10 },
  ])("computeChildSip equals the web module (%#)", (input) => {
    const w = webChildSip.computeChildSip(input);
    expect(appChildSip.computeChildSip(input)).toEqual(w);
    expect(statOf(run(DEFS.childsip, input), `Value at age ${w.finalAge}`)).toBe(inr(w.finalValue));
  });
});

describe("collision — Goal-Collision Timeline", () => {
  const GOALS = [
    { name: "Car upgrade", yearsAway: 3, futureCost: 1500000, returnPct: 9 },
    { name: "Child education", yearsAway: 12, futureCost: 8000000, returnPct: 12 },
    { name: "Home down-payment", yearsAway: 6, futureCost: 4000000, returnPct: 11 },
    { name: "Retirement", yearsAway: 25, futureCost: 50000000, returnPct: 12 },
  ];
  it("prints the web's default case, with the lumpsum beside every SIP", () => {
    const w = webCol.computeGoalCollision(GOALS);
    const b = run(DEFS.collision);
    expect(statOf(b, "Highest monthly commitment (now)")).toBe(inr(w.peakMonthly));
    expect(statOf(b, "Or one-time lumpsum today (all goals)")).toBe(inr(w.totalLumpsumToday));
    expect(statOf(b, "Goals running now")).toBe("4");
    expect(statOf(b, "Goals")).toBe("4");
    const [perGoal, years] = tables(b);
    expect(perGoal.rows[0]).toEqual(["Car upgrade", "3y · ₹15,00,000", `${inr(w.goals[0].monthlySip)}/mo or ${inr(w.goals[0].lumpsumToday)} today`]);
    expect(years.rows).toHaveLength(25);
    expect(years.rows[0]).toEqual(["Y1", `${inr(w.timeline[0].totalMonthly)}/mo`]);
  });
  it.each([
    [...GOALS.slice(1), { name: "Due now", yearsAway: 0, futureCost: 600000, returnPct: 8 }],
    [{ name: "Wedding", yearsAway: 4, futureCost: 2500000, returnPct: 10 }, { name: "Sabbatical", yearsAway: 9, futureCost: 3000000, returnPct: 11 }],
  ])("computeGoalCollision equals the web module (%#)", (...goals) => {
    const w = webCol.computeGoalCollision(goals);
    expect(appCol.computeGoalCollision(goals)).toEqual(w);
    const o: Record<string, any> = {};
    for (let i = 1; i <= 6; i++) {
      const g = goals[i - 1];
      o[`c${i}on`] = !!g;
      if (g) Object.assign(o, { [`c${i}name`]: g.name, [`c${i}years`]: g.yearsAway, [`c${i}cost`]: g.futureCost, [`c${i}ret`]: g.returnPct });
    }
    const b = run(DEFS.collision, o);
    expect(statOf(b, "Highest monthly commitment (now)")).toBe(inr(w.peakMonthly));
    expect(tables(b)[0].rows.map((r) => r[2])).toEqual(w.goals.map((g) => (appCol.isDueNow(g.yearsAway) ? `Due now — lumpsum ${inr(g.lumpsumToday)}` : `${inr(g.monthlySip)}/mo or ${inr(g.lumpsumToday)} today`)));
  });
});

describe("feasibility — Goal-Feasibility Score", () => {
  const GOALS = [
    { name: "Child education", futureCost: 8000000, yearsAway: 12, returnPct: 12 },
    { name: "Retirement", futureCost: 50000000, yearsAway: 25, returnPct: 12 },
    { name: "Home", futureCost: 4000000, yearsAway: 6, returnPct: 10 },
  ];
  const BASE = { monthlyIncome: 200000, currentMonthlySip: 40000, existingCorpus: 2500000, corpusReturnPct: 11 };
  const verdictOf = (s: number) => (s >= 80 ? "On track" : s >= 55 ? "Needs attention" : "Off track");
  it("prints the web's default case", () => {
    const w = webFeas.computeGoalFeasibility({ ...BASE, goals: GOALS });
    const b = run(DEFS.feasibility);
    expect(statOf(b, verdictOf(w.score))).toBe(`${w.score}`);
    expect(statOf(b, "Required monthly (all goals)")).toBe(inr(w.requiredMonthlyTotal));
    expect(statOf(b, "Covered by existing corpus")).toBe(inr(w.corpusCoversMonthlyEquivalent));
    expect(statOf(b, "Net required / available")).toBe(`${inr(w.netRequiredMonthly)} / ₹40,000`);
    expect(statOf(b, "Monthly gap")).toBe(inr(w.gapMonthly));
    expect(statOf(b, "Or one-time lumpsum today (after corpus)")).toBe(inr(w.netLumpsumToday));
    const dial = b.find((x) => x.type === "stat" && x.label === verdictOf(w.score));
    expect(dial && dial.type === "stat" ? dial.hint : "").toBe("Feasibility score out of 100 · savings rate 20%");
  });
  it.each([
    { ...BASE, currentMonthlySip: 250000, goals: GOALS },
    { ...BASE, existingCorpus: 0, goals: [...GOALS, { name: "Now", futureCost: 900000, yearsAway: 0, returnPct: 8 }] },
    { monthlyIncome: 0, currentMonthlySip: 15000, existingCorpus: 100000, corpusReturnPct: 9, goals: [{ name: "Car", futureCost: 1200000, yearsAway: 4, returnPct: 9 }] },
  ])("computeGoalFeasibility equals the web module (%#)", (input) => {
    const w = webFeas.computeGoalFeasibility(input);
    expect(appFeas.computeGoalFeasibility(input)).toEqual(w);
    const o: Record<string, any> = { monthlyIncome: input.monthlyIncome, currentMonthlySip: input.currentMonthlySip, existingCorpus: input.existingCorpus, corpusReturnPct: input.corpusReturnPct };
    for (let i = 1; i <= 5; i++) {
      const g = input.goals[i - 1];
      o[`f${i}on`] = !!g;
      if (g) Object.assign(o, { [`f${i}name`]: g.name, [`f${i}cost`]: g.futureCost, [`f${i}years`]: g.yearsAway, [`f${i}ret`]: g.returnPct });
    }
    const b = run(DEFS.feasibility, o);
    expect(statOf(b, verdictOf(w.score))).toBe(`${w.score}`);
    expect(statOf(b, "Monthly gap")).toBe(inr(w.gapMonthly));
    expect(statOf(b, "Or one-time lumpsum today (after corpus)")).toBe(inr(w.netLumpsumToday));
  });
});

describe("inflation — Inflation", () => {
  it("prints the web's default case", () => {
    const fv = webGpc.inflatedTarget(100000, 6, 15);
    const b = run(DEFS.inflation);
    expect(statOf(b, "Today's value")).toBe("₹1,00,000");
    expect(statOf(b, "Future value")).toBe(inr(fv));
    expect(statOf(b, "Future value")).toBe("₹2,39,656");
    expect(statOf(b, "Inflation impact")).toBe(inr(fv - 100000));
  });
  it.each([[250000, 7.5, 10], [1800000, 0, 20], [50000, 11, 3.5]])("inflatedTarget equals the web module (%#)", (amount, rate, years) => {
    expect(appGpc.inflatedTarget(amount, rate, years)).toBe(webGpc.inflatedTarget(amount, rate, years));
    expect(statOf(run(DEFS.inflation, { amount, ratePct: rate, years }), "Future value")).toBe(inr(webGpc.inflatedTarget(amount, rate, years)));
  });
});

describe("delay — SIP for a Target & Cost of Delay", () => {
  it("prints the web's reference case to the rupee", () => {
    // SipForTargetCalculator.tsx: ₹50,00,000 in 15 years → ₹10,506 / ₹8,112 at 12% / 15%,
    // step-up +10% from ₹6,043 / ₹4,874; one year's delay → ₹12,091 / ₹9,529.
    const b = run(DEFS.delay);
    expect(statOf(b, "Monthly SIP @ 12%")).toBe("₹10,506");
    expect(statOf(b, "Monthly SIP @ 15%")).toBe("₹8,112");
    expect(statOf(b, "One-time lumpsum today @ 12%")).toBe(inr(webSuite.lumpsumNeededToday(5000000, 12, 15)));
    expect(statOf(b, "One-time lumpsum today @ 15%")).toBe(inr(webSuite.lumpsumNeededToday(5000000, 15, 15)));
    expect(statOf(b, "Starting step-up SIP @ 12%")).toBe("₹6,043");
    expect(statOf(b, "Starting step-up SIP @ 15%")).toBe("₹4,874");
    const [summary, sip, step, delayT] = tables(b);
    expect(summary.head).toEqual(["", "Monthly SIP @ 12%", "Monthly SIP @ 15%", "Total invested @ 12%", "Total invested @ 15%"]);
    expect(sip.rows).toHaveLength(15);
    expect(step.rows).toHaveLength(15);
    expect(delayT.rows[1].slice(0, 3)).toEqual(["1 yr", "₹12,091", "₹9,529"]);
    expect(texts(b, "section")).toEqual(["1. SIP — year-wise value", "2. Step-up SIP (+10%/yr) — year-wise value", "3. Cost of delaying the SIP"]);
    expect(texts(b, "insight")[0]).toBe(`To reach ₹50,00,000 in 15 years at 12%: a SIP of ₹10,506/month — or a one-time lumpsum of ${inr(webSuite.lumpsumNeededToday(5000000, 12, 15))} invested today (₹8,112/month or ${inr(webSuite.lumpsumNeededToday(5000000, 15, 15))} today at 15%).`);
  });
  it.each([
    { target: 2000000, years: 10, ratesPct: [11], stepUpPct: null, costOfDelay: true },
    { target: 10000000, years: 22, ratesPct: [10, 13.5], stepUpPct: 7, costOfDelay: false },
  ])("sipForTarget equals the web module (%#)", (input) => {
    const w = webSuite.sipForTarget(input);
    expect(appSuite.sipForTarget(input)).toEqual(w);
    const b = run(DEFS.delay, {
      target: input.target, years: input.years, r1: input.ratesPct[0], useR2: input.ratesPct.length > 1, r2: input.ratesPct[1] ?? 0,
      withStepUp: input.stepUpPct != null, stepUpPct: input.stepUpPct ?? 0, withDelay: input.costOfDelay,
    });
    expect(statOf(b, `Monthly SIP @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].sip));
    expect(statOf(b, `One-time lumpsum today @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].lumpsumToday));
  });
  it("asks for a SIP period of at least one year", () => {
    expect(texts(run(DEFS.delay, { years: 0 }), "insight")).toEqual(["Enter a SIP period of at least one year."]);
  });
});

describe("retirement — Retirement Need Based", () => {
  it("prints the web's reference case to the rupee", () => {
    // retirement-need.ts: expense ₹1,52,790, corpus ₹3,81,67,725, gap ₹3,21,12,306,
    // SIP ₹24,047 / ₹51,488 / ₹32,849, lumpsum ₹23,69,501.
    const b = run(DEFS.retirement);
    expect(statOf(b, "Monthly expense at 55")).toBe("₹1,52,790");
    expect(statOf(b, "Corpus needed")).toBe("₹3,81,67,725");
    expect(statOf(b, "Still to build")).toBe("₹3,21,12,306");
    const [need, ways, drawdown] = tables(b);
    expect(need.head).toEqual(["", "Scenario 1 (12% / 8%)"]);
    expect(need.rows[4]).toEqual(["Balance corpus required", "₹3,21,12,306"]);
    expect(ways.rows).toEqual([
      ["Monthly SIP till age 55", "₹24,047"],
      ["Monthly SIP for 5 years, then stay invested", "₹51,488"],
      ["Monthly SIP for 10 years, then stay invested", "₹32,849"],
      ["Lumpsum today", "₹23,69,501"],
    ]);
    expect(drawdown.rows).toHaveLength(30);
    expect(texts(b, "section")).toEqual(["1. The retirement need", "2. Ways to build the balance", "3. Monthly income and corpus left, age 56 to 85"]);
  });
  it.each([
    { currentAge: 40, retirementAge: 60, monthlyExpense: 75000, inflPrePct: 6.5, inflPostPct: 5, scenarios: [{ accPct: 12, distPct: 8 }, { accPct: 10, distPct: 7 }], currentInvestment: 3000000, currentInvestmentPct: 9, receivable: 2000000, annuityEndAge: 90, endBalance: 0 },
    { currentAge: 52, retirementAge: 56, monthlyExpense: 30000, inflPrePct: 6, inflPostPct: 5, scenarios: [{ accPct: 11, distPct: 7.5 }], currentInvestment: 40000000, currentInvestmentPct: 8, receivable: 0, annuityEndAge: 80, endBalance: 1000000 },
  ])("retirementNeed equals the web module (%#)", (input) => {
    const w = webRet.retirementNeed(input);
    expect(appRet.retirementNeed(input)).toEqual(w);
    const two = input.scenarios.length > 1;
    const b = run(DEFS.retirement, {
      ...input, acc1: input.scenarios[0].accPct, dist1: input.scenarios[0].distPct,
      useScenario2: two, acc2: input.scenarios[1]?.accPct ?? 0, dist2: input.scenarios[1]?.distPct ?? 0,
    });
    expect(statOf(b, "Corpus needed")).toBe(inr(w.scenarios[0].corpus));
    expect(tables(b)[1].rows[3]).toEqual(["Lumpsum today", ...w.scenarios.map((s) => inr(s.lumpsum))]);
  });
});

describe("limitedneed — Limited-Period SIP for a Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // LimitedSipNeedCalculator.tsx: ₹25,00,000, 5-year SIP held 10 more at 12% → ₹9,925/month, ₹5,95,485 invested.
    const b = run(DEFS.limitedneed);
    expect(statOf(b, "Monthly SIP needed @ 12%")).toBe("₹9,925");
    expect(statOf(b, "Total invested @ 12%")).toBe("₹5,95,485");
    expect(statOf(b, "One-time lumpsum today @ 12%")).toBe(inr(webSuite.lumpsumNeededToday(2500000, 12, 15)));
    expect(tables(b)[0].rows).toHaveLength(15);
    expect(tables(b)[0].rows[5].slice(1, 3)).toEqual(["—", "—"]);
  });
  it.each([
    { target: 10000000, sipYears: 8, deferYears: 7, ratesPct: [11, 14] },
    { target: 3000000, sipYears: 0, deferYears: 10, ratesPct: [12] },
  ])("limitedSipNeed equals the web module (%#)", (input) => {
    const w = webSuite.limitedSipNeed(input);
    expect(appSuite.limitedSipNeed(input)).toEqual(w);
    const b = run(DEFS.limitedneed, { target: input.target, sipYears: input.sipYears, deferYears: input.deferYears, r1: input.ratesPct[0], useR2: input.ratesPct.length > 1, r2: input.ratesPct[1] ?? 0 });
    expect(statOf(b, `Monthly SIP needed @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].monthlySip));
    expect(statOf(b, `One-time lumpsum today @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].lumpsumToday));
    if (input.sipYears === 0) expect(texts(b, "insight")).toEqual(["Enter a SIP period of at least one year."]);
  });
});

describe("stepuptarget — Step-Up SIP for a Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // StepUpSipForTargetCalculator.tsx: ₹50,00,000 in 15 years, +5% a year → ₹9,425 (10%) / ₹7,467 (13%),
    // investing ₹24,40,656 / ₹19,33,620.
    const b = run(DEFS.stepuptarget);
    expect(statOf(b, "Starting SIP @ 10%")).toBe("₹9,425");
    expect(statOf(b, "Starting SIP @ 13%")).toBe("₹7,467");
    expect(statOf(b, "Total invested @ 10%")).toBe("₹24,40,656");
    expect(statOf(b, "Total invested @ 13%")).toBe("₹19,33,620");
    expect(statOf(b, "One-time lumpsum today @ 10%")).toBe(inr(webSuite.lumpsumNeededToday(5000000, 10, 15)));
    expect(texts(b, "section")).toEqual(["1. Year-wise plan @ 10%", "2. Year-wise plan @ 13%"]);
  });
  it.each([
    { target: 20000000, years: 20, stepUpPct: 10, ratesPct: [12] },
    { target: 1500000, years: 6, stepUpPct: 0, ratesPct: [9, 11.5] },
  ])("stepUpSipForTarget equals the web module (%#)", (input) => {
    const w = webSuite.stepUpSipForTarget(input);
    expect(appSuite.stepUpSipForTarget(input)).toEqual(w);
    const b = run(DEFS.stepuptarget, { target: input.target, years: input.years, stepUpPct: input.stepUpPct, r1: input.ratesPct[0], useR2: input.ratesPct.length > 1, r2: input.ratesPct[1] ?? 0 });
    expect(statOf(b, `Starting SIP @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].startSip));
    expect(statOf(b, `One-time lumpsum today @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].lumpsumToday));
  });
});

describe("siplstarget — SIP or Lumpsum for a Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // SipLumpsumForTargetCalculator.tsx: ₹1,00,00,000 in 15 years with ₹10,00,000 today, both at 12% → ₹9,511/month.
    const b = run(DEFS.siplstarget);
    expect(statOf(b, "Monthly SIP needed")).toBe("₹9,511");
    expect(statOf(b, "Lumpsum today")).toBe("₹10,00,000");
    expect(statOf(b, "Target")).toBe("₹1,00,00,000");
    expect(tables(b)[0].rows).toHaveLength(15);
  });
  it.each([
    { target: 5000000, years: 10, solve: "lumpsum", lumpsum: 0, monthlySip: 15000, sipPct: 12, lumpsumPct: 10 },
    { target: 2000000, years: 12, solve: "sip", lumpsum: 900000, monthlySip: 0, sipPct: 12, lumpsumPct: 12 },
  ] as const)("sipLumpsumForTarget equals the web module (%#)", (input) => {
    const w = webSuite.sipLumpsumForTarget(input);
    expect(appSuite.sipLumpsumForTarget(input)).toEqual(w);
    const b = run(DEFS.siplstarget, input);
    const label = input.solve === "sip" ? "Monthly SIP needed" : "Lumpsum needed today";
    expect(statOf(b, label)).toBe(inr(input.solve === "sip" ? w.sip : w.lumpsum));
    if (w.covered) expect(texts(b, "insight")[0]).toMatch(/alone already reaches/);
  });
});

describe("lstarget — Lumpsum for a Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // LumpsumForTargetCalculator.tsx: ₹3,00,00,000 in 25 years → ₹17,64,699 at 12%, ₹9,11,329 at 15%.
    const b = run(DEFS.lstarget);
    expect(statOf(b, "Invest today @ 12%")).toBe("₹17,64,699");
    expect(statOf(b, "Invest today @ 15%")).toBe("₹9,11,329");
    expect(statOf(b, "Period")).toBe("25 yrs");
    const t = tables(b)[0];
    expect(t.rows).toHaveLength(25);
    expect(t.rows[24]).toEqual(["25", "—", "₹3,00,00,000", "—", "₹3,00,00,000"]);
  });
  it.each([
    { target: 8000000, years: 12, ratesPct: [10] },
    { target: 500000, years: 3, ratesPct: [7, 9.5] },
  ])("lumpsumForTarget equals the web module (%#)", (input) => {
    const w = webSuite.lumpsumForTarget(input);
    expect(appSuite.lumpsumForTarget(input)).toEqual(w);
    const b = run(DEFS.lstarget, { target: input.target, years: input.years, r1: input.ratesPct[0], useR2: input.ratesPct.length > 1, r2: input.ratesPct[1] ?? 0 });
    expect(statOf(b, `Invest today @ ${fmtPct(input.ratesPct[0])}`)).toBe(inr(w[0].lumpsum));
  });
});

describe("sipstpgoal — SIP / STP for Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // SipStpTargetCalculator.tsx: ₹25L · 10 yrs · STP ₹5L 6% → 12% · SIP @12% → ₹6,516 a month.
    const b = run(DEFS.sipstpgoal);
    expect(statOf(b, "Monthly SIP required")).toBe("₹6,516");
    const w = webStp.computeSipStpForTarget({ target: 2500000, years: 10, solve: "sip", stpLumpsum: 500000, monthlySip: 5000, debtPct: 6, equityPct: 12, sipRatePct: 12 });
    expect(statOf(b, "Total value")).toBe(inr(w.projection.total));
    expect(tables(b)[0].rows).toHaveLength(10);
  });
  it.each([
    { target: 5000000, years: 12, solve: "stp", stpLumpsum: 0, monthlySip: 8000, debtPct: 7, equityPct: 13, sipRatePct: 12 },
    { target: 1000000, years: 10, solve: "sip", stpLumpsum: 900000, monthlySip: 0, debtPct: 6, equityPct: 12, sipRatePct: 12 },
  ] as const)("computeSipStpForTarget equals the web module (%#)", (input) => {
    const w = webStp.computeSipStpForTarget(input);
    expect(appStp.computeSipStpForTarget(input)).toEqual(w);
    const b = run(DEFS.sipstpgoal, input);
    expect(statOf(b, input.solve === "sip" ? "Monthly SIP required" : "STP lumpsum required")).toBe(inr(input.solve === "sip" ? w.monthlySip : w.stpLumpsum));
    if (w.overshoots) expect(texts(b, "insight")[0]).toMatch(/no SIP is needed/);
  });
});

describe("stpgoal — STP for Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // StpTargetCalculator.tsx: ₹1 Cr · 12 yrs · 6% / 12% · 1% a month → ₹33,51,520.
    const b = run(DEFS.stpgoal);
    expect(statOf(b, "Initial investment required")).toBe("₹33,51,520");
    const w = webStp.stpRequiredForTarget({ target: 10000000, years: 12, debtPct: 6, equityPct: 12, mode: "fixedPct", fixedAmount: 30000, fixedPct: 1 });
    expect(statOf(b, "Annualised return")).toBe(`${w.projection!.annualisedReturnPct.toFixed(2)}%`);
    expect(tables(b)[0].rows).toHaveLength(12);
  });
  it.each([
    { target: 5000000, years: 8, debtPct: 6, equityPct: 12, mode: "appreciation", fixedAmount: 0, fixedPct: 0 },
    { target: 7500000, years: 10, debtPct: 7, equityPct: 13, mode: "fixedAmount", fixedAmount: 25000, fixedPct: 0 },
  ] as const)("stpRequiredForTarget equals the web module (%#)", (input) => {
    const w = webStp.stpRequiredForTarget(input);
    expect(appStp.stpRequiredForTarget(input)).toEqual(w);
    const b = run(DEFS.stpgoal, {
      target: input.target, years: input.years, debtPct: input.debtPct, equityPct: input.equityPct,
      transfer: input.mode === "appreciation" ? "appreciation" : "fixed", fixedBy: input.mode === "fixedAmount" ? "fixedAmount" : "fixedPct", amount: input.fixedAmount,
    });
    expect(statOf(b, "Initial investment required")).toBe(inr(w.initialRequired));
    expect(statOf(b, "Total value")).toBe(inr(w.projection!.totalFinalValue));
  });
});

describe("ppf — PPF Maturity", () => {
  it("prints the web's reference case to the rupee", () => {
    // ppf.ts: ₹1,50,000 a year for 15 years at 7.1% → ₹40,68,209.
    const b = run(DEFS.ppf);
    expect(statOf(b, "Maturity value (15 yrs)")).toBe("₹40,68,209");
    expect(statOf(b, "Total deposited")).toBe("₹22,50,000");
    expect(statOf(b, "Interest rate")).toBe("7.1%");
    expect(tables(b)[0].rows).toHaveLength(15);
  });
  it.each([
    { mode: "fixed", yearlyAmount: 100000, amounts: [], ratePct: 7.1, extensions: [{ withContributions: true }, { withContributions: false }] },
    { mode: "variable", yearlyAmount: 0, amounts: [150000, 200000, 300, 0, ...Array(31).fill(100000)], ratePct: 7.5, extensions: [{ withContributions: true }] },
  ] as const)("ppfCalc equals the web module (%#)", (input) => {
    const w = webPpf.ppfCalc(input as any);
    expect(appPpf.ppfCalc(input as any)).toEqual(w);
    const years: Record<string, any> = {};
    input.amounts.forEach((a, i) => { years[`y${i + 1}`] = a; });
    const b = run(DEFS.ppf, {
      mode: input.mode, yearly: input.yearlyAmount, rate: input.ratePct, extCount: String(input.extensions.length),
      ext1: input.extensions[0]?.withContributions, ext2: input.extensions[1]?.withContributions, ...years,
    });
    expect(statOf(b, `Maturity value (${w.years} yrs)`)).toBe(inr(w.maturity));
    expect(statOf(b, "At the end of the 15-year term")).toBe(inr(w.termMaturity));
    if (w.issues.length > 0) expect(texts(b, "insight")[0]).toContain(w.issues[0].message);
  });
  it("shows a year's deposit only while that year takes deposits", () => {
    const y20 = DEFS.ppf.inputs.find((i) => i.key === "y20")!;
    expect(y20.visibleIf!({ mode: "variable", extCount: "1", ext1: true })).toBe(true);
    expect(y20.visibleIf!({ mode: "variable", extCount: "1", ext1: false })).toBe(false);
    expect(y20.visibleIf!({ mode: "variable", extCount: "0", ext1: true })).toBe(false);
    expect(y20.visibleIf!({ mode: "fixed", extCount: "1", ext1: true })).toBe(false);
  });
});

describe("epf — EPF Corpus", () => {
  it("prints the web's default case", () => {
    const w = webEpf.epfCalc({ currentAge: 30, retirementAge: 58, monthlyWage: 40000, salaryIncreasePct: 6, employeePct: 12, employerPct: 3.67, employerMode: "fixed_share", currentBalance: 300000, ratePct: 8.25 });
    const b = run(DEFS.epf);
    expect(statOf(b, "Corpus at 58")).toBe(inr(w.corpus));
    expect(statOf(b, "Your contributions")).toBe(inr(w.totalEmployee));
    expect(statOf(b, "Employer's EPF share")).toBe(inr(w.totalEmployer));
    expect(statOf(b, "Interest earned")).toBe(inr(w.totalInterest));
    expect(tables(b)[0].rows).toHaveLength(28);
  });
  it("matches the module's hand check (₹10,000 basic, one year → ₹19,644)", () => {
    const b = run(DEFS.epf, { age: 30, retireAge: 31, wage: 10000, balance: 0 });
    const row = tables(b)[0].rows[0];
    expect(row[row.length - 1]).toBe("₹19,644");
    expect(statOf(b, "Corpus at 31")).toBe("₹19,644");
  });
  it.each([
    { currentAge: 25, retirementAge: 60, monthlyWage: 60000, salaryIncreasePct: 8, employeePct: 12, employerPct: 3.67, employerMode: "full_wage", currentBalance: 0, ratePct: 8.1 },
    { currentAge: 45, retirementAge: 58, monthlyWage: 14000, salaryIncreasePct: 5, employeePct: 15, employerPct: 3.67, employerMode: "fixed_share", currentBalance: 900000, ratePct: 8.25 },
  ] as const)("epfCalc equals the web module (%#)", (input) => {
    const w = webEpf.epfCalc(input);
    expect(appEpf.epfCalc(input)).toEqual(w);
    const b = run(DEFS.epf, {
      age: input.currentAge, retireAge: input.retirementAge, wage: input.monthlyWage, increase: input.salaryIncreasePct,
      employeePct: input.employeePct, employerPct: input.employerPct, employerMode: input.employerMode, balance: input.currentBalance, rate: input.ratePct,
    });
    expect(statOf(b, `Corpus at ${input.retirementAge}`)).toBe(inr(w.corpus));
    expect(texts(b, "insight").some((x) => x.includes("With an employer paying 12% on the full salary"))).toBe(input.employerMode === "full_wage");
  });
  it("says when retirement is not after the current age", () => {
    expect(texts(run(DEFS.epf, { age: 60 }), "insight")).toEqual(["Retirement age must be later than the current age."]);
  });
});
