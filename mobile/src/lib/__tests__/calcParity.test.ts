/**
 * The app's calculators and Goal Planning maths must give the CRM's answers for
 * the same inputs. Every expected value below was computed by running the WEB
 * libraries (src/lib/goal-planning/calc.ts, src/lib/calculators/*) after the
 * calculator-maths fix 1752943b (2026-11-02) and the goal-status rule 098b73eb;
 * the first block mirrors the asserts of the web's scripts/check-calc-math.ts.
 */

import {
  fvSip, fvLumpsum, requiredSip, requiredLumpsumToday, fvStepUpSip, requiredStepUpSip,
  inflatedTarget, computeGoal, goalTier, projectYearly, sensitivitySipRates,
} from "../../features/goals/calc";
import {
  growingSipSchedule, costOfDelay, retirementCorpus, swpDeplete, stpCalculate, cagrCalculate,
  monthsToTarget, fdVsEquity, rentVsBuy, btid, emergencyFund, computeEmiSip, computeCrashStress,
  computeFire, computeNps, requiredMonthlySip, isDueNow, computeChildEducation,
} from "../../features/calculators/calc";
import { calcByKey } from "../../features/calculators/registry";
import { inr } from "../format";

/** Equal to the web value to the paisa (expected values are rounded to 2 dp). */
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 1);

function expectNear(actual: Record<string, any>, expected: Record<string, any>) {
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === "number") {
      if (typeof actual[k] !== "number") throw new Error(`${k}: expected a number, got ${actual[k]}`);
      near(actual[k], v);
    } else expect({ [k]: actual[k] }).toEqual({ [k]: v });
  }
}

describe("check-calc-math mirror (web scripts/check-calc-math.ts)", () => {
  it("flat-return (0%) limits are finite, not NaN", () => {
    expect(fvSip(10000, 0, 120)).toBe(1_200_000);
    expect(requiredSip(1_200_000, 0, 0, 120)).toBe(10_000);
    let flat = 0;
    for (let k = 0; k < 10; k++) flat += 10000 * Math.pow(1.1, k) * 12;
    near(fvStepUpSip(10000, 0, 120, 10), flat);
    expect(Number.isFinite(requiredStepUpSip(1_000_000, 0, 0, 120, 10))).toBe(true);
    expect(Number.isFinite(computeGoal({ futureTarget: 5_000_000, currentValue: 0, existingMonthlySip: 0, monthsLeft: 120, expectedReturnPct: 0 }).requiredMonthlySipTotal)).toBe(true);
    expect(Number.isFinite(retirementCorpus({ currentAge: 30, retirementAge: 60, lifeExpectancy: 85, monthlyIncomeTodayInr: 50000, inflationPct: 6, preReturnPct: 0, postReturnPct: 0, existingFundInr: 0 }).monthlySavingsRequired)).toBe(true);
  });
  it("known-good values @ 12%", () => {
    near(fvSip(10000, 12, 120), 2323390.76);
    near(fvLumpsum(100000, 12, 120), 330038.69);
    expect(fvStepUpSip(10000, 12, 120, 10)).toBeGreaterThan(fvSip(10000, 12, 120));
  });
  it("requiredSip → fvSip round-trips", () => {
    const req = requiredSip(5_000_000, 0, 12, 120);
    near(req, 21520.27);
    near(fvSip(req, 12, 120), 5_000_000);
  });
  it("CAGR", () => {
    expect(cagrCalculate({ initialValue: 100, finalValue: 200, years: 10 }).cagrPct).toBeCloseTo(7.177, 2);
    expect(cagrCalculate({ initialValue: 0, finalValue: 200, years: 10 }).cagrPct).toBe(0);
    expectNear(cagrCalculate({ initialValue: 100000, finalValue: 250000, years: 5 }), { cagrPct: 20.11, absoluteReturnPct: 150 });
  });
});

