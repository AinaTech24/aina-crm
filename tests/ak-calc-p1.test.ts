/**
 * Planning calculators (package p1): Loan EMI, PPF, EPF, compounding and the
 * Cost Inflation Index. Every expected value is hand-checkable — a closed-form
 * result, a known amortisation figure or a published rule.
 */

import { describe, expect, it } from "vitest";
import { LOAN_PRESETS, amortise, emi, loanEmi, moratoriumInterest } from "@/lib/calculators/loan-emi";
import { PPF_MAX_DEPOSIT, ppfCalc } from "@/lib/calculators/ppf";
import { employerEpfFor, epfCalc, epsFor } from "@/lib/calculators/epf";
import { COMPOUND_PERIODS, compoundValue, compounding, effectiveAnnualRate } from "@/lib/calculators/compounding";
import { ciiTable, fyLabel, indexCost, latestCiiYear } from "@/lib/calculators/cii";
import { CII } from "@/lib/calculators/capital-gains";

/** Balance after k instalments, closed form: P(1+r)^k − EMI((1+r)^k − 1)/r. */
function balanceAfter(p: number, ratePct: number, n: number, k: number): number {
  const r = ratePct / 1200;
  const f = Math.pow(1 + r, k);
  return p * f - (emi(p, ratePct, n) * (f - 1)) / r;
}

describe("loan EMI — reducing balance", () => {
  it("₹10,00,000 at 10% for 20 years → EMI ₹9,650.22", () => {
    expect(emi(1_000_000, 10, 240)).toBeCloseTo(9650.22, 2);
  });
  it("₹1,00,000 at 12% for 12 months → EMI ₹8,884.88, interest ₹6,618.55", () => {
    expect(emi(100_000, 12, 12)).toBeCloseTo(8884.88, 2);
    const r = loanEmi({ amount: 100_000, annualRatePct: 12, years: 1, months: 0 });
    expect(r.totalInterest).toBeCloseTo(6618.55, 2);
    expect(r.totalPayment).toBeCloseTo(106_618.55, 2);
    expect(r.schedule.months).toBe(12);
    // First month: interest 1% of 1,00,000; the rest is principal.
    expect(r.schedule.monthly[0].interest).toBeCloseTo(1000, 6);
    expect(r.schedule.monthly[0].principal).toBeCloseTo(7884.88, 2);
    expect(r.schedule.monthly[11].closing).toBe(0);
  });
  it("0% → principal ÷ months; empty loan → 0", () => {
    expect(emi(120_000, 0, 12)).toBe(10_000);
    expect(emi(0, 10, 12)).toBe(0);
    expect(emi(100_000, 10, 0)).toBe(0);
  });
  it("years + months make the tenure", () => {
    const r = loanEmi({ amount: 500_000, annualRatePct: 9, years: 2, months: 6 });
    expect(r.tenureMonths).toBe(30);
    expect(r.emi).toBeCloseTo(emi(500_000, 9, 30), 8);
  });
  it("yearly rows add up to the monthly schedule and the totals", () => {
    const s = amortise(1_000_000, 10, 240);
    expect(s.yearly).toHaveLength(20);
    const yi = s.yearly.reduce((t, y) => t + y.interest, 0);
    const yp = s.yearly.reduce((t, y) => t + y.principal, 0);
    expect(yi).toBeCloseTo(s.totalInterest, 4);
    expect(yp).toBeCloseTo(1_000_000, 4);
    expect(s.totalInterest).toBeCloseTo(9650.2164507 * 240 - 1_000_000, 2);
    expect(s.yearly[0].closing).toBeCloseTo(balanceAfter(1_000_000, 10, 240, 12), 4);
  });
  it("education moratorium: simple interest added to the loan before EMIs start", () => {
    expect(moratoriumInterest(1_000_000, 10, 48)).toBe(400_000);
    expect(moratoriumInterest(1_000_000, 10, 0)).toBe(0);
    const r = loanEmi({ amount: 1_000_000, annualRatePct: 10, years: 5, months: 0, moratoriumMonths: 48 });
    expect(r.repayPrincipal).toBe(1_400_000);
    expect(r.emi).toBeCloseTo(emi(1_400_000, 10, 60), 8);
    expect(r.emi).toBeCloseTo(29_745.86, 2);
    expect(r.totalInterest).toBeCloseTo(400_000 + r.emi * 60 - 1_400_000, 2);
    expect(r.totalPayment).toBeCloseTo(r.emi * 60, 2);
  });
  it("presets: education is the only one with a moratorium", () => {
    expect(LOAN_PRESETS.education.moratoriumMonths).toBeGreaterThan(0);
    expect(LOAN_PRESETS.home.moratoriumMonths + LOAN_PRESETS.personal.moratoriumMonths + LOAN_PRESETS.car.moratoriumMonths).toBe(0);
  });
  it("prepayment, reduce EMI: new EMI = EMI on the reduced balance over the remaining months", () => {
    const r = loanEmi({ amount: 1_000_000, annualRatePct: 10, years: 20, months: 0, prepayment: { amount: 200_000, month: 12, mode: "reduce_emi" } });
    const left = balanceAfter(1_000_000, 10, 240, 12) - 200_000;
    expect(r.prepay?.newEmi).toBeCloseTo(emi(left, 10, 228), 6);
    expect(r.schedule.months).toBe(240);
    expect(r.prepay?.monthsSaved).toBe(0);
    const interestWith = 12 * emi(1_000_000, 10, 240) - (1_000_000 - balanceAfter(1_000_000, 10, 240, 12)) + 228 * emi(left, 10, 228) - left;
    expect(r.schedule.totalInterest).toBeCloseTo(interestWith, 2);
    expect(r.prepay?.interestSaved).toBeCloseTo(9650.2164507 * 240 - 1_000_000 - interestWith, 2);
  });
  it("prepayment, reduce tenure: same EMI, loan closes when the balance runs out", () => {
    const r = loanEmi({ amount: 1_000_000, annualRatePct: 10, years: 20, months: 0, prepayment: { amount: 200_000, month: 12, mode: "reduce_tenure" } });
    const left = balanceAfter(1_000_000, 10, 240, 12) - 200_000;
    // Months of full EMI that clear `left`: n = −ln(1 − rB/E) / ln(1+r).
    const rr = 10 / 1200;
    const n = -Math.log(1 - (rr * left) / emi(1_000_000, 10, 240)) / Math.log(1 + rr);
    expect(r.schedule.months).toBe(12 + Math.ceil(n));
    expect(r.prepay?.monthsSaved).toBe(240 - r.schedule.months);
    expect(r.prepay?.newEmi).toBeCloseTo(emi(1_000_000, 10, 240), 6);
    expect(r.prepay!.interestSaved).toBeGreaterThan(0);
    const paid = r.schedule.monthly.reduce((t, m) => t + m.principal + m.prepayment, 0);
    expect(paid).toBeCloseTo(1_000_000, 4);
  });
  it("a prepayment larger than the balance closes the loan; out-of-range month is ignored", () => {
    const r = loanEmi({ amount: 100_000, annualRatePct: 12, years: 1, months: 0, prepayment: { amount: 1e9, month: 6, mode: "reduce_emi" } });
    expect(r.schedule.months).toBe(6);
    expect(r.prepay?.amount).toBeCloseTo(balanceAfter(100_000, 12, 12, 6), 6);
    expect(r.prepay?.newEmi).toBe(0);
    const none = loanEmi({ amount: 100_000, annualRatePct: 12, years: 1, months: 0, prepayment: { amount: 5000, month: 13, mode: "reduce_emi" } });
    expect(none.prepay).toBeNull();
  });
});

