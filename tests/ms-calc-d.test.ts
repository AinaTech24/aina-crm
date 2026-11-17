/**
 * MasterStroke parity — package d. Every case-study figure in specs
 * 2, 4, 5, 6, 7, 16, 17, 19, 28, 29, 31, 33, 52 and 53, asserted to the rupee
 * (Math.round equality, or the rounding the reference prints).
 */

import { describe, expect, it } from "vitest";
import { capitalGainsBondVsOthers } from "@/lib/calculators/capital-gains-bond";
import { termPlusSip, termPlusSipGoal, insuranceVsTermSip } from "@/lib/calculators/term-plus-sip";
import { retirementNeed } from "@/lib/calculators/retirement-need";
import { portfolioProjection } from "@/lib/calculators/portfolio-projection";
import { computeCapitalGains } from "@/lib/calculators/capital-gains";
import { computeChildEducation } from "@/lib/calculators/child-education";
import { computeIncomeReplacement } from "@/lib/calculators/hlv";
import { computeInsuranceIrr } from "@/lib/calculators/insurance-irr";
import { computePropertyYield } from "@/lib/calculators/property-yield";
import { computeSalaryWealth } from "@/lib/calculators/salary-wealth";
import { computeAnnualLumpsumRequired } from "@/lib/calculators/annual-lumpsum-required";
import { computeFvAnnualLumpsum } from "@/lib/calculators/fv-annual-lumpsum";

const R = Math.round;
/** "4,14,911" → 414911 */
const n = (s: string) => Number(s.replace(/,/g, ""));
const list = (s: string) => s.split("·").map((x) => n(x.trim()));

describe("#4 Capital gains bond (54EC) vs other investment", () => {
  const cols = capitalGainsBondVsOthers({
    gain: 5_000_000,
    ltcgRatePct: 12.5,
    years: 5,
    bondRatePct: 5.25,
    slabPct: 30,
    indexationPct: 0,
    options: [
      { name: "Fixed Deposit", ratePct: 6, taxRatePct: 30, indexation: false },
      { name: "Debt Fund", ratePct: 7, taxRatePct: 30, indexation: false },
      { name: "Equity Fund", ratePct: 12, taxRatePct: 12.5, indexation: false },
    ],
  });
  const want = [
    { ltcg: 0, net: 5000000, mat: 6457740, idx: 5000000, taxable: 1457740, tax: 437322, post: 6020418, irr: "3.78" },
    { ltcg: 625000, net: 4375000, mat: 5854737, idx: 4375000, taxable: 1479737, tax: 443921, post: 5410816, irr: "1.59" },
    { ltcg: 625000, net: 4375000, mat: 6136164, idx: 4375000, taxable: 1761164, tax: 528349, post: 5607815, irr: "2.32" },
    { ltcg: 625000, net: 4375000, mat: 7710245, idx: 4375000, taxable: 3335245, tax: 416906, post: 7293339, irr: "7.84" },
  ];
  it("every column matches", () => {
    expect(cols).toHaveLength(4);
    cols.forEach((c, i) => {
      const w = want[i];
      expect(R(c.gain)).toBe(5000000);
      expect(R(c.ltcgTax)).toBe(w.ltcg);
      expect(R(c.netInvestment)).toBe(w.net);
      expect(R(c.maturity)).toBe(w.mat);
      expect(c.indexationPct).toBe(0);
      expect(R(c.indexedCost)).toBe(w.idx);
      expect(R(c.taxableIncome)).toBe(w.taxable);
      expect(R(c.tax)).toBe(w.tax);
      expect(R(c.postTaxMaturity)).toBe(w.post);
      expect(c.postTaxIrrPct!.toFixed(2)).toBe(w.irr);
    });
    expect(cols.map((c) => c.taxRatePct)).toEqual([30, 30, 30, 12.5]);
  });
  it("equity exemption is an opt-in deviation", () => {
    const [, , , eq] = capitalGainsBondVsOthers({
      gain: 5_000_000, ltcgRatePct: 12.5, years: 5, bondRatePct: 5.25, slabPct: 30, indexationPct: 0,
      options: [
        { name: "a", ratePct: 6, taxRatePct: 30, indexation: false },
        { name: "b", ratePct: 7, taxRatePct: 30, indexation: false },
        { name: "Equity", ratePct: 12, taxRatePct: 12.5, indexation: false, exemption: 100000 },
      ],
    });
    expect(R(eq.tax)).toBe(404406);
  });
});

