/**
 * Insurance & Protection and Tax: each def against the web CRM — the web module
 * run on the same inputs (webModule) and the reference figures the web
 * documents (component headers and the maths modules' verified cases).
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import { DEFS } from "../defs/insuranceTax";
import * as appIrr from "../web/insurance-irr";
import * as appSur from "../web/surrender-analysis";
import * as appHlv from "../web/hlv";
import * as appTs from "../web/term-plus-sip";
import * as appTax from "../web/tax-regime";
import * as appReal from "../web/real-return";
import * as appNps from "../web/nps";
import * as appHarv from "../web/tax-harvesting";
import * as appCg from "../web/capital-gains";
import * as appBond from "../web/capital-gains-bond";
import * as appCii from "../web/cii";
import { inr, fmtPct } from "../fmt";
import type { ResultBlock } from "../types";

const webIrr = webModule<typeof appIrr>("calculators/insurance-irr");
const webSur = webModule<typeof appSur>("calculators/surrender-analysis");
const webHlv = webModule<typeof appHlv>("calculators/hlv");
const webTs = webModule<typeof appTs>("calculators/term-plus-sip");
const webTax = webModule<typeof appTax>("calculators/tax-regime");
const webReal = webModule<typeof appReal>("calculators/real-return");
const webNps = webModule<typeof appNps>("calculators/nps");
const webHarv = webModule<typeof appHarv>("calculators/tax-harvesting");
const webCg = webModule<typeof appCg>("calculators/capital-gains");
const webBond = webModule<typeof appBond>("calculators/capital-gains-bond");
const webCii = webModule<typeof appCii>("calculators/cii");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));
const tones = (b: ResultBlock[], label: string) => {
  const s = b.find((x) => x.type === "stat" && x.label === label);
  return s && s.type === "stat" ? s.tone : "missing";
};

describe("every Insurance & Tax def", () => {
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
  it.each(Object.keys(DEFS))("%s survives any one input at zero or blank, and every option", (key) => {
    const body = DEFS[key];
    for (const i of body.inputs) {
      if (typeof i.default === "number") {
        expect(() => run(body, { [i.key]: 0 })).not.toThrow();
        expect(() => run(body, { [i.key]: undefined })).not.toThrow();
      }
      if (typeof i.default === "string") expect(() => run(body, { [i.key]: "" })).not.toThrow();
      for (const o of i.options ?? []) expect(() => run(body, { [i.key]: o.value })).not.toThrow();
      if (i.type === "toggle") expect(() => run(body, { [i.key]: !i.default })).not.toThrow();
    }
  });
});

/* ───────────── Insurance & Protection ───────────── */