describe("Goal Planning (web src/lib/goal-planning/calc.ts)", () => {
  it("core formulas", () => {
    near(fvStepUpSip(10000, 12, 120, 10), 3374326.26);
    near(requiredStepUpSip(5000000, 200000, 12, 120, 10), 12861.52);
    near(requiredLumpsumToday(5000000, 12, 120), 1514973.9);
    near(inflatedTarget(100000, 6, 15), 239655.82);
  });

  it("computeGoal — present target inflated, SIP and lumpsum needed", () => {
    expectNear(computeGoal({ presentTarget: 2500000, currentValue: 0, existingMonthlySip: 0, monthsLeft: 120, expectedReturnPct: 12, inflationPct: 6 }), {
      futureTarget: 4477119.24, projectedTotalFV: 0, requiredMonthlySipTotal: 19269.76, requiredStepUpInitialSip: 19269.76,
      requiredLumpsumToday: 1356543.76, additionalMonthlySipNeeded: 19269.76, gapAmount: 4477119.24, projectedPct: 0,
      tier: "off_track", status: "not_started",
    });
    expectNear(computeGoal({ presentTarget: 5000000, currentValue: 300000, existingMonthlySip: 10000, monthsLeft: 180, expectedReturnPct: 11, inflationPct: 7, stepUpPct: 10 }), {
      futureTarget: 13795157.7, projectedTotalFV: 6138971.96, requiredMonthlySipTotal: 26685.32, requiredStepUpInitialSip: 15249.31,
      requiredLumpsumToday: 2669347.98, additionalMonthlySipNeeded: 16685.32, gapAmount: 7656185.75, projectedPct: 44.5,
      tier: "off_track", status: "behind_track",
    });
  });

  it("Achieved means the money is there; a projection that clears the target is On track (098b73eb)", () => {
    // Was "achieved" in the app: ₹10 L linked + SIP projects past ₹1 Cr in 25 years.
    expectNear(computeGoal({ futureTarget: 10000000, currentValue: 1000000, existingMonthlySip: 20000, monthsLeft: 300, expectedReturnPct: 12 }), {
      projectedTotalFV: 57741168.11, projectedPct: 577.41, gapAmount: 0, tier: "on_track", status: "on_track",
    });
    expectNear(computeGoal({ futureTarget: 1000000, currentValue: 1200000, existingMonthlySip: 0, monthsLeft: 60, expectedReturnPct: 12 }), {
      projectedPct: 218, tier: "achieved", status: "achieved",
    });
    // Was "on_track" in the app (SIP ≥ 90% of the required one) — projected short, so Behind.
    expectNear(computeGoal({ futureTarget: 5000000, currentValue: 500000, existingMonthlySip: 13000, monthsLeft: 120, expectedReturnPct: 12 }), {
      projectedTotalFV: 4670601.44, projectedPct: 93.41, requiredMonthlySipTotal: 14417.75, additionalMonthlySipNeeded: 1417.75,
      gapAmount: 329398.56, tier: "behind", status: "behind_track",
    });
    expectNear(computeGoal({ futureTarget: 5000000, currentValue: 100000, existingMonthlySip: 5000, monthsLeft: 120, expectedReturnPct: 12 }), {
      projectedPct: 29.83, tier: "off_track", status: "behind_track",
    });
    expectNear(computeGoal({ futureTarget: 500000, currentValue: 200000, existingMonthlySip: 5000, monthsLeft: 0 }), {
      requiredMonthlySipTotal: 0, requiredLumpsumToday: 500000, gapAmount: 300000, projectedPct: 40, tier: "off_track", status: "behind_track",
    });
    expect(goalTier(80, 80, 100)).toBe("behind");
    expect(goalTier(0, 74.9, 100)).toBe("off_track");
  });

  it("projectYearly — unrounded, part year last", () => {
    const rows = projectYearly({ currentValue: 100000, initialMonthlySip: 10000, annualReturnPct: 12, stepUpPct: 10, months: 30 });
    expect(rows).toHaveLength(3);
    expectNear(rows[0], { year: 1, monthlySip: 10000, contributedThisYear: 120000, cumulativeContributed: 120000, endOfYearCorpus: 239507.53 });
    expectNear(rows[1], { year: 2, monthlySip: 11000, contributedThisYear: 132000, cumulativeContributed: 252000, endOfYearCorpus: 409390.62 });
    expectNear(rows[2], { year: 3, monthlySip: 12100, contributedThisYear: 72600, cumulativeContributed: 324600, endOfYearCorpus: 509015.77 });
  });

  it("sensitivitySipRates", () => {
    const rows = sensitivitySipRates(5000000, 200000, 120);
    const expected = [
      { ratePct: 8, sip: 24738.99, lumpsum: 2252617.3, projectedFV: 443928.05 },
      { ratePct: 10, sip: 21585.81, lumpsum: 1847034.86, projectedFV: 541408.3 },
      { ratePct: 12, sip: 18679.26, lumpsum: 1514973.9, projectedFV: 660077.38 },
      { ratePct: 15, sip: 14756.33, lumpsum: 1126072.05, projectedFV: 888042.65 },
    ];
    expected.forEach((e, i) => expectNear(rows[i], e));
  });
});