describe("#52 Term insurance + SIP (from a budget)", () => {
  const r = termPlusSip({ age: 30, annualOutlay: 400000, sumAssured: 10_000_000, termYears: 30, premium: 10000, returnPct: 12 });
  const values = list(
    "4,14,911 · 8,79,612 · 14,00,076 · 19,82,997 · 26,35,867 · 33,67,083 · 41,86,044 · 51,03,280 · 61,30,585 · 72,81,166 · 85,69,818 · 1,00,13,107 · 1,16,29,591 · 1,34,40,053 · 1,54,67,770 · 1,77,38,814 · 2,02,82,383 · 2,31,31,180 · 2,63,21,833 · 2,98,95,364 · 3,38,97,719 · 3,83,80,356 · 4,34,00,910 · 4,90,23,931 · 5,53,21,714 · 6,23,75,230 · 7,02,75,169 · 7,91,23,101 · 8,90,32,784 · 10,01,31,629"
  );
  it("headline", () => {
    expect(r.balanceForSip).toBe(390000);
    expect(r.sipMonthly).toBe(32500);
    expect(R(r.finalValue)).toBe(100131629);
    expect(r.finalAge).toBe(60);
  });
  it("all 30 rows", () => {
    expect(r.rows.map((x) => R(x.sipValue))).toEqual(values);
    expect(r.rows.map((x) => x.age)).toEqual(Array.from({ length: 30 }, (_, i) => 31 + i));
    expect(R(r.rows[0].payout)).toBe(10414911);
    expect(R(r.rows[29].payout)).toBe(110131629);
    r.rows.forEach((x) => {
      expect(x.cover).toBe(10_000_000);
      expect(x.annualOutlay).toBe(400000);
      expect(R(x.payout)).toBe(10_000_000 + R(x.sipValue));
    });
  });
});

describe("#53 Term insurance + SIP (need based)", () => {
  const r = termPlusSipGoal({ age: 30, goal: 10_000_000, termYears: 30, premium: 10000, returnPct: 12 });
  const values = list(
    "41,437 · 87,846 · 1,39,824 · 1,98,039 · 2,63,240 · 3,36,266 · 4,18,054 · 5,09,657 · 6,12,253 · 7,27,159 · 8,55,855 · 9,99,994 · 11,61,430 · 13,42,239 · 15,44,744 · 17,71,550 · 20,25,572 · 23,10,077 · 26,28,723 · 29,85,606 · 33,85,316 · 38,32,990 · 43,34,386 · 48,95,949 · 55,24,899 · 62,29,323 · 70,18,279 · 79,01,909 · 88,91,574 · 1,00,00,000"
  );
  it("SIP and annual investment", () => {
    expect(R(r.sipMonthly)).toBe(3246);
    expect(r.sipMonthly).toBeCloseTo(3245.7277, 3);
    expect(R(r.annualOutlay)).toBe(48949);
  });
  it("all 30 rows, unrounded SIP", () => {
    expect(r.rows.map((x) => R(x.sipValue))).toEqual(values);
    expect(R(r.rows[0].payout)).toBe(10041437);
    expect(R(r.rows[29].payout)).toBe(20000000);
    r.rows.forEach((x) => expect(R(x.payout)).toBe(10_000_000 + R(x.sipValue)));
  });
});

describe("#19 Insurance vs term cover with SIP", () => {
  const r = insuranceVsTermSip({ premium: 500000, sumAssured: 5_000_000, years: 20, termPremium: 15000, sipRatePct: 12, insuranceRatePct: 7 });
  it("matches", () => {
    expect(R(r.maturity)).toBe(21932588);
    expect(R(r.monthlySip)).toBe(40417);
    expect(R(r.fundValue)).toBe(37177568);
  });
});