describe("insurance — Insurance Return Analyzer", () => {
  const base = {
    annualPremium: 100000, premiumPaymentTerm: 10, policyTerm: 15, payoutMode: "maturity" as const,
    payouts: [{ year: 4, amount: 50000 }, { year: 8, amount: 50000 }, { year: 12, amount: 50000 }],
    maturityAmount: 1750000, expectedReturnPct: 12,
  };
  it("prints the web's reference case", () => {
    // insurance-irr.ts: ₹1L premium × 10y, 15y term, ₹17.5L maturity → IRR
    // 5.36%; same premiums in MF @12% → ₹34.63L; MF to match → ₹50,522/yr.
    const b = run(DEFS.insurance);
    expect(statOf(b, "Total premiums")).toBe("₹10,00,000");
    expect(statOf(b, "Total benefit")).toBe("₹17,50,000");
    expect(statOf(b, "Net gain")).toBe("₹7,50,000");
    expect(statOf(b, "Policy IRR")).toBe("5.36%");
    expect(tones(b, "Policy IRR")).toBe("danger");
    const [cmp, policy, match, same] = tables(b);
    expect(cmp.rows).toEqual([["Maturity / value", "₹17,50,000", "₹34,63,809"], ["You invest", "₹10,00,000", "₹10,00,000"]]);
    expect(policy.rows).toHaveLength(15);
    expect(policy.rows[14]).toEqual(["15", "—", "₹17,50,000"]);
    const w = webIrr.computeInsuranceIrr(base);
    expect(match.rows[14]).toEqual(["15", "—", inr(w.mfMatchSchedule[14].yearEndValue)]);
    expect(same.rows[0]).toEqual(["1", "₹1,00,000", inr(w.mfSameSchedule[0].yearEndValue)]);
    expect(texts(b, "insight")).toEqual([
      "This policy returns 5.36% IRR — below the 12% a mutual fund is assumed to deliver, and likely below long-term inflation.",
      `The same premiums in a mutual fund could grow to ₹34,63,809 — about ₹17,13,809 more wealth (${Math.round(w.mfAdvantagePct!)}% higher).`,
      "To reach the same ₹17,50,000 from a mutual fund, you'd only need to invest about ₹50,522/year — far less than the ₹1,00,000 premium.",
    ]);
    expect(texts(b, "section")).toEqual(["1. Mutual fund comparison (same premiums @ 12%)", "2. Year-wise cash flows"]);
    expect(texts(b, "note")).toContain("MF for the same payout · ₹50,522/yr × 10 yrs");
  });
  it("the MF comparison off: one table and the standalone MF maturity", () => {
    const b = run(DEFS.insurance, { showMfCompare: false });
    expect(tables(b)).toHaveLength(1);
    expect(texts(b, "section")).toEqual(["1. Year-wise cash flows"]);
    expect(statOf(b, "MF maturity value @ 12%")).toBe("₹34,63,809");
  });
  it.each([
    { ...base, payoutMode: "periodic" as const },
    { ...base, payoutMode: "annuity" as const, annualPremium: 60000, premiumPaymentTerm: 12, policyTerm: 20, maturityAmount: 900000, expectedReturnPct: 10.5, payouts: [{ year: 5, amount: 40000 }, { year: 10, amount: 40000 }, { year: 15, amount: 80000 }, { year: 25, amount: 9999 }] },
    { ...base, annualPremium: 250000, premiumPaymentTerm: 5, policyTerm: 10, maturityAmount: 1600000, expectedReturnPct: 8 },
  ])("computeInsuranceIrr equals the web module (%#)", (input) => {
    const w = webIrr.computeInsuranceIrr(input);
    expect(appIrr.computeInsuranceIrr(input)).toEqual(w);
    const overrides: Record<string, any> = {
      annualPremium: input.annualPremium, premiumPaymentTerm: input.premiumPaymentTerm, policyTerm: input.policyTerm,
      payoutMode: input.payoutMode, maturityAmount: input.maturityAmount, expectedReturnPct: input.expectedReturnPct,
    };
    for (let i = 0; i < 10; i++) {
      overrides[`payout${i + 1}Year`] = input.payouts[i]?.year ?? 40;
      overrides[`payout${i + 1}Amount`] = input.payouts[i]?.amount ?? 0;
    }
    const b = run(DEFS.insurance, overrides);
    expect(statOf(b, "Total benefit")).toBe(inr(w.totalBenefit));
    expect(statOf(b, "Policy IRR")).toBe(w.irrPct == null ? "—" : `${w.irrPct.toFixed(2)}%`);
    expect(tables(b)[0].rows[0]).toEqual([
      w.totalPayouts > 0 ? "Value at maturity (payouts reinvested)" : "Maturity / value", inr(w.benefitAtMaturity), inr(w.mfMaturity),
    ]);
  });
});