describe("PPF — annual compounding, deposits by 5 April", () => {
  const annuityDue = (d: number, i: number, n: number) => (d * (Math.pow(1 + i, n) - 1) / i) * (1 + i);
  it("₹1,50,000 a year for 15 years at 7.1% → ₹40,68,209", () => {
    const r = ppfCalc({ mode: "fixed", yearlyAmount: 150_000, amounts: [], ratePct: 7.1, extensions: [] });
    expect(Math.round(r.maturity)).toBe(4_068_209);
    expect(r.maturity).toBeCloseTo(annuityDue(150_000, 0.071, 15), 4);
    expect(r.totalDeposited).toBe(2_250_000);
    expect(r.totalInterest).toBeCloseTo(r.maturity - 2_250_000, 6);
    expect(r.rows).toHaveLength(15);
    expect(r.rows[0].interest).toBeCloseTo(10_650, 6); // 1,50,000 × 7.1%
    expect(r.issues).toHaveLength(0);
  });
  it("extension without deposits: the 15-year balance compounds 5 more years", () => {
    const r = ppfCalc({ mode: "fixed", yearlyAmount: 150_000, amounts: [], ratePct: 7.1, extensions: [{ withContributions: false }] });
    expect(r.years).toBe(20);
    expect(r.termMaturity).toBeCloseTo(annuityDue(150_000, 0.071, 15), 4);
    expect(r.maturity).toBeCloseTo(r.termMaturity * Math.pow(1.071, 5), 4);
    expect(r.rows[17].deposit).toBe(0);
    expect(r.rows[17].phase).toBe("extension");
    expect(r.rows[17].block).toBe(1);
  });
  it("extension with deposits: a 20-year annuity due", () => {
    const r = ppfCalc({ mode: "fixed", yearlyAmount: 150_000, amounts: [], ratePct: 7.1, extensions: [{ withContributions: true }] });
    expect(r.maturity).toBeCloseTo(annuityDue(150_000, 0.071, 20), 4);
  });
  it("variable deposits, year by year", () => {
    const r = ppfCalc({ mode: "variable", yearlyAmount: 0, amounts: [100_000, 50_000], ratePct: 10, extensions: [] });
    // Year 1: 1,00,000 × 1.1 = 1,10,000; year 2: (1,10,000 + 50,000) × 1.1 = 1,76,000.
    expect(r.rows[0].closing).toBeCloseTo(110_000, 6);
    expect(r.rows[1].closing).toBeCloseTo(176_000, 6);
    expect(r.rows[2].deposit).toBe(0);
    expect(r.issues.filter((x) => x.kind === "zero")).toHaveLength(13);
  });
  it("₹500 minimum and ₹1,50,000 maximum are enforced", () => {
    const over = ppfCalc({ mode: "fixed", yearlyAmount: 200_000, amounts: [], ratePct: 7.1, extensions: [] });
    expect(over.rows.every((r) => r.deposit === PPF_MAX_DEPOSIT)).toBe(true);
    expect(over.issues.filter((x) => x.kind === "above_max")).toHaveLength(15);
    const under = ppfCalc({ mode: "variable", yearlyAmount: 0, amounts: [300, ...Array(14).fill(500)], ratePct: 7.1, extensions: [] });
    expect(under.issues).toEqual([expect.objectContaining({ year: 1, kind: "below_min" })]);
  });
});