describe("#31 Retirement need based", () => {
  const r = retirementNeed({
    currentAge: 32, retirementAge: 55, monthlyExpense: 40000, inflPrePct: 6, inflPostPct: 5,
    scenarios: [{ accPct: 12, distPct: 8 }], currentInvestment: 200000, currentInvestmentPct: 7.5,
    receivable: 5_000_000, annuityEndAge: 85, endBalance: 10_000_000,
  });
  const s = r.scenarios[0];
  it("headline figures", () => {
    expect(R(r.expenseAtRetirement)).toBe(152790);
    expect(R(s.corpus)).toBe(38167725);
    expect(R(r.fvCurrent)).toBe(1055418);
    expect(R(s.gap)).toBe(32112306);
    expect(R(s.sipTillRetirement)).toBe(24047);
    expect(R(s.sip5y!)).toBe(51488);
    expect(R(s.sip10y!)).toBe(32849);
    expect(R(s.lumpsum)).toBe(2369501);
  });
  it("annuity table, all 60 cells", () => {
    const table =
      "56: 1,56,261 / 3,92,66,323 · 57: 1,64,074 / 4,03,55,068 · 58: 1,72,277 / 4,14,28,285 · 59: 1,80,891 / 4,24,79,600 · 60: 1,89,936 / 4,35,01,872 · 61: 1,99,432 / 4,44,87,122 · 62: 2,09,404 / 4,54,26,446 · 63: 2,19,874 / 4,63,09,934 · 64: 2,30,868 / 4,71,26,570 · 65: 2,42,411 / 4,78,64,129 · 66: 2,54,532 / 4,85,09,064 · 67: 2,67,259 / 4,90,46,384 · 68: 2,80,622 / 4,94,59,519 · 69: 2,94,653 / 4,97,30,177 · 70: 3,09,385 / 4,98,38,182 · 71: 3,24,855 / 4,97,61,307 · 72: 3,41,097 / 4,94,75,085 · 73: 3,58,152 / 4,89,52,610 · 74: 3,76,060 / 4,81,64,312 · 75: 3,94,863 / 4,70,77,725 · 76: 4,14,606 / 4,56,57,225 · 77: 4,35,336 / 4,38,63,748 · 78: 4,57,103 / 4,16,54,491 · 79: 4,79,958 / 3,89,82,575 · 80: 5,03,956 / 3,57,96,692 · 81: 5,29,154 / 3,20,40,715 · 82: 5,55,611 / 2,76,53,273 · 83: 5,83,392 / 2,25,67,301 · 84: 6,12,562 / 1,67,09,540 · 85: 6,43,190 / 1,00,00,000";
    const want = table.split("·").map((cell) => {
      const [age, rest] = cell.split(":");
      const [a, b] = rest.split("/");
      return { age: Number(age.trim()), avg: n(a.trim()), bal: n(b.trim()) };
    });
    expect(s.rows.map((x) => ({ age: x.age, avg: R(x.avgMonthlyAnnuity), bal: R(x.balanceEoy) }))).toEqual(want);
  });
});