describe("surrender — Surrender vs Invest", () => {
  it("prints the web's reference case to the rupee", () => {
    // surrender-analysis.ts: ₹4,80,000 · 15 / 10 yrs · ₹50,000 · maturity
    // ₹12,50,000 · 12% → incremental ₹2,70,000 · IRR ≈ 1.92%; surrender &
    // invest ₹43,59,216 · total return ₹33,79,216.
    const b = run(DEFS.surrender);
    expect(statOf(b, "Incremental return")).toBe("₹2,70,000");
    expect(statOf(b, "Effective policy IRR")).toBe("1.92%");
    expect(statOf(b, "Expected value at the end")).toBe("₹43,59,216");
    expect(statOf(b, "Total return")).toBe("₹33,79,216");
    expect(statOf(b, "Assumed return (Equity Mutual Fund)")).toBe("12.00%");
    expect(texts(b, "insight")[0]).toBe(
      "On these numbers, surrendering & investing could grow to ₹43,59,216 — about 3.5× the policy's ₹12,50,000, a difference of ₹31,09,216. The policy's own return is just 1.92% p.a.",
    );
  });
  it("a picked alternate brings its typical return", () => {
    const b = run(DEFS.surrender, { altOption: "fd" });
    expect(statOf(b, "Assumed return (Fixed Deposit)")).toBe("6.50%");
  });
  it.each([
    { altOption: "ppf", r: 7.1, includeAnnuity: true, annuityStartYear: 3, annuityAnnualAmount: 60000, annuityYears: 20, includePeriodic: false, periodicEveryYears: 5, periodicAmount: 0, periodicTimes: 0 },
    { altOption: "debt_mf", r: 7, includeAnnuity: false, annuityStartYear: 1, annuityAnnualAmount: 0, annuityYears: 0, includePeriodic: true, periodicEveryYears: 4, periodicAmount: 150000, periodicTimes: 3 },
    { altOption: "other", r: 3, includeAnnuity: true, annuityStartYear: 10, annuityAnnualAmount: 100000, annuityYears: 6, includePeriodic: true, periodicEveryYears: 5, periodicAmount: 200000, periodicTimes: 2 },
  ] as const)("computeSurrenderAnalysis equals the web module (%#)", (c) => {
    const input = {
      policyName: "", currentSurrenderValue: 480000, policyYearsLeft: 15, premiumYearsLeft: 10, annualPremium: 50000,
      expectedMaturityAmount: 1250000, altOption: c.altOption, altReturnPct: c.r,
      includeAnnuity: c.includeAnnuity, annuityStartYear: c.annuityStartYear, annuityAnnualAmount: c.annuityAnnualAmount, annuityYears: c.annuityYears,
      includePeriodic: c.includePeriodic, periodicEveryYears: c.periodicEveryYears, periodicAmount: c.periodicAmount, periodicTimes: c.periodicTimes,
    };
    const w = webSur.computeSurrenderAnalysis(input);
    expect(appSur.computeSurrenderAnalysis(input)).toEqual(w);
    const b = run(DEFS.surrender, { ...input, [`altReturn_${c.altOption}`]: c.r });
    expect(statOf(b, "Expected value at the end")).toBe(inr(w.expectedValueAtEnd));
    expect(statOf(b, "Expected payout + maturity")).toBe(inr(w.expectedPayoutAndMaturity));
    expect(statOf(b, "Money-back / annuity payouts")).toBe(w.totalPayouts > 0 ? inr(w.totalPayouts) : undefined);
    if (!w.surrenderIsBetter) {
      expect(texts(b, "insight")[0]).toBe(
        `On these numbers, continuing the policy (${inr(w.expectedPayoutAndMaturity)}) is ahead of surrendering & investing (${inr(w.expectedValueAtEnd)}) at the assumed ${c.r.toFixed(1)}% return.`,
      );
    }
  });
});

describe("hlv — Human Life Value", () => {
  it("prints the web's reference case (Income Replacement, net)", () => {
    // HumanLifeValueCalculator.tsx: ₹18 L income − ₹3 L expenses → ₹5,64,00,788;
    // ₹1 cr in force → ₹4,64,00,788 more.
    const b = run(DEFS.hlv);
    expect(statOf(b, "Human Life Value (net)")).toBe("₹5,64,00,788");
    expect(statOf(b, "Additional cover required")).toBe("₹4,64,00,788");
    expect(texts(b, "insight")[0]).toBe(
      "On a net-of-expenses basis, the client needs about ₹5,64,00,788 of life cover; with ₹1,00,00,000 already in force, that's ₹4,64,00,788 of additional term cover.",
    );
    const w = webHlv.computeIncomeReplacement({ currentAge: 30, retirementAge: 60, discountPct: 6, currentAnnualIncome: 1800000, annualPersonalExpenses: 300000, incrementPct: 8, existingCover: 10000000 });
    expect(tables(b)[0].rows[0]).toEqual(["PV of future income (8% increment, 6% discount, 30 yrs)", inr(w.pvIncome)]);
    const g = run(DEFS.hlv, { basis: "gross" });
    expect(statOf(g, "Human Life Value (gross)")).toBe(inr(w.hlvGross));
    expect(statOf(g, "Additional cover required")).toBe(inr(w.additionalGross));
  });
  it.each([
    { currentAge: 42, retirementAge: 58, discountPct: 7.5, currentAnnualIncome: 3200000, annualPersonalExpenses: 900000, incrementPct: 6, existingCover: 20000000 },
    { currentAge: 25, retirementAge: 65, discountPct: 8, currentAnnualIncome: 900000, annualPersonalExpenses: 200000, incrementPct: 8, existingCover: 0 },
  ])("computeIncomeReplacement equals the web module (%#)", (input) => {
    const w = webHlv.computeIncomeReplacement(input);
    expect(appHlv.computeIncomeReplacement(input)).toEqual(w);
    expect(statOf(run(DEFS.hlv, input), "Human Life Value (net)")).toBe(inr(w.hlvNet));
  });
  it("Need Analysis equals the web module", () => {
    const input = { outstandingLiabilities: 5000000, futureGoals: 5000000, familyAnnualNeed: 800000, yearsOfSupport: 25, incrementPct: 6, discountPct: 7, existingAssets: 3000000, existingCover: 10000000 };
    const w = webHlv.computeNeedAnalysis(input);
    expect(appHlv.computeNeedAnalysis(input)).toEqual(w);
    const b = run(DEFS.hlv, { method: "need_analysis" });
    expect(texts(b, "section")).toEqual(["✓ Cover required (Need Analysis)"]);
    expect(tables(b)[0].rows).toEqual([
      ["Outstanding liabilities", "₹50,00,000"],
      ["Future goals (education / marriage)", "₹50,00,000"],
      ["PV of family's ongoing expenses (25 yrs)", inr(w.pvFamilyNeed)],
      ["Total need", inr(w.totalNeed)],
      ["Less: existing assets + cover", `(${inr(w.offsets)})`],
      ["Cover required", inr(w.coverRequired)],
    ]);
  });
});