describe("Calculators (web src/lib/calculators/* and goal-planning)", () => {
  it("Step-up SIP, Cost of Delay, SWP, Crorepati, FD vs Equity (unchanged on the web)", () => {
    const s = growingSipSchedule({ monthlySip: 10000, annualReturnPct: 12, annualGrowthPct: 10, years: 15 });
    near(s.regular[14].fv, 4759313.99);
    near(s.growing[14].fv, 8274717.9);
    const d = costOfDelay({ sipAmount: 10000, returnPct: 12, startAgeNow: 30, startAgeLater: 35, endAge: 60 });
    near(d.now.finalValue, 35299137.74);
    near(d.costOfDelay, 16322786.82);
    expectNear(swpDeplete({ corpusInr: 5000000, monthlyWithdrawalInr: 30000, returnPct: 8, years: 20 }), { totalWithdrawn: 7200000, finalValue: 6845597.3, monthsBeforeDepletion: null });
    expectNear(swpDeplete({ corpusInr: 2000000, monthlyWithdrawalInr: 30000, returnPct: 8, years: 20 }), { totalWithdrawn: 2630011.88, finalValue: 0, monthsBeforeDepletion: 88 });
    expect(monthsToTarget({ monthlySip: 25000, lumpsum: 0, annualReturnPct: 12, target: 10000000 })).toBe(161);
    expectNear(fdVsEquity({ lumpsum: 1000000, monthlySip: 0, years: 10, fdRatePct: 6.5, equityRatePct: 12 }), { fd: 1912183.75, eq: 3300386.89, gap: 1388203.14 });
    expectNear(emergencyFund({ monthlyExpense: 60000, monthsBuffer: 6, existing: 0, buildMonths: 12, parkReturnPct: 6 }), { target: 360000, gap: 360000, requiredSip: 29038.72 });
    expectNear(computeFire({ currentAge: 32, monthlyExpenseNow: 80000, inflationPct: 6, preReturnPct: 12, postReturnPct: 7, currentCorpus: 1000000, monthlySip: 50000, sipStepUpPct: 0, swrPct: 4, lifeExpectancy: 85 }), {
      fireNumberToday: 24000000, fireAge: 58, fireCorpus: 109185191.11, corpusAtFire: 115001965.13, yearsToFire: 26, sustainsToLifeExpectancy: true, shortfallAge: null,
    });
  });

  it("Retirement — effective monthly inflation after retirement (1752943b)", () => {
    // The app said ₹6,80,29,454 here (6%/12 compounds to 6.17% a year).
    expectNear(retirementCorpus({ currentAge: 35, retirementAge: 60, lifeExpectancy: 85, monthlyIncomeTodayInr: 60000, inflationPct: 6, preReturnPct: 12, postReturnPct: 7, existingFundInr: 0 }), {
      preRetirementYears: 25, distributionYears: 25, monthlyIncomeAtRetirement: 257512.24, corpusRequired: 66761071.65, fvOfExistingFund: 0, monthlySavingsRequired: 35181.2,
    });
    expectNear(retirementCorpus({ currentAge: 45, retirementAge: 58, lifeExpectancy: 90, monthlyIncomeTodayInr: 100000, inflationPct: 7, preReturnPct: 11, postReturnPct: 8, existingFundInr: 5000000 }), {
      monthlyIncomeAtRetirement: 240984.5, corpusRequired: 76285192.17, fvOfExistingFund: 20757830.02, monthlySavingsRequired: 160040.23,
    });
    expectNear(retirementCorpus({ currentAge: 30, retirementAge: 60, lifeExpectancy: 85, monthlyIncomeTodayInr: 50000, inflationPct: 6, preReturnPct: 0, postReturnPct: 0, existingFundInr: 0 }), {
      corpusRequired: 194212984.2, monthlySavingsRequired: 539480.51,
    });
  });

  it("STP — a loss is a negative gain, never ₹0 (1752943b)", () => {
    expectNear(stpCalculate({ lumpsum: 1000000, transferAmount: 50000, sourceReturnPct: 6, targetReturnPct: -10, years: 2 }), { totalFinalValue: 935799.87, gain: -64200.13 });
    expectNear(stpCalculate({ lumpsum: 1000000, transferAmount: 50000, sourceReturnPct: 6, targetReturnPct: 12, years: 3 }), { totalFinalValue: 1363300.07, gain: 363300.07 });
  });

  it("Rent vs Buy — the owner invests once rent overtakes the EMI (1752943b)", () => {
    expectNear(rentVsBuy({ homePrice: 10000000, downPaymentPct: 20, loanRatePct: 8.5, loanYears: 20, homeAppreciationPct: 7, maintenancePctPerYear: 1, monthlyRent: 30000, rentInflationPct: 7, equityReturnPct: 12, horizonYears: 15 }), {
      emi: 69425.86, homeValue: 27590315.41, outstanding: 3383898.46, buyNetWorth: 24206416.95, rentNetWorth: 29166583.36, winner: "rent",
    });
    // The app said ₹3,43,34,966 for BUY here (owner's post-loan savings ignored).
    expectNear(rentVsBuy({ homePrice: 8000000, downPaymentPct: 25, loanRatePct: 9, loanYears: 10, homeAppreciationPct: 6, maintenancePctPerYear: 1, monthlyRent: 25000, rentInflationPct: 8, equityReturnPct: 12, horizonYears: 25 }), {
      emi: 76005.46, homeValue: 34334965.76, outstanding: 0, buyNetWorth: 72281865.87, rentNetWorth: 107261737.18, winner: "rent",
    });
  });

  it("Term + MF vs ULIP — compared after LTCG (1752943b)", () => {
    // The app said ₹29,60,120 more (pre-tax).
    expectNear(btid({ annualBudget: 100000, termAnnualPremium: 15000, termCover: 10000000, years: 20, mfReturnPct: 12, tradReturnPct: 6 }), {
      investable: 85000, btidCorpus: 6859392.52, tradCorpus: 3899272.67, btidTax: 629299.07, tradTax: 0,
      btidPostTax: 6230093.46, tradPostTax: 3899272.67, ulipTaxFree: true, wealthGap: 2330820.79, coverGap: 9000000,
    });
    expectNear(btid({ annualBudget: 300000, termAnnualPremium: 20000, termCover: 20000000, years: 15, mfReturnPct: 12, tradReturnPct: 8 }), {
      btidTax: 920739.81, tradTax: 521535.61, btidPostTax: 10770178.7, tradPostTax: 8275749.3, ulipTaxFree: false, wealthGap: 2494429.4, coverGap: 17000000,
    });
  });

  it("EMI → SIP — the reference case, and no tenure repays nothing (1752943b)", () => {
    expectNear(computeEmiSip({ mode: "loan", loanAmount: 2500000, interestRatePct: 9, emiAmount: 0, tenureMonths: 180, sipReturnPct: 12 }), {
      monthlyEmi: 25356.66, principalRepayment: 2500000, interestRepayment: 2064199.63, totalRepayment: 4564199.63, monthlySipRequired: 9590.04, sipAsPctOfEmi: 37.82,
    });
    expectNear(computeEmiSip({ mode: "loan", loanAmount: 3000000, interestRatePct: 8.5, emiAmount: 0, tenureMonths: 240, sipReturnPct: 12 }), {
      monthlyEmi: 26034.7, totalRepayment: 6248327.28, monthlySipRequired: 6792.71, sipAsPctOfEmi: 26.09,
    });
    expectNear(computeEmiSip({ mode: "loan", loanAmount: 3000000, interestRatePct: 8.5, emiAmount: 0, tenureMonths: 0, sipReturnPct: 12 }), {
      monthlyEmi: 0, principalRepayment: 0, interestRepayment: 0, totalRepayment: 0, monthlySipRequired: 0,
    });
  });

  it("Market crash — recovery is the market's (unit NAV), the fall is capped at 100% (1752943b)", () => {
    // The app said 15 months (the corpus topped up by new SIPs, not the market).
    expectNear(computeCrashStress({ monthlySip: 20000, lumpsum: 0, years: 15, expectedReturnPct: 12, crashYear: 5, crashPct: 30, fdRatePct: 6 }), {
      totalInvested: 3600000, finalStay: 8007254.93, finalNoCrash: 9518627.98, finalPanic: 5298704.85, costOfPanic: 2708550.08,
      crashDropAmount: 486621.68, crashInHorizon: true, recoveryMonths: 38, gapToNoCrash: 1511373.06,
    });
    expectNear(computeCrashStress({ monthlySip: 10000, lumpsum: 1000000, years: 10, expectedReturnPct: 12, crashYear: 3, crashPct: 40, fdRatePct: 6 }), {
      finalStay: 3722929.65, finalPanic: 2695852.2, costOfPanic: 1027077.45, crashDropAmount: 734288.28, recoveryMonths: 55, gapToNoCrash: 1623277.45,
    });
    expectNear(computeCrashStress({ monthlySip: 20000, lumpsum: 0, years: 15, expectedReturnPct: 12, crashYear: 20, crashPct: 30, fdRatePct: 6 }), {
      finalStay: 9518627.98, costOfPanic: 0, crashInHorizon: false, recoveryMonths: null, gapToNoCrash: 0,
    });
    expectNear(computeCrashStress({ monthlySip: 20000, lumpsum: 0, years: 15, expectedReturnPct: 12, crashYear: 5, crashPct: 120, fdRatePct: 6 }), {
      finalStay: 4480717.79, finalPanic: 3265285.8, costOfPanic: 1215431.99, crashDropAmount: 1622072.25, recoveryMonths: null, gapToNoCrash: 5037910.19,
    });
  });

  it("NPS — 80CCD(1B) on the year's own contribution, with cess; annuity share clamped (1752943b)", () => {
    // The app said ₹15,000 (flat ₹50k × slab, no cess).
    expectNear(computeNps({ currentAge: 30, retirementAge: 60, monthlyContribution: 5000, annualStepUpPct: 0, expectedReturnPct: 10, existingCorpus: 0, annuityPortionPct: 40, annuityRatePct: 6, taxSlabPct: 30 }), {
      years: 30, annuityPortionPct: 40, corpus: 10396463.58, totalContributed: 1800000, lumpSum: 6237878.15, annuityCorpus: 4158585.43, monthlyPension: 20792.93, annual80CCD1BBenefit: 15600,
    });
    expectNear(computeNps({ currentAge: 40, retirementAge: 60, monthlyContribution: 3000, annualStepUpPct: 5, expectedReturnPct: 10, existingCorpus: 200000, annuityPortionPct: 20, annuityRatePct: 6, taxSlabPct: 20 }), {
      years: 20, annuityPortionPct: 40, corpus: 4435506.15, totalContributed: 1190374.35, lumpSum: 2661303.69, monthlyPension: 8871.01, annual80CCD1BBenefit: 7488,
    });
  });

  it("Child education — a goal due now needs a lumpsum, never the whole cost as a monthly SIP (1752943b)", () => {
    expect(requiredMonthlySip(2000000, 12, 0)).toBe(0);
    expect(requiredMonthlySip(2000000, 12, 0.02)).toBe(0);
    near(requiredMonthlySip(2000000, 12, 15), 4202.29);
    expect(isDueNow(0.02)).toBe(true);
    expect(isDueNow(0.05)).toBe(false);
    expectNear(computeChildEducation({ childCurrentAge: 3, eduInflationPct: 10, expectedReturnPct: 12, existingSavings: 0, milestones: [{ name: "Education", childAgeAtStart: 18, currentCost: 2000000 }] }), {
      totalFutureCost: 8354496.34, totalMonthlySip: 17553.99, totalLumpsum: 1526335.25, existingSavingsFutureValue: 0, netAfterSavings: 8354496.34,
    });
    // The app said ₹15,00,000 a month here.
    expectNear(computeChildEducation({ childCurrentAge: 18, eduInflationPct: 10, expectedReturnPct: 12, existingSavings: 500000, milestones: [{ name: "Education", childAgeAtStart: 18, currentCost: 2000000 }] }), {
      totalFutureCost: 2000000, totalMonthlySip: 0, totalLumpsum: 1500000, netAfterSavings: 1500000,
    });
    expectNear(computeChildEducation({ childCurrentAge: 5, eduInflationPct: 10, expectedReturnPct: 12, existingSavings: 300000, milestones: [{ name: "PG", childAgeAtStart: 22, currentCost: 3000000 }, { name: "UG", childAgeAtStart: 18, currentCost: 2000000 }] }), {
      totalFutureCost: 22067953.28, totalMonthlySip: 39934.63, totalLumpsum: 3490807.9, existingSavingsFutureValue: 1309047.93, netAfterSavings: 20758905.35,
    });
  });
});