describe("#28 Portfolio projection", () => {
  const r = portfolioProjection({
    portfolioValue: 2_500_000, annualLumpsum: 200000, annualLumpsumIncrease: 50000,
    monthlySip: 25000, sipIncrease: 5000, ratePct: 12, years: 20, mode: "incremental",
  });
  const inc = r.incremental!;
  it("summary matrix", () => {
    expect(R(r.current.components.portfolio)).toBe(24115733);
    expect(R(r.current.components.annualLumpsum)).toBe(16139747);
    expect(R(r.current.components.sip)).toBe(22996434);
    expect(R(r.current.components.total)).toBe(63251914);
    expect(R(inc.components.portfolio)).toBe(24115733);
    expect(R(inc.components.annualLumpsum)).toBe(20174684);
    expect(R(inc.components.sip)).toBe(55284362);
    expect(R(inc.components.total)).toBe(99574779);
    expect(R(r.current.totalInvested)).toBe(12_500_000);
    expect(R(inc.totalInvested)).toBe(26_100_000);
    expect(R(r.extraInvested)).toBe(13_600_000);
    expect(R(r.extraValue)).toBe(36322865);
  });
  it("year table, both scenarios", () => {
    const table = `
 1  30,00,000  30,00,000    33,43,162 | 31,10,000    31,10,000    34,62,995
 2   5,00,000  35,00,000    42,87,504 |  6,70,000    37,80,000    46,05,382
 3   5,00,000  40,00,000    53,45,167 |  7,30,000    45,10,000    59,48,687
 4   5,00,000  45,00,000    65,29,750 |  7,90,000    53,00,000    75,17,022
 5   5,00,000  50,00,000    78,56,482 |  8,50,000    61,50,000    93,37,390
 6   5,00,000  55,00,000    93,42,423 |  9,10,000    70,60,000  1,14,40,034
 7   5,00,000  60,00,000  1,10,06,676 |  9,70,000    80,30,000  1,38,58,828
 8   5,00,000  65,00,000  1,28,70,639 | 10,30,000    90,60,000  1,66,31,710
 9   5,00,000  70,00,000  1,49,58,279 | 10,90,000  1,01,50,000  1,98,01,170
10   5,00,000  75,00,000  1,72,96,434 | 11,50,000  1,13,00,000  2,34,14,798
11   5,00,000  80,00,000  1,99,15,169 | 12,10,000  1,25,10,000  2,75,25,893
12   5,00,000  85,00,000  2,28,48,152 | 12,70,000  1,37,80,000  3,21,94,153
13   5,00,000  90,00,000  2,61,33,092 | 13,30,000  1,51,10,000  3,74,86,436
14   5,00,000  95,00,000  2,98,12,226 | 13,90,000  1,65,00,000  4,34,77,625
15   5,00,000 1,00,00,000 3,39,32,855 | 14,50,000  1,79,50,000  5,02,51,590
16   5,00,000 1,05,00,000 3,85,47,961 | 15,10,000  1,94,60,000  5,79,02,263
17   5,00,000 1,10,00,000 4,37,16,878 | 15,70,000  2,10,30,000  6,65,34,850
18   5,00,000 1,15,00,000 4,95,06,066 | 16,30,000  2,26,60,000  7,62,67,179
19   5,00,000 1,20,00,000 5,59,89,957 | 16,90,000  2,43,50,000  8,72,31,220
20   5,00,000 1,25,00,000 6,32,51,914 | 17,50,000  2,61,00,000  9,95,74,779`;
    const rows = table.trim().split("\n").map((l) => l.replace("|", " ").trim().split(/\s+/).map(n));
    rows.forEach(([y, a1, c1, f1, a2, c2, f2], i) => {
      const cur = r.current.rows[i];
      const nx = inc.rows[i];
      expect(cur.year).toBe(y);
      expect([R(cur.annualInvestment), R(cur.cumulativeInvestment), R(cur.fundValue)]).toEqual([a1, c1, f1]);
      expect([R(nx.annualInvestment), R(nx.cumulativeInvestment), R(nx.fundValue)]).toEqual([a2, c2, f2]);
    });
  });
});

describe("#5 Capital gains tax (fixed: no cess by default, combined indexed cost)", () => {
  const base = {
    acquisitionBasis: "after_2001" as const, assetType: "immovable" as const,
    purchasePrice: 1_500_000, purchaseDate: "2004-06-15", fmv2001: 0,
    improvements: [{ fyStartYear: 2008, cost: 500_000 }],
    salePrice: 7_000_000, salesExpenses: 100_000, saleDate: "2022-11-01",
    expectedSaleCII: 331, incomeTaxSlabPct: 30,
  };
  const r = computeCapitalGains(base);
  it("matches the report", () => {
    expect(r.purchaseFY).toBe(2004);
    expect(r.ciiPurchase).toBe(113);
    expect(r.improvementCii[0].cii).toBe(137);
    expect(r.ciiSale).toBe(331);
    expect(r.netConsideration).toBe(6_900_000);
    expect(r.indexedCostTotal).toBe(5_601_834);
    expect(R(r.gain)).toBe(1_298_166);
    expect(r.isLongTerm).toBe(true);
    expect(r.ltcgRatePct).toBe(20);
    expect(R(r.baseTax)).toBe(259_633);
    expect(r.cess).toBe(0);
    expect(R(r.totalTax)).toBe(259_633);
  });
  it("cess is opt-in", () => {
    const c = computeCapitalGains({ ...base, includeCess: true });
    expect(R(c.totalTax)).toBe(R(259_633.2 * 1.04));
  });
});