describe("termsip — Term Insurance + SIP", () => {
  it("prints the web's three reference cases", () => {
    // TermPlusSipCalculator.tsx: ₹10,01,31,629 · ₹3,246/month · ₹2,19,32,588 vs ₹3,71,77,568.
    const budget = run(DEFS.termsip);
    expect(statOf(budget, "Monthly SIP")).toBe("₹32,500");
    expect(statOf(budget, "Fund at age 60")).toBe("₹10,01,31,629");
    expect(tables(budget)[0].rows).toHaveLength(30);
    expect(tables(budget)[0].rows[29]).toEqual(["60", "₹4,00,000", "₹1,00,00,000", "₹10,01,31,629", "₹11,01,31,629"]);
    const goal = run(DEFS.termsip, { mode: "goal" });
    expect(statOf(goal, "Monthly SIP needed @ 12%")).toBe("₹3,246");
    expect(statOf(goal, "Yearly outlay (premium + SIP)")).toBe("₹48,949");
    const wg = webTs.termPlusSipGoal({ age: 30, goal: 10000000, termYears: 30, premium: 10000, returnPct: 12 });
    expect(statOf(goal, "Or one-time lumpsum today @ 12%")).toBe(inr(wg.lumpsumToday));
    expect(texts(goal, "insight")[0]).toContain(`A one-time lumpsum of ${inr(wg.lumpsumToday)} invested today instead of the SIP`);
    const policy = run(DEFS.termsip, { mode: "policy" });
    expect(statOf(policy, "Policy maturity value")).toBe("₹2,19,32,588");
    expect(statOf(policy, "Monthly SIP (premium − term) ÷ 12")).toBe("₹40,417");
    expect(statOf(policy, "Term + SIP fund value")).toBe("₹3,71,77,568");
    expect(texts(policy, "insight")[0]).toBe(
      "For the same ₹5,00,000 a year and the same ₹50,00,000 of cover, the term-plus-SIP route could end with ₹1,52,44,980 more than the policy after 20 years.",
    );
  });
  it("warns when the premium takes the whole budget", () => {
    const b = run(DEFS.termsip, { annualOutlay: 10000 });
    expect(texts(b, "insight")).toEqual(["The premium uses the whole budget, so nothing is left to invest."]);
  });
  it.each([
    { age: 35, annualOutlay: 250000, sumAssured: 15_000_000, termYears: 25, premium: 18000, returnPct: 11 },
    { age: 28, annualOutlay: 600000, sumAssured: 20_000_000, termYears: 32, premium: 22000, returnPct: 13.5 },
  ])("termPlusSip / termPlusSipGoal equal the web module (%#)", (input) => {
    const w = webTs.termPlusSip(input);
    expect(appTs.termPlusSip(input)).toEqual(w);
    const goalInput = { age: input.age, goal: input.sumAssured, termYears: input.termYears, premium: input.premium, returnPct: input.returnPct };
    const wg = webTs.termPlusSipGoal(goalInput);
    expect(appTs.termPlusSipGoal(goalInput)).toEqual(wg);
    expect(statOf(run(DEFS.termsip, input), `Fund at age ${w.finalAge}`)).toBe(inr(w.finalValue));
    expect(statOf(run(DEFS.termsip, { ...input, mode: "goal", goalAmount: input.sumAssured }), `Monthly SIP needed @ ${fmtPct(input.returnPct)}`)).toBe(inr(wg.sipMonthly));
  });
  it("insuranceVsTermSip equals the web module", () => {
    const input = { premium: 300000, sumAssured: 4_000_000, years: 15, termPremium: 12000, sipRatePct: 11, insuranceRatePct: 6 };
    const w = webTs.insuranceVsTermSip(input);
    expect(appTs.insuranceVsTermSip(input)).toEqual(w);
    const b = run(DEFS.termsip, { mode: "policy", policyPremium: 300000, policyCover: 4_000_000, policyYears: 15, termPremium: 12000, sipRatePct: 11, policyRatePct: 6 });
    expect(statOf(b, "Difference")).toBe(inr(w.difference));
  });
});