describe("Calculator screens show the CRM's figures (registry defaults)", () => {
  const run = (key: string, over: Record<string, number> = {}): any[] => {
    const def = calcByKey(key)!;
    const v: Record<string, any> = Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
    return def.compute({ ...v, ...over });
  };
  const stat = (blocks: any[], label: string) => blocks.find((b) => b.type === "stat" && b.label.startsWith(label))?.value;
  const money = (n: number) => inr(Math.round(n));

  it("Retirement", () => {
    const b = run("retirement");
    expect(stat(b, "Corpus needed at retirement")).toBe(money(66761071.65));
    expect(stat(b, "Monthly SIP from now")).toBe(money(35181.2));
    expect(stat(run("retirement", { currentAge: 60 }), "Monthly SIP from now")).toBe("—");
  });
  it("Term + MF vs ULIP shows the post-tax corpora", () => {
    const b = run("btid");
    expect(stat(b, "Term + MF corpus (post-tax)")).toBe(money(6230093.46));
    expect(stat(b, "ULIP/endowment corpus")).toBe(money(3899272.67));
    expect(stat(b, "Extra wealth")).toBe(money(2330820.79));
  });
  it("Rent vs Buy, EMI → SIP, NPS, Market crash", () => {
    const rb = run("rent-buy");
    expect(stat(rb, "Net worth if you BUY")).toBe(money(24206416.95));
    expect(stat(rb, "Net worth if you RENT")).toBe(money(29166583.36));
    expect(stat(run("emi-sip"), "SIP to reach the same total")).toBe(money(6792.71));
    const n = run("nps");
    expect(stat(n, "Corpus at retirement")).toBe(money(10396463.58));
    expect(n.find((x: any) => x.type === "insight")?.text).toContain(money(15600));
    const c = run("crash");
    expect(stat(c, "If you STAY invested")).toBe(money(8007254.93));
    expect(stat(c, "Cost of panic")).toBe(money(2708550.08));
    expect(run("crash", { crashYear: 20 }).find((x: any) => x.type === "insight")?.text).toContain("outside");
  });
  it("Goal, Child education and CAGR never show ₹0 for a SIP that cannot exist", () => {
    const g = run("goal");
    expect(stat(g, "Monthly SIP needed")).toBe(money(19269.76));
    expect(stat(run("goal", { years: 0 }), "Monthly SIP needed")).toBe("—");
    expect(stat(run("child-education"), "Monthly SIP needed")).toBe(money(17553.99));
    expect(stat(run("child-education", { childAge: 18, goalAge: 18 }), "Monthly SIP needed")).toBe("Due now — lumpsum");
    expect(stat(run("cagr", { initial: 0 }), "CAGR")).toBe("—");
  });
});