describe("#6 Child education need based (fixed)", () => {
  const r = computeChildEducation({
    childCurrentAge: 4, eduInflationPct: 6, expectedReturnPct: 12, existingSavings: 500_000,
    currentInvestmentReturnPct: 12, scenario2Pct: 15,
    milestones: [{ name: "Education", childAgeAtStart: 21, currentCost: 10_000_000 }],
  });
  const m = r.milestones[0];
  it("cost, savings, balance", () => {
    expect(R(m.futureCost)).toBe(26_927_728);
    expect(R(m.savingsApplied)).toBe(3_433_020);
    expect(R(m.balance)).toBe(23_494_707);
  });
  it("funding options per scenario", () => {
    const [a, b] = m.options;
    expect([R(a.sipTillGoal), R(a.sip5y!), R(a.sip10y!), R(a.lumpsum)]).toEqual([37647, 74356, 47438, 3421871]);
    expect([R(b.sipTillGoal), R(b.sip5y!), R(b.sip10y!), R(b.lumpsum)]).toEqual([27871, 50277, 33581, 2183267]);
  });
  it("savings use their own return", () => {
    const x = computeChildEducation({
      childCurrentAge: 4, eduInflationPct: 6, expectedReturnPct: 12, existingSavings: 500_000,
      currentInvestmentReturnPct: 8, milestones: [{ name: "E", childAgeAtStart: 21, currentCost: 10_000_000 }],
    });
    expect(x.milestones[0].savingsApplied).toBeCloseTo(500_000 * Math.pow(1.08, 17), 4);
  });
});

describe("#16 HLV (income replacement, net basis)", () => {
  it("matches", () => {
    const r = computeIncomeReplacement({
      currentAge: 30, retirementAge: 60, discountPct: 6, currentAnnualIncome: 1_800_000,
      annualPersonalExpenses: 300_000, incrementPct: 8, existingCover: 10_000_000,
    });
    expect(R(r.hlvNet)).toBe(56_400_788);
  });
});

describe("#17 Insurance IRR (year-wise tables)", () => {
  const r = computeInsuranceIrr({
    annualPremium: 100_000, premiumPaymentTerm: 10, policyTerm: 15, payoutMode: "maturity",
    payouts: [], maturityAmount: 1_750_000, expectedReturnPct: 12,
  });
  it("headline", () => {
    expect(R(r.totalPremiums)).toBe(1_000_000);
    expect(r.irrPct!.toFixed(2)).toBe("5.36");
    expect(R(r.mfContributionToMatch)).toBe(50522);
    expect(r.mfContributionRounded).toBe(50522.41);
    expect(R(r.mfMaturity)).toBe(3_463_809);
    expect(R(r.mfWealthAdvantage)).toBe(1_713_809);
  });
  it("tables", () => {
    expect(r.policySchedule).toHaveLength(15);
    r.policySchedule.forEach((row) => {
      expect(row.premium).toBe(row.year <= 10 ? 100_000 : 0);
      expect(row.payout).toBe(row.year === 15 ? 1_750_000 : 0);
    });
    expect(r.mfMatchSchedule.map((x) => R(x.yearEndValue))).toEqual(
      list("56,585 · 1,19,960 · 1,90,941 · 2,70,439 · 3,59,476 · 4,59,199 · 5,70,888 · 6,95,979 · 8,36,082 · 9,92,997 · 11,12,157 · 12,45,615 · 13,95,089 · 15,62,500 · 17,50,000")
    );
    expect(r.mfSameSchedule.map((x) => R(x.yearEndValue))).toEqual(
      list("1,12,000 · 2,37,440 · 3,77,933 · 5,35,285 · 7,11,519 · 9,08,901 · 11,29,969 · 13,77,566 · 16,54,874 · 19,65,458 · 22,01,313 · 24,65,471 · 27,61,327 · 30,92,687 · 34,63,809")
    );
  });
});