/* ───────────── Tax ───────────── */

describe("taxregime — Old vs New Tax Regime", () => {
  const deductions = (o: Partial<appTax.RegimeDeductions> = {}): appTax.RegimeDeductions => ({
    section80C: 150000, section80D: 25000, nps80CCD1B: 50000, homeLoanInterest: 0, hraExemption: 0, otherDeductions: 0, employerNps80CCD2: 0, ...o,
  });
  it("prints the web's default case", () => {
    const w = webTax.compareRegimes({ grossIncome: 1500000, isSalaried: true, deductions: deductions(), sipReturnPct: 12, sipYears: 20 });
    const b = run(DEFS.taxregime);
    expect(statOf(b, "Old regime tax")).toBe(inr(w.old.totalTax));
    expect(statOf(b, "New regime tax")).toBe(inr(w.new.totalTax));
    expect(statOf(b, "Better regime")).toBe(w.betterRegime === "new" ? "New" : "Old");
    expect(statOf(b, "Annual tax saving")).toBe(inr(w.annualSaving));
    expect(tables(b)[0].rows[5]).toEqual(["Total tax", inr(w.old.totalTax), inr(w.new.totalTax)]);
    expect(texts(b, "insight")[0]).toBe(
      `The ${w.betterRegime} regime saves about ${inr(w.annualSaving)}/year. Invested as a ${inr(w.monthlyFromSaving)}/month SIP at 12% for 20 years, that tax saving alone grows to ${inr(w.sipFutureValue)} — turning a tax decision into wealth.`,
    );
  });
  it.each([
    { grossIncome: 1275000, isSalaried: true, deductions: deductions(), sipReturnPct: 12, sipYears: 20 },
    { grossIncome: 6_500_000, isSalaried: false, deductions: deductions({ homeLoanInterest: 250000, hraExemption: 300000, employerNps80CCD2: 200000 }), sipReturnPct: 10, sipYears: 15 },
    { grossIncome: 650000, isSalaried: true, deductions: deductions({ section80C: 200000, nps80CCD1B: 80000 }), sipReturnPct: 11, sipYears: 10 },
  ])("compareRegimes equals the web module (%#)", (input) => {
    const w = webTax.compareRegimes(input);
    expect(appTax.compareRegimes(input)).toEqual(w);
    const d = input.deductions;
    const b = run(DEFS.taxregime, {
      grossIncome: input.grossIncome, isSalaried: input.isSalaried, employerNps: d.employerNps80CCD2, section80C: d.section80C, section80D: d.section80D,
      nps80CCD1B: d.nps80CCD1B, homeLoanInterest: d.homeLoanInterest, hraExemption: d.hraExemption, otherDeductions: d.otherDeductions,
      sipReturnPct: input.sipReturnPct, sipYears: input.sipYears,
    });
    expect(statOf(b, "Old regime tax")).toBe(inr(w.old.totalTax));
    expect(statOf(b, "New regime tax")).toBe(inr(w.new.totalTax));
  });
});