describe("EPF — monthly running balance, interest credited yearly", () => {
  it("EPS is 8.33% of pay capped at ₹15,000 (₹1,250)", () => {
    expect(epsFor(10_000)).toBe(833);
    expect(epsFor(15_000)).toBe(1250);
    expect(epsFor(40_000)).toBe(1250);
  });
  it("employer's EPF share: 3.67% fixed, or 12% of full pay less EPS", () => {
    expect(employerEpfFor(40_000, 3.67)).toBeCloseTo(1468, 6);
    expect(employerEpfFor(40_000, 3.67, "full_wage")).toBe(3550);
    expect(employerEpfFor(10_000, 3.67, "full_wage")).toBe(367);
    expect(employerEpfFor(0, 3.67)).toBe(0);
  });
  it("one year, ₹10,000 basic: ₹1,567 a month, interest ₹840.30, balance ₹19,644.30", () => {
    const r = epfCalc({ currentAge: 30, retirementAge: 31, monthlyWage: 10_000, salaryIncreasePct: 5, employeePct: 12, employerPct: 3.67, currentBalance: 0, ratePct: 8.25 });
    expect(r.years).toBe(1);
    expect(r.rows[0].employee).toBeCloseTo(14_400, 6);
    expect(r.rows[0].employer).toBeCloseTo(4404, 6);
    expect(r.rows[0].interest).toBeCloseTo(840.30375, 6);
    expect(r.corpus).toBeCloseTo(19_644.30375, 6);
    expect(r.totalEps).toBe(833 * 12);
  });
  it("opening balance earns a full year; salary rises from year 2", () => {
    const r = epfCalc({ currentAge: 30, retirementAge: 32, monthlyWage: 10_000, salaryIncreasePct: 10, employeePct: 12, employerPct: 3.67, currentBalance: 100_000, ratePct: 8.25 });
    const y1 = 100_000 + 1567 * 12 + ((100_000 * 12 + 1567 * 78) * 8.25) / 1200;
    const m2 = 11_000 * 0.1567;
    const y2 = y1 + m2 * 12 + ((y1 * 12 + m2 * 78) * 8.25) / 1200;
    expect(r.rows[0].closing).toBeCloseTo(y1, 6);
    expect(r.rows[1].monthlyWage).toBeCloseTo(11_000, 6);
    expect(r.corpus).toBeCloseTo(y2, 6);
    expect(r.rows[1].age).toBe(32);
    expect(r.totalInterest).toBeCloseTo(r.corpus - 100_000 - r.totalEmployee - r.totalEmployer, 6);
  });
  it("retirement age not after current age → no years, corpus = balance", () => {
    const r = epfCalc({ currentAge: 58, retirementAge: 58, monthlyWage: 50_000, salaryIncreasePct: 5, employeePct: 12, employerPct: 3.67, currentBalance: 500_000, ratePct: 8.25 });
    expect(r.years).toBe(0);
    expect(r.corpus).toBe(500_000);
  });
});