describe("#29 Property rental yield (fixed: truncated total)", () => {
  it("matches", () => {
    const r = computePropertyYield({
      marketValue: 10_000_000, appreciationPct: 5, monthlyRent: 30000, monthlyMaintenance: 2500,
      annualIncrementPct: 3, investibleSurplus: 27500, sipReturnPct: 12, years: 10,
    });
    expect(R(r.futurePropertyValue)).toBe(16_288_946);
    expect(R(r.sipValue)).toBe(6_873_075);
    expect(r.totalCombinedDisplay).toBe(23_162_020);
    expect(r.overallYieldPct.toFixed(2)).toBe("8.76");
  });
});

describe("#33 Salary wealth creation (fixed)", () => {
  const base = {
    currentAge: 32, retirementAge: 60, currentMonthlySalary: 120000, sipPctOfSalary: 10,
    annualIncrementPct: 8, investTillAge: 60, assumedReturnPct: 12, includeExisting: true,
    existingInvestment: 600000, existingReturnPct: 12, targetWealth: 100_000_000,
  };
  it("wealth mode", () => {
    const r = computeSalaryWealth({ ...base, mode: "wealth" });
    expect(R(r.totalSalaryReceived)).toBe(137_287_915);
    expect(R(r.newInvestment)).toBe(13_728_791);
    expect(R(r.sipWealth)).toBe(58_432_619);
    expect(R(r.existingFutureValue)).toBe(14_330_320);
    expect(R(r.wealth)).toBe(72_762_939);
    expect(r.pctToMatchSalary.toFixed(2)).toBe("23.50");
  });
  it("saving mode", () => {
    const r = computeSalaryWealth({ ...base, mode: "saving" });
    expect(R(r.requiredMonthlySip!)).toBe(17594);
    expect(r.requiredSipPct!.toFixed(2)).toBe("14.66");
    expect(R(r.newInvestment)).toBe(20_128_161);
  });
  it("existing investment has its own return", () => {
    const r = computeSalaryWealth({ ...base, mode: "wealth", existingReturnPct: 8 });
    expect(r.existingFutureValue).toBeCloseTo(600000 * Math.pow(1.08, 28), 2);
  });
});

describe("#2 Annual lumpsum required", () => {
  it("matches", () => {
    const r = computeAnnualLumpsumRequired({ targetAmount: 2_500_000, investmentYears: 10, paymentYears: 10, scenario1Pct: 12, scenario2Pct: null });
    expect(R(r.scenario1.requiredAnnual)).toBe(127197);
    expect(r.scenario1.schedule.map((x) => R(x.yearEndValue))).toEqual(
      [142460, 302016, 480718, 680865, 905029, 1156093, 1437285, 1752219, 2104946, 2500000]
    );
  });
});

describe("#7 FV of annual lumpsum", () => {
  it("matches", () => {
    const r = computeFvAnnualLumpsum({ annualInvestment: 500000, investmentYears: 15, paymentYears: 10, scenario1Pct: 12, scenario2Pct: null });
    expect(r.scenario1.schedule.map((x) => R(x.yearEndValue))).toEqual(
      list("5,60,000 · 11,87,200 · 18,89,664 · 26,76,424 · 35,57,595 · 45,44,506 · 56,49,847 · 68,87,828 · 82,74,368 · 98,27,292 · 1,10,06,567 · 1,23,27,355 · 1,38,06,637 · 1,54,63,434 · 1,73,19,046")
    );
    expect(R(r.scenario1.futureValue)).toBe(17_319_046);
  });
});