describe("realreturn — Real Return", () => {
  const rows = [
    { name: "Savings account", nominalPct: 3, taxPct: 30 },
    { name: "Fixed deposit", nominalPct: 7, taxPct: 30 },
    { name: "Debt fund", nominalPct: 8, taxPct: 30 },
    { name: "Equity fund", nominalPct: 12, taxPct: 12.5 },
  ];
  it("prints the web's default case", () => {
    const w = webReal.computeRealReturns(rows, 6, 1000000, 10);
    const b = run(DEFS.realreturn);
    const [t] = tables(b);
    expect(t.head).toEqual(["Instrument", "Nominal %", "Tax %", "Post-tax %", "Real return %", "Real value in 10y"]);
    expect(t.rows).toEqual(w.map((r) => [r.name, `${r.nominalPct}%`, `${r.taxPct}%`, `${r.postTaxNominalPct.toFixed(2)}%`, `${r.realPct.toFixed(2)}%`, inr(r.realFutureValue)]));
    expect(texts(b, "insight")[0]).toBe(
      `Savings account actually loses ${Math.abs(w[0].realPct).toFixed(2)}% a year in real, post-tax terms — your money buys less over time. Equity fund delivers the strongest real return (${w[3].realPct.toFixed(2)}%) — the gap is the real cost of playing it "safe."`,
    );
  });
  it("a blank name drops the row; a fifth slot adds one", () => {
    const b = run(DEFS.realreturn, { name1: "", name5: "Gold", nominal5: 9, tax5: 12.5 });
    const names = tables(b)[0].rows.map((r) => r[0]);
    expect(names).toEqual(["Fixed deposit", "Debt fund", "Equity fund", "Gold"]);
    const w = webReal.computeRealReturns([...rows.slice(1), { name: "Gold", nominalPct: 9, taxPct: 12.5 }], 6, 1000000, 10);
    expect(appReal.computeRealReturns([...rows.slice(1), { name: "Gold", nominalPct: 9, taxPct: 12.5 }], 6, 1000000, 10)).toEqual(w);
    expect(tables(b)[0].rows[3][5]).toBe(inr(w[3].realFutureValue));
  });
  it("computeRealReturns equals the web module", () => {
    for (const [infl, amt, yrs] of [[4.5, 250000, 7], [8, 5000000, 25]]) {
      expect(appReal.computeRealReturns(rows, infl, amt, yrs)).toEqual(webReal.computeRealReturns(rows, infl, amt, yrs));
    }
  });
});

describe("nps — NPS Retirement & Tax", () => {
  const input = { currentAge: 30, retirementAge: 60, monthlyContribution: 5000, annualStepUpPct: 5, expectedReturnPct: 10, existingCorpus: 0, annuityPortionPct: 40, annuityRatePct: 6, taxSlabPct: 30 };
  it("prints the web's default case", () => {
    const w = webNps.computeNps(input);
    const b = run(DEFS.nps);
    expect(statOf(b, "Corpus at 60")).toBe(inr(w.corpus));
    expect(statOf(b, "Tax-free lump sum")).toBe(inr(w.lumpSum));
    expect(statOf(b, "Monthly pension")).toBe(inr(w.monthlyPension));
    expect(tables(b)[0].rows[2]).toEqual(["Lump-sum withdrawal (60%, tax-free)", inr(w.lumpSum)]);
    expect(texts(b, "insight")[0]).toContain(`saves about ${inr(w.annual80CCD1BBenefit)} in tax every year`);
  });
  it.each([
    { ...input, currentAge: 40, retirementAge: 62, monthlyContribution: 12000, existingCorpus: 800000, annuityPortionPct: 25, annuityRatePct: 6.5 },
    { ...input, currentAge: 25, monthlyContribution: 3000, annualStepUpPct: 10, expectedReturnPct: 11, annuityPortionPct: 60, taxSlabPct: 20 },
  ])("computeNps equals the web module (%#)", (c) => {
    const w = webNps.computeNps(c);
    expect(appNps.computeNps(c)).toEqual(w);
    expect(statOf(run(DEFS.nps, c), `Corpus at ${c.retirementAge}`)).toBe(inr(w.corpus));
  });
});

describe("harvest — LTCG Tax-Harvesting", () => {
  it("prints the web's default case", () => {
    const w = webHarv.computeTaxHarvesting({ investment: 2000000, expectedReturnPct: 12, years: 15, exemptionPerYear: 125000, ltcgRatePct: 12.5 });
    const b = run(DEFS.harvest);
    expect(statOf(b, "Final value")).toBe(inr(w.finalValue));
    expect(statOf(b, "Tax if you never harvest")).toBe(inr(w.taxWithoutHarvesting));
    expect(statOf(b, "Tax with harvesting")).toBe(inr(w.taxWithHarvesting));
    expect(statOf(b, "Tax saved")).toBe(inr(w.taxSaved));
    expect(tables(b)[0].rows).toHaveLength(15);
  });
  it.each([
    { investment: 500000, expectedReturnPct: 10, years: 8, exemptionPerYear: 125000, ltcgRatePct: 12.5 },
    { investment: 10_000_000, expectedReturnPct: 14, years: 20, exemptionPerYear: 0, ltcgRatePct: 10 },
  ])("computeTaxHarvesting equals the web module (%#)", (input) => {
    const w = webHarv.computeTaxHarvesting(input);
    expect(appHarv.computeTaxHarvesting(input)).toEqual(w);
    expect(statOf(run(DEFS.harvest, input), "Tax saved")).toBe(inr(w.taxSaved));
  });
});