describe("compounding", () => {
  it("₹1,00,000 at 10% quarterly for 5 years → 1.025^20 = ₹1,63,861.64", () => {
    expect(compoundValue(100_000, 10, 4, 5)).toBeCloseTo(163_861.64, 2);
    const r = compounding({ principal: 100_000, ratePct: 10, years: 5, frequency: "quarterly", addition: 0, additionFrequency: "monthly", additionTiming: "end" });
    expect(r.total).toBeCloseTo(163_861.64, 2);
    expect(r.invested).toBe(100_000);
    expect(r.rows[0].total).toBeCloseTo(100_000 * Math.pow(1.025, 4), 6);
    expect(r.rows[1].interestThisYear).toBeCloseTo(r.rows[1].total - r.rows[0].total, 6);
    expect(r.effectiveRatePct).toBeCloseTo(10.381289, 5);
  });
  it("effective annual rates by frequency", () => {
    expect(effectiveAnnualRate(10, COMPOUND_PERIODS.yearly)).toBeCloseTo(10, 10);
    expect(effectiveAnnualRate(10, COMPOUND_PERIODS.half_yearly)).toBeCloseTo(10.25, 10);
    expect(effectiveAnnualRate(12, COMPOUND_PERIODS.monthly)).toBeCloseTo(12.682503, 5);
    expect(effectiveAnnualRate(10, COMPOUND_PERIODS.daily)).toBeCloseTo((Math.pow(1 + 0.1 / 365, 365) - 1) * 100, 10);
  });
  it("₹1,000 a month at 12% compounded monthly for a year: ₹12,682.50 at month end, ×1.01 at month start", () => {
    const end = compounding({ principal: 0, ratePct: 12, years: 1, frequency: "monthly", addition: 1000, additionFrequency: "monthly", additionTiming: "end" });
    expect(end.total).toBeCloseTo(12_682.5, 2);
    expect(end.invested).toBe(12_000);
    const start = compounding({ principal: 0, ratePct: 12, years: 1, frequency: "monthly", addition: 1000, additionFrequency: "monthly", additionTiming: "start" });
    expect(start.total).toBeCloseTo(12_682.503 * 1.01, 2);
  });
  it("monthly additions under quarterly compounding grow by (1 + r/4)^(months/3), as on a recurring deposit", () => {
    const r = compounding({ principal: 0, ratePct: 8, years: 1, frequency: "quarterly", addition: 1000, additionFrequency: "monthly", additionTiming: "start" });
    let expected = 0;
    for (let k = 12; k >= 1; k--) expected += 1000 * Math.pow(1.02, k / 3);
    expect(r.total).toBeCloseTo(expected, 6);
  });
});

describe("Cost Inflation Index", () => {
  it("the table runs from FY 2001-02 (100) to the latest notified year", () => {
    const t = ciiTable();
    expect(t[0]).toEqual({ fyStart: 2001, label: "2001-02", cii: 100 });
    expect(t).toHaveLength(Object.keys(CII).length);
    expect(latestCiiYear()).toBe(t[t.length - 1].fyStart);
    expect(t.find((r) => r.fyStart === 2024)?.cii).toBe(363);
    expect(t.find((r) => r.fyStart === 2025)?.cii).toBe(376);
    expect(t.every((r, i) => i === 0 || r.cii > t[i - 1].cii)).toBe(true);
  });
  it("FY labels", () => {
    expect(fyLabel(2001)).toBe("2001-02");
    expect(fyLabel(2009)).toBe("2009-10");
    expect(fyLabel(2099)).toBe("2099-00");
  });
  it("indexed cost = cost × CII(to) ÷ CII(from)", () => {
    expect(indexCost(100_000, 2001, 2024).indexedCost).toBe(363_000);
    const r = indexCost(500_000, 2008, 2022);
    expect(r.ciiFrom).toBe(137);
    expect(r.ciiTo).toBe(331);
    expect(r.indexedCost).toBeCloseTo(1_208_029.197, 3);
    expect(r.inflationUplift).toBeCloseTo(708_029.197, 3);
    expect(r.factor).toBeCloseTo(331 / 137, 12);
    expect(r.error).toBeNull();
  });
  it("before 2001 reads as 2001-02; backwards or unknown years are refused", () => {
    expect(indexCost(100_000, 1995, 2010).fromFy).toBe(2001);
    expect(indexCost(100_000, 1995, 2010).indexedCost).toBe(167_000);
    expect(indexCost(100_000, 2010, 2005).error).not.toBeNull();
    expect(indexCost(100_000, 2010, 2099).error).not.toBeNull();
  });
});