describe("captax — Capital Gains Tax", () => {
  const base = {
    acquisitionBasis: "after_2001" as const, assetType: "immovable" as const, purchasePrice: 1500000, purchaseDate: "2004-06-15", fmv2001: 0,
    improvements: [{ fyStartYear: 2008, cost: 500000 }], salePrice: 7000000, salesExpenses: 100000, saleDate: "2022-11-01",
    expectedSaleCII: null, incomeTaxSlabPct: 30, includeCess: false,
  };
  it("prints the web's reference case to the rupee", () => {
    // capital-gains.ts: indexed cost ₹56,01,834, LTCG ₹12,98,166, tax @20% ₹2,59,633, no cess.
    const b = run(DEFS.captax);
    expect(statOf(b, "Holding period")).toBe("18y 4m");
    expect(statOf(b, "Gain type")).toBe("Long-term");
    expect(statOf(b, "Long-term capital gain")).toBe("₹12,98,166");
    expect(statOf(b, "Total tax payable")).toBe("₹2,59,633");
    const rows = tables(b)[0].rows;
    expect(rows).toContainEqual(["Less: indexed cost of acquisition (purchase + improvements)", "(₹56,01,834)"]);
    expect(rows).toContainEqual(["CII — year of purchase (2004-05)", "113"]);
    expect(rows).toContainEqual(["Cost of improvement in FY 2008-09 (CII 137)", "₹5,00,000"]);
    expect(rows).toContainEqual(["CII — year of sale (2022-23)", "331"]);
    expect(rows[rows.length - 1]).toEqual(["Total tax payable", "₹2,59,633"]);
    expect(texts(b, "section")).toEqual(["✓ Computation (with indexation)"]);
    expect(texts(b, "insight")[0]).toBe(
      "House was held for 18 years 4 months → long-term. Tax payable is ₹2,59,633 (effective 20.0% of the gain). Indexation raises the cost base to today's value, sharply reducing the taxable gain. Cess is not included.",
    );
    expect(texts(b, "note")[0]).toBe(
      "Indexed cost = purchase ₹43,93,805 (₹15,00,000 × 331 / 113) + improvement FY 2008-09 ₹12,08,029 (₹5,00,000 × 331 / 137), each part rounded to the rupee.",
    );
  });
  it.each([
    { ...base, includeCess: true },
    { ...base, purchaseDate: "2023-09-10", saleDate: "2024-03-01", improvements: [] },
    { ...base, acquisitionBasis: "before_2001" as const, purchaseDate: "1995-05-01", fmv2001: 2500000, saleDate: "2025-01-15", improvements: [{ fyStartYear: 2010, cost: 300000 }, { fyStartYear: 2018, cost: 450000 }] },
    { ...base, assetType: "gold" as const, purchaseDate: "2019-02-01", saleDate: "2025-08-20", salePrice: 900000, purchasePrice: 400000, salesExpenses: 0, improvements: [], expectedSaleCII: 390 },
  ])("computeCapitalGains equals the web module (%#)", (input) => {
    const w = webCg.computeCapitalGains(input);
    expect(appCg.computeCapitalGains(input)).toEqual(w);
    const overrides: Record<string, any> = {
      basis: input.acquisitionBasis, assetType: input.assetType, purchasePrice: input.purchasePrice, purchaseDate: input.purchaseDate,
      fmv2001: input.fmv2001, salePrice: input.salePrice, salesExpenses: input.salesExpenses, saleDate: input.saleDate,
      expectedSaleCII: input.expectedSaleCII ?? 0, incomeTaxSlabPct: input.incomeTaxSlabPct, includeCess: input.includeCess,
    };
    for (let i = 0; i < 4; i++) {
      overrides[`imp${i + 1}Fy`] = String(input.improvements[i]?.fyStartYear ?? 2022);
      overrides[`imp${i + 1}Cost`] = input.improvements[i]?.cost ?? 0;
    }
    const b = run(DEFS.captax, overrides);
    expect(statOf(b, "Total tax payable")).toBe(inr(w.totalTax));
    expect(statOf(b, w.isLongTerm ? "Long-term capital gain" : "Short-term capital gain")).toBe(inr(w.gain));
    expect(statOf(b, "Holding period")).toBe(`${Math.floor(w.holdingMonths / 12)}y ${w.holdingMonths % 12}m`);
  });
});

describe("cgbond — 54EC Bond vs Other Investment", () => {
  it("prints the web's reference case", () => {
    // capital-gains-bond.ts: ₹50 L gain, 5 yrs → post-tax ₹60,20,418 / ₹54,10,816
    // / ₹56,07,815 / ₹72,93,339 and IRR 3.78% / 1.59% / 2.32% / 7.84%.
    const b = run(DEFS.cgbond);
    expect(statOf(b, "54EC Bond · post-tax IRR")).toBe("3.78%");
    expect(statOf(b, "Fixed Deposit · post-tax IRR")).toBe("1.59%");
    expect(statOf(b, "Debt Fund · post-tax IRR")).toBe("2.32%");
    expect(statOf(b, "Equity Fund · post-tax IRR")).toBe("7.84%");
    expect(tones(b, "Equity Fund · post-tax IRR")).toBe("success");
    expect(tones(b, "54EC Bond · post-tax IRR")).toBe("brand");
    const [t] = tables(b);
    expect(t.head).toEqual(["", "54EC Bond", "Fixed Deposit", "Debt Fund", "Equity Fund"]);
    expect(t.rows[12]).toEqual(["Maturity after tax", "₹60,20,418", "₹54,10,816", "₹56,07,815", "₹72,93,339"]);
    expect(texts(b, "insight")[0]).toBe(
      "After tax, Equity Fund leaves the most: ₹72,93,339 after 5 years, a post-tax return of 7.84% on the original ₹50,00,000 gain. The 54EC bond would leave ₹60,20,418 (3.78%).",
    );
  });
  it("the opt-in other product, exemption, cess and indexation", () => {
    const input = {
      gain: 5_000_000, ltcgRatePct: 12.5, years: 5, bondRatePct: 5.25, slabPct: 30, indexationPct: 5, cessPct: 4,
      options: [
        { name: "Fixed Deposit", ratePct: 6, taxRatePct: 30, indexation: false, exemption: 0 },
        { name: "Debt Fund", ratePct: 7, taxRatePct: 30, indexation: true, exemption: 0 },
        { name: "Equity Fund", ratePct: 12, taxRatePct: 12.5, indexation: false, exemption: 125000 },
        { name: "REIT", ratePct: 9, taxRatePct: 20, indexation: false, exemption: 0 },
      ],
    };
    const w = webBond.capitalGainsBondVsOthers(input);
    expect(appBond.capitalGainsBondVsOthers(input)).toEqual(w);
    const b = run(DEFS.cgbond, { addCess: true, useExemption: true, debtIndexation: "yes", otherOn: true, otherName: "REIT", otherRate: 9, otherTax: 20 });
    expect(statOf(b, "REIT · post-tax IRR")).toBe(`${w[4].postTaxIrrPct!.toFixed(2)}%`);
    const [t] = tables(b);
    expect(t.rows[11]).toEqual(["Tax (incl. cess)", ...w.map((c) => inr(c.tax))]);
    expect(texts(b, "note")[0]).toContain("Indexation “Yes” is an estimate");
  });
});

describe("cii — Cost Inflation Index", () => {
  it("prints the web's default case", () => {
    const latest = webCii.latestCiiYear();
    const w = webCii.indexCost(1000000, 2010, latest);
    const b = run(DEFS.cii);
    expect(statOf(b, `CII 2010-11 → ${webCii.fyLabel(latest)}`)).toBe(`167 → ${w.ciiTo}`);
    expect(statOf(b, "Indexation factor")).toBe(`${w.factor.toFixed(4)}×`);
    expect(statOf(b, "Indexed cost")).toBe(inr(w.indexedCost));
    const [t] = tables(b);
    expect(t.rows).toHaveLength(webCii.ciiTable().length);
    expect(t.rows[0]).toEqual(["2001-02", "100", "Base year"]);
    expect(t.rows[1]).toEqual(["2002-03", "105", "5.0%"]);
  });
  it("a target year before the purchase year is an error", () => {
    const b = run(DEFS.cii, { fromFy: "2015", toFy: "2012" });
    expect(texts(b, "insight")).toEqual(["The target year must be the same as or later than the purchase year."]);
    expect(statOf(b, "Indexed cost")).toBeUndefined();
  });
  it("indexCost / ciiTable equal the web module", () => {
    expect(appCii.ciiTable()).toEqual(webCii.ciiTable());
    for (const [c, f, t] of [[2500000, 2003, 2020], [100000, 2001, 2001], [750000, 2019, 2024]]) {
      const w = webCii.indexCost(c, f, t);
      expect(appCii.indexCost(c, f, t)).toEqual(w);
      expect(statOf(run(DEFS.cii, { cost: c, fromFy: String(f), toFy: String(t) }), "Indexed cost")).toBe(inr(w.indexedCost));
    }
  });
});
