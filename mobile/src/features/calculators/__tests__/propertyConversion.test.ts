/**
 * Property & Assets and Investor Conversion: each def against the web CRM —
 * the web module run on the same inputs (webModule) and the reference figures
 * the web component / module documents in its header.
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables, defaults } from "../testing/helpers";
import { DEFS } from "../defs/propertyConversion";
import * as appPy from "../web/property-yield";
import * as appDf from "../web/debt-fund-benefit";
import * as appEs from "../web/emi-sip";
import * as appAa from "../web/asset-allocation-fv";
import * as appLe from "../web/loan-emi";
import * as appCv from "../web/conversion";
import * as appGp from "../web/goal-planning-calc";
import { inr, inrCompact } from "../fmt";
import type { ResultBlock } from "../types";

const webPy = webModule<typeof appPy>("calculators/property-yield");
const webDf = webModule<typeof appDf>("calculators/debt-fund-benefit");
const webEs = webModule<typeof appEs>("calculators/emi-sip");
const webAa = webModule<typeof appAa>("calculators/asset-allocation-fv");
const webLe = webModule<typeof appLe>("calculators/loan-emi");
const webCv = webModule<typeof appCv>("calculators/conversion");
const webGp = webModule<typeof appGp>("goal-planning/calc");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));
/** Every stat value with this label, in order (a label can repeat across sections). */
const statsOf = (b: ResultBlock[], label: string) =>
  b.flatMap((x) => (x.type === "stat" && x.label === label ? [x.value] : []));
const labels = (b: ResultBlock[]) => b.flatMap((x) => (x.type === "stat" ? [x.label] : []));
/** The web's dateAfterMonths label, as the browser (en-IN) prints it. */
const webDate = (months: number) => webCv.dateAfterMonths(new Date(), months).label;

describe("every Property & Conversion def", () => {
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
  it("covers the twelve catalog keys", () => {
    expect(Object.keys(DEFS).sort()).toEqual(
      ["assetalloc", "crorepati", "crorerace", "debtfund", "emisip", "fdgap", "habit", "lifestyle", "loanemi", "moneylast", "property", "rentbuy"],
    );
  });
});

describe("property — Property Rental Yield & Reinvestment", () => {
  it("prints the web's reference case to the rupee", () => {
    // property-yield.ts: ₹1 Cr · 5% · ₹30,000 − ₹2,500 · 3% · 12% · 10 yrs →
    // property ₹1,62,88,946 · SIP ₹68,73,075 · total ₹2,31,62,020 · 8.76%.
    const b = run(DEFS.property);
    expect(statOf(b, "Property value after 10y")).toBe("₹1,62,88,946");
    expect(statOf(b, "SIP value from rental surplus")).toBe("₹68,73,075");
    expect(statOf(b, "Total combined wealth")).toBe("₹2,31,62,020");
    expect(statOf(b, "Overall yield")).toBe("8.76%");
    expect(statOf(b, "Appreciation-only return")).toBe("5.00% p.a.");
    expect(texts(b, "note")[0]).toBe("Net surplus = rent − maintenance = ₹27,500/mo.");
    expect(tables(b)[0].rows).toHaveLength(10);
  });
  it.each([
    { marketValue: 7500000, appreciationPct: 6.5, monthlyRent: 22000, monthlyMaintenance: 4000, annualIncrementPct: 5, investibleSurplus: 18000, sipReturnPct: 11, years: 15 },
    { marketValue: 25000000, appreciationPct: 4, monthlyRent: 60000, monthlyMaintenance: 8000, annualIncrementPct: 0, investibleSurplus: 30000, sipReturnPct: 13.5, years: 7 },
  ])("computePropertyYield equals the web module, typed surplus (%#)", (input) => {
    const w = webPy.computePropertyYield(input);
    expect(appPy.computePropertyYield(input)).toEqual(w);
    const b = run(DEFS.property, input);
    expect(statOf(b, "SIP value from rental surplus")).toBe(inr(w.sipValue));
    expect(statOf(b, "Total combined wealth")).toBe(inr(w.totalCombinedDisplay));
    expect(statOf(b, "Wealth from reinvestment")).toBe(inr(w.sipGain));
  });
  it("a blank surplus follows rent − maintenance", () => {
    const w = webPy.computePropertyYield({ marketValue: 10000000, appreciationPct: 5, monthlyRent: 40000, monthlyMaintenance: 5000, annualIncrementPct: 3, investibleSurplus: 35000, sipReturnPct: 12, years: 10 });
    expect(statOf(run(DEFS.property, { monthlyRent: 40000, monthlyMaintenance: 5000 }), "SIP value from rental surplus")).toBe(inr(w.sipValue));
  });
});

describe("debtfund — Debt Fund, Hold vs Sell", () => {
  it("prints the web's reference case to the rupee", () => {
    // debt-fund-benefit.ts: sell today tax ₹60,000 · net ₹11,40,000 · 5.81%;
    // hold to 21/07/2023: ₹12,48,661 · LTCG ₹91,036 · tax ₹18,207 · net ₹12,30,454 · 7.15% · 11.84%.
    const b = run(DEFS.debtfund);
    const w = webDf.computeDebtFundBenefit({
      purchaseDate: "2020-07-20", investmentAmount: 1000000, redemptionDate: "2022-11-14", currentMarketValue: 1200000,
      indexationRatePct: 5, expectedReturnPct: 6, shortTermTaxPct: 30, longTermTaxPct: 20, ltcgYears: 3,
    });
    expect(texts(b, "section")).toEqual(["If redeemed today · 14/11/2022", `If held to LTCG · 21/07/2023 (after ${w.remainingDays} days)`]);
    expect(statOf(b, "Taxable gain (at slab)")).toBe("₹2,00,000");
    expect(statOf(b, "Tax payable @ 30%")).toBe("₹60,000");
    expect(statsOf(b, "Net in hand")).toEqual(["₹11,40,000", "₹12,30,454"]);
    expect(statsOf(b, "Post-tax yield")).toEqual(["5.81%", "7.15%"]);
    expect(statOf(b, "Expected redemption amount")).toBe("₹12,48,661");
    expect(statOf(b, "Taxable long-term gain")).toBe("₹91,036");
    expect(statOf(b, "Tax payable @ 20%")).toBe("₹18,207");
    expect(statOf(b, `Indexed cost (${w.indexYears}y @ 5%)`)).toBe(inr(w.indexedCost));
    expect(texts(b, "insight")[0]).toContain("11.84%");
    expect(statOf(b, "Remaining wait")).toBe(`${w.remainingDays} days`);
  });
  it.each([
    // flat 12.5% regime (sale after 23 Jul 2024)
    { purchaseDate: "2022-06-15", investmentAmount: 500000, redemptionDate: "2024-03-10", currentMarketValue: 560000, indexationRatePct: 5, expectedReturnPct: 7, shortTermTaxPct: 30, longTermTaxPct: 20, ltcgYears: 3 },
    // slab units — nothing to wait for
    { purchaseDate: "2023-05-01", investmentAmount: 800000, redemptionDate: "2025-01-20", currentMarketValue: 900000, indexationRatePct: 5, expectedReturnPct: 7, shortTermTaxPct: 30, longTermTaxPct: 20, ltcgYears: 3 },
    // already long-term today
    { purchaseDate: "2018-01-10", investmentAmount: 300000, redemptionDate: "2022-02-01", currentMarketValue: 420000, indexationRatePct: 4.5, expectedReturnPct: 6, shortTermTaxPct: 20, longTermTaxPct: 20, ltcgYears: 3 },
  ])("computeDebtFundBenefit equals the web module (%#)", (input) => {
    const w = webDf.computeDebtFundBenefit(input);
    expect(appDf.computeDebtFundBenefit(input)).toEqual(w);
    const b = run(DEFS.debtfund, input);
    expect(statsOf(b, "Net in hand")[0]).toBe(inr(w.netIfSold));
    if (w.remainingDays > 0) {
      expect(statsOf(b, "Net in hand")[1]).toBe(inr(w.netIfHeld));
      expect(statOf(b, "Extra in hand")).toBe(inr(w.extraInHand));
    } else {
      expect(statsOf(b, "Net in hand")).toHaveLength(1);
      expect(texts(b, "insight")[0]).toBe(w.regime === "slab"
        ? "Bought on/after 1 Apr 2023: taxed at slab however long it is held — holding saves no tax."
        : "Already long-term — nothing to gain by waiting.");
    }
  });
  it("shows the web's error for bad dates", () => {
    expect(texts(run(DEFS.debtfund, { redemptionDate: "2019-01-01" }), "insight")).toEqual(["Redemption date is before the purchase date."]);
    expect(texts(run(DEFS.debtfund, { purchaseDate: "" }), "insight")).toEqual(["Enter valid purchase and redemption dates."]);
  });
});

describe("emisip — Recover Your EMIs through SIP", () => {
  it("prints the web's reference case, with the one-time lumpsum", () => {
    // emi-sip.ts: ₹25,00,000 · 9% · 15 yrs · 12% → EMI ₹25,357 · total ₹45,64,200 · SIP ₹9,590 (37.82%).
    const w = webEs.computeEmiSip({ mode: "loan", loanAmount: 2500000, interestRatePct: 9, emiAmount: 25357, tenureMonths: 180, sipReturnPct: 12 });
    const b = run(DEFS.emisip);
    expect(statOf(b, "Monthly EMI")).toBe("₹25,357");
    expect(statOf(b, "Total repayment")).toBe("₹45,64,200");
    expect(statOf(b, "Monthly SIP required @ 12.00%")).toBe("₹9,590");
    expect(statOf(b, "SIP as % of EMI")).toBe("37.82%");
    expect(statOf(b, "Or one-time lumpsum today @ 12.00%")).toBe(inr(w.lumpsumRequired));
    expect(statOf(b, "Lumpsum grows to (recovers)")).toBe("₹45,64,200");
    expect(texts(b, "insight")[0]).toContain(`A one-time lumpsum of ${inr(w.lumpsumRequired)} invested today does the same.`);
  });
  it.each([
    { mode: "emi" as const, loanAmount: 0, interestRatePct: 0, emiAmount: 18000, tenureMonths: 96, sipReturnPct: 11 },
    { mode: "loan" as const, loanAmount: 1200000, interestRatePct: 10.5, emiAmount: 0, tenureMonths: 70, sipReturnPct: 13 },
  ])("computeEmiSip equals the web module (%#)", (input) => {
    const w = webEs.computeEmiSip(input);
    expect(appEs.computeEmiSip(input)).toEqual(w);
    const months = input.tenureMonths;
    const b = run(DEFS.emisip, {
      mode: input.mode, loanAmount: input.loanAmount, interestRatePct: input.interestRatePct, emiAmount: input.emiAmount,
      tenureUnit: "months", tenureValue: months, emiTenureValue: months, sipReturnPct: input.sipReturnPct,
    });
    expect(statOf(b, `Monthly SIP required @ ${input.sipReturnPct.toFixed(2)}%`)).toBe(inr(w.monthlySipRequired));
    expect(statOf(b, `Or one-time lumpsum today @ ${input.sipReturnPct.toFixed(2)}%`)).toBe(inr(w.lumpsumRequired));
    expect(statOf(b, "Monthly EMI")).toBe(input.mode === "loan" ? inr(w.monthlyEmi) : undefined);
  });
  it("prints the suggested schemes only when switched on", () => {
    const picks = { scheme1: { code: "1", name: "Fund A" }, scheme2: { code: "2", name: "Fund B" } };
    expect(texts(run(DEFS.emisip, { addSchemes: true, ...picks }), "note")[0]).toBe("Fund A, Fund B");
    expect(texts(run(DEFS.emisip, picks), "section")).toEqual([]);
  });
});

describe("assetalloc — Asset Allocation Future Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // asset-allocation-fv.ts: ₹10,00,000 · 15 yrs → ₹38,13,664 · 9.33% and ₹46,49,929 · 10.79%.
    const b = run(DEFS.assetalloc);
    expect(statsOf(b, "Future value")).toEqual(["₹38,13,664", "₹46,49,929"]);
    expect(statsOf(b, "Blended return")).toEqual(["9.33%", "10.79%"]);
    expect(statsOf(b, "Total allocation")).toEqual(["100%", "100%"]);
    expect(texts(b, "insight")).toEqual([
      `Scenario 1 grows ₹10,00,000 to ₹38,13,664 (9.33%). Scenario 2 reaches ₹46,49,929 (10.79%) — a difference of ${defaultDiff()} on the same investment & tenure.`,
    ]);
    const t = tables(b)[0];
    expect(t.head).toEqual(["Year", "Scenario 1", "Scenario 2"]);
    expect(t.rows).toHaveLength(15);
    expect(t.rows[14]).toEqual(["15", "₹38,13,664", "₹46,49,929"]);
  });
  it("offers the next asset slot once the last one has an allocation", () => {
    const v = defaults(DEFS.assetalloc);
    const shown = (key: string, over: Record<string, any> = {}) =>
      DEFS.assetalloc.inputs.find((i) => i.key === key)!.visibleIf!({ ...v, ...over });
    expect(shown("s1a5")).toBe(true);
    expect(shown("s1a6")).toBe(false);
    expect(shown("s1a6", { s1a5: 10 })).toBe(true);
    expect(shown("s2a1", { s2enabled: false })).toBe(false);
  });
  it.each([
    {
      initialInvestment: 2500000, years: 12,
      scenario1: [{ assetClass: "equity", ratePct: 13, allocationPct: 70 }, { assetClass: "liquid", ratePct: 5.5, allocationPct: 30 }],
      scenario2: [{ assetClass: "international", ratePct: 11, allocationPct: 50 }, { assetClass: "reits", ratePct: 9, allocationPct: 45 }],
    },
    {
      initialInvestment: 400000, years: 7.5,
      scenario1: [{ assetClass: "gold", ratePct: 8, allocationPct: 100 }],
      scenario2: null,
    },
  ])("computeAssetAllocationFv equals the web module (%#)", (input) => {
    const w = webAa.computeAssetAllocationFv(input);
    expect(appAa.computeAssetAllocationFv(input)).toEqual(w);
    const over: Record<string, any> = { initialInvestment: input.initialInvestment, years: input.years, s2enabled: !!input.scenario2 };
    for (let i = 1; i <= 8; i++) {
      for (const [sc, rows] of [["s1", input.scenario1], ["s2", input.scenario2 ?? []]] as const) {
        const r = rows[i - 1];
        over[`${sc}c${i}`] = r?.assetClass ?? "equity";
        over[`${sc}r${i}`] = r?.ratePct ?? 12;
        over[`${sc}a${i}`] = r?.allocationPct ?? 0;
      }
    }
    const b = run(DEFS.assetalloc, over);
    expect(statOf(b, "Future value")).toBe(inr(w.scenario1.futureValue));
    expect(statsOf(b, "Total allocation")).toEqual([`${w.scenario1.totalAllocationPct}%`, ...(w.scenario2 ? [`${w.scenario2.totalAllocationPct}%`] : [])]);
    if (w.scenario2) {
      expect(statsOf(b, "Future value")[1]).toBe(inr(w.scenario2.futureValue));
      expect(texts(b, "insight")).toEqual(["Set both allocations to 100% to compare them on the same investment."]);
    } else {
      expect(texts(b, "section")).toEqual(["Scenario 1", "Year-wise projected portfolio value (7 years)"]);
    }
  });
});

/** The rupee difference the default comparison prints, from the web module. */
function defaultDiff(): string {
  const w = webAa.computeAssetAllocationFv({
    initialInvestment: 1000000, years: 15,
    scenario1: [{ assetClass: "bonds", ratePct: 6, allocationPct: 20 }, { assetClass: "debt", ratePct: 7, allocationPct: 30 }, { assetClass: "equity", ratePct: 12, allocationPct: 40 }, { assetClass: "gold", ratePct: 8, allocationPct: 10 }],
    scenario2: [{ assetClass: "equity", ratePct: 12, allocationPct: 60 }, { assetClass: "hybrid", ratePct: 9, allocationPct: 25 }, { assetClass: "gold", ratePct: 8, allocationPct: 10 }, { assetClass: "debt", ratePct: 7, allocationPct: 5 }],
  });
  return inr(Math.abs(w.scenario2!.futureValue - w.scenario1.futureValue));
}

describe("loanemi — Loan EMI", () => {
  it("prints the web's reference EMI", () => {
    // loan-emi.ts: ₹10,00,000 at 10% for 20 years → EMI ₹9,650.
    expect(statOf(run(DEFS.loanemi, { homeAmount: 1000000, homeRate: 10, homeYears: 20 }), "Monthly EMI")).toBe("₹9,650");
  });
  it("prints the web's default (home loan) case", () => {
    const w = webLe.loanEmi({ amount: 5000000, annualRatePct: 8.5, years: 20, months: 0, moratoriumMonths: 0, prepayment: null });
    const b = run(DEFS.loanemi);
    expect(statOf(b, "Monthly EMI")).toBe(inr(w.emi));
    expect(statOf(b, "Total interest")).toBe(inr(w.totalInterest));
    expect(statOf(b, "Total payment")).toBe(inr(w.totalPayment));
    expect(statOf(b, "Repayment period")).toBe("20 yrs");
    const share = (5000000 / (5000000 + w.totalInterest)) * 100;
    expect(statOf(b, "Principal")).toBe(`₹50,00,000 (${share.toFixed(1)}%)`);
    expect(texts(b, "section")).toEqual(["1. Where the money goes", "2. Amortisation schedule"]);
    const t = tables(b)[0];
    expect(t.head).toEqual(["Year", "Opening balance", "EMIs paid", "Interest", "Principal", "Closing balance"]);
    expect(t.rows).toHaveLength(20);
    expect(t.rows[0][3]).toBe(inr(w.schedule.yearly[0].interest));
    expect(texts(b, "insight")[0]).toBe(`An EMI of ${inr(w.emi)} for 20 yrs at 8.5% repays ₹50,00,000 with ${inr(w.totalInterest)} of interest — every ₹1 borrowed costs ₹${(w.totalPayment / 5000000).toFixed(2)} in all.`);
  });
  it.each([
    { type: "education", input: { amount: 1500000, annualRatePct: 10, years: 10, months: 0, moratoriumMonths: 48, prepayment: null } },
    { type: "car", input: { amount: 800000, annualRatePct: 9.5, years: 7, months: 0, moratoriumMonths: 0, prepayment: { amount: 80000, month: 24, mode: "reduce_tenure" as const } } },
    { type: "personal", input: { amount: 650000, annualRatePct: 13, years: 4, months: 6, moratoriumMonths: 0, prepayment: { amount: 100000, month: 12, mode: "reduce_emi" as const } } },
  ])("loanEmi equals the web module ($type)", ({ type, input }) => {
    const w = webLe.loanEmi(input);
    expect(appLe.loanEmi(input)).toEqual(w);
    const b = run(DEFS.loanemi, {
      loanType: type, [`${type}Amount`]: input.amount, [`${type}Rate`]: input.annualRatePct, [`${type}Years`]: input.years,
      [`${type}Months`]: input.months, moratorium: input.moratoriumMonths, usePrepay: !!input.prepayment,
      [`${type}PrepayAmt`]: input.prepayment?.amount ?? 0, prepayMonth: input.prepayment?.month ?? 24,
      prepayMode: input.prepayment?.mode ?? "reduce_tenure", schedule: "monthly",
    });
    expect(statOf(b, "Monthly EMI")).toBe(inr(w.emi));
    expect(statOf(b, "Total interest")).toBe(inr(w.totalInterest));
    if (input.moratoriumMonths > 0) {
      expect(statOf(b, "Interest during moratorium")).toBe(inr(w.moratoriumInterest));
      expect(statOf(b, "Owed when EMIs start")).toBe(inr(w.repayPrincipal));
    }
    if (w.prepay) {
      expect(statOf(b, "Interest saved")).toBe(inr(w.prepay.interestSaved));
      if (w.prepay.mode === "reduce_emi") expect(statOf(b, "New EMI")).toBe(inr(w.prepay.newEmi));
      else expect(statOf(b, "Loan ends sooner by")).toBeDefined();
    }
    const t = tables(b)[0];
    expect(t.head[0]).toBe("EMI no.");
    expect(t.head.includes("Prepayment")).toBe(!!w.prepay);
    expect(t.rows).toHaveLength(w.schedule.monthly.length);
  });
  it("each loan type starts from its own preset", () => {
    for (const t of ["home", "personal", "car", "education"] as const) {
      const p = webLe.LOAN_PRESETS[t];
      const w = webLe.loanEmi({ amount: p.amount, annualRatePct: p.ratePct, years: p.years, months: p.months, moratoriumMonths: p.moratoriumMonths, prepayment: null });
      expect(statOf(run(DEFS.loanemi, { loanType: t }), "Monthly EMI")).toBe(inr(w.emi));
    }
  });
  it("warns when the prepayment falls outside the tenure", () => {
    const b = run(DEFS.loanemi, { usePrepay: true, prepayMonth: 300 });
    expect(texts(b, "insight")[0]).toBe("The prepayment must be paid with an EMI between 1 and 240.");
    expect(statOf(b, "Interest saved")).toBeUndefined();
  });
});

describe("crorepati — Crorepati Countdown", () => {
  it("prints the web's default case", () => {
    const m = webCv.monthsToTarget({ monthlySip: 25000, lumpsum: 0, annualReturnPct: 12, target: 10000000 })!;
    const b = run(DEFS.crorepati);
    expect(statOf(b, "You hit ₹1.00 Cr in")).toBe(webDate(m));
    expect(statOf(b, "Time to goal")).toBe(`${(m / 12).toFixed(1)} yrs`);
    expect(statOf(b, "You invest")).toBe(inr(25000 * m));
    expect(statOf(b, "Goal corpus")).toBe(inr(Math.round(webGp.fvSip(25000, 12, m))));
    const t = tables(b)[0];
    expect(t.rows.map((r) => r[0])).toEqual(["₹10.0 L", "₹25.0 L", "₹50.0 L", "₹1.00 Cr"]);
    const m10 = webCv.monthsToTarget({ monthlySip: 25000, lumpsum: 0, annualReturnPct: 12, target: 1000000 })!;
    expect(t.rows[0]).toEqual(["₹10.0 L", webDate(m10), `${(m10 / 12).toFixed(1)} yrs`]);
  });
  it.each([
    { monthlySip: 10000, lumpsum: 500000, annualReturnPct: 11, target: 20000000 },
    { monthlySip: 60000, lumpsum: 2500000, annualReturnPct: 13.5, target: 50000000 },
  ])("monthsToTarget equals the web module (%#)", (p) => {
    const m = webCv.monthsToTarget(p);
    expect(appCv.monthsToTarget(p)).toBe(m);
    const b = run(DEFS.crorepati, { sip: p.monthlySip, lumpsum: p.lumpsum, returnPct: p.annualReturnPct, target: String(p.target) });
    expect(statOf(b, `You hit ${inrCompact(p.target)} in`)).toBe(webDate(m!));
    expect(statOf(b, "You invest")).toBe(inr(p.lumpsum + p.monthlySip * m!));
    expect(statOf(b, "Goal corpus")).toBe(inr(Math.round(webGp.fvLumpsum(p.lumpsum, p.annualReturnPct, m!) + webGp.fvSip(p.monthlySip, p.annualReturnPct, m!))));
  });
  it("says when the goal is out of reach", () => {
    expect(run(DEFS.crorepati, { sip: 0 })).toEqual([
      { type: "insight", tone: "warning", text: "At these inputs the goal isn’t reached within 60 years. Increase the SIP, add a lumpsum, or extend the horizon." },
    ]);
  });
});

describe("habit — Small Habit, Big Corpus", () => {
  it("prints the web's default case (₹150 a day)", () => {
    const w = webCv.habitToCorpus({ monthlyAmount: 4500, annualReturnPct: 12, years: 30 });
    const b = run(DEFS.habit);
    expect(statOf(b, "That's per month")).toBe("₹4,500");
    expect(statOf(b, "If you just spend it")).toBe("₹16,20,000");
    expect(statOf(b, "If you invest it (30 yrs)")).toBe(inr(Math.round(w.corpus)));
    expect(texts(b, "insight")[0]).toBe(`That ₹150 per day habit is ₹4,500/month. Invested at 12% for 30 years it becomes ${inrCompact(w.corpus)} — a ${inrCompact(w.gain)} wealth gain over simply spending it.`);
  });
  it.each([
    { habit: "eatingout", amount: 2000, freq: "weekly", perMonth: 4.333, years: 20, returnPct: 11 },
    { habit: "ott", amount: 1500, freq: "monthly", perMonth: 1, years: 25, returnPct: 12.5 },
    { habit: "custom", amount: 700, freq: "weekly", perMonth: 4.333, years: 15, returnPct: 10 },
  ])("habitToCorpus equals the web module ($habit)", (c) => {
    const input = { monthlyAmount: c.amount * c.perMonth, annualReturnPct: c.returnPct, years: c.years };
    const w = webCv.habitToCorpus(input);
    expect(appCv.habitToCorpus(input)).toEqual(w);
    const b = run(DEFS.habit, { habit: c.habit, [`${c.habit}Amount`]: c.amount, [`${c.habit}Freq`]: c.freq, years: c.years, returnPct: c.returnPct });
    expect(statOf(b, "That's per month")).toBe(inr(Math.round(w.monthly)));
    expect(statOf(b, `If you invest it (${c.years} yrs)`)).toBe(inr(Math.round(w.corpus)));
  });
});

describe("fdgap — FD vs Equity Gap", () => {
  it.each([
    { lumpsum: 1000000, monthlySip: 20000, years: 20, fdRatePct: 6.5, equityRatePct: 12 },
    { lumpsum: 0, monthlySip: 7500, years: 12, fdRatePct: 7.25, equityRatePct: 11 },
    { lumpsum: 3000000, monthlySip: 0, years: 8, fdRatePct: 7, equityRatePct: 6 },
  ])("fdVsEquity equals the web module (%#)", (input) => {
    const w = webCv.fdVsEquity(input);
    expect(appCv.fdVsEquity(input)).toEqual(w);
    const b = run(DEFS.fdgap, { lumpsum: input.lumpsum, sip: input.monthlySip, years: input.years, fdRate: input.fdRatePct, equityRate: input.equityRatePct });
    expect(statOf(b, "In a bank FD")).toBe(inr(Math.round(w.fd)));
    expect(statOf(b, "In equity")).toBe(inr(Math.round(w.eq)));
    expect(statOf(b, "Wealth gap")).toBe(inrCompact(w.gap));
    expect(texts(b, "insight")[0]).toContain(w.gap >= 0 ? "gap in equity's favour" : "gap in the FD's favour");
  });
  it("defaults are the web's", () => {
    const w = webCv.fdVsEquity({ lumpsum: 1000000, monthlySip: 20000, years: 20, fdRatePct: 6.5, equityRatePct: 12 });
    expect(texts(run(DEFS.fdgap), "insight")[0]).toBe(`On ${inr(w.invested)} invested, equity grows to ${inrCompact(w.eq)} versus ${inrCompact(w.fd)} in an FD over 20 years — about ${(w.eq / w.fd).toFixed(1)}×, a ${inrCompact(w.gap)} gap in equity's favour. FD interest is also fully taxable at slab rate.`);
  });
});

describe("rentbuy — Rent vs Buy", () => {
  const base = { homePrice: 10000000, downPaymentPct: 20, loanRatePct: 8.5, loanYears: 20, homeAppreciationPct: 7, maintenancePctPerYear: 1, monthlyRent: 30000, rentInflationPct: 7, equityReturnPct: 12, horizonYears: 20 };
  it.each([
    base,
    { ...base, homeAppreciationPct: 9, equityReturnPct: 10, horizonYears: 25 },
    { ...base, monthlyRent: 60000, loanYears: 15, horizonYears: 30 },
  ])("rentVsBuy equals the web module (%#)", (input) => {
    const w = webCv.rentVsBuy(input);
    expect(appCv.rentVsBuy(input)).toEqual(w);
    const b = run(DEFS.rentbuy, {
      homePrice: input.homePrice, downPct: input.downPaymentPct, loanRate: input.loanRatePct, loanYears: input.loanYears,
      appreciation: input.homeAppreciationPct, maintenance: input.maintenancePctPerYear, rent: input.monthlyRent,
      rentInflation: input.rentInflationPct, equityReturn: input.equityReturnPct, horizon: input.horizonYears,
    });
    expect(statOf(b, "Home loan EMI")).toBe(`${inr(Math.round(w.emi))}/mo`);
    expect(statOf(b, `Buy — net worth in ${input.horizonYears} yrs`)).toBe(inr(Math.round(w.buyNetWorth)));
    expect(statOf(b, "Rent + invest — net worth")).toBe(inr(Math.round(w.rentNetWorth)));
    expect(texts(b, "insight")[0]).toContain(`comes out ahead by ${inrCompact(Math.abs(w.buyNetWorth - w.rentNetWorth))}`);
  });
});

describe("lifestyle — Inflation Lifestyle Shock", () => {
  it.each([
    { monthlyExpenseToday: 75000, inflationPct: 6, yearsToRetire: 25, retirementYears: 25, postReturnPct: 9 },
    { monthlyExpenseToday: 120000, inflationPct: 7, yearsToRetire: 15, retirementYears: 30, postReturnPct: 7 },
  ])("lifestyleShock equals the web module (%#)", (input) => {
    const w = webCv.lifestyleShock(input);
    expect(appCv.lifestyleShock(input)).toEqual(w);
    const b = run(DEFS.lifestyle, {
      monthlyExpense: input.monthlyExpenseToday, inflation: input.inflationPct, yearsToRetire: input.yearsToRetire,
      retirementYears: input.retirementYears, postReturn: input.postReturnPct,
    });
    expect(statOf(b, `In ${input.yearsToRetire} years, the same lifestyle costs`)).toBe(`${inr(Math.round(w.futureMonthly))}/mo`);
    expect(statOf(b, "Corpus to sustain it")).toBe(inrCompact(w.corpusNeeded));
    expect(texts(b, "insight")[0]).toContain(`you’ll need a corpus of ${inrCompact(w.corpusNeeded)}`);
  });
});

describe("moneylast — Will My Money Last?", () => {
  it("prints the web's default case", () => {
    const w = webCv.moneyLast({ corpus: 30000000, currentAge: 60, monthlyWithdrawal: 150000, annualReturnPct: 8, withdrawalInflationPct: 6, lifeExpectancy: 85 });
    const b = run(DEFS.moneylast);
    const head = b[0];
    expect(head.type === "stat" && head.label).toBe(w.lastsForLife ? "The money outlives the plan" : "The money runs out early");
    expect(statOf(b, "Starting corpus")).toBe("₹3.00 Cr");
    expect(statOf(b, "First-year withdrawal")).toBe("₹1,50,000/mo");
    const t = tables(b)[0];
    expect(t.rows).toHaveLength(w.schedule.length);
    expect(t.rows[0]).toEqual([`Age ${Math.round(w.schedule[0].age)}`, inrCompact(w.schedule[0].opening), inrCompact(w.schedule[0].withdrawn), inrCompact(w.schedule[0].growth), inrCompact(w.schedule[0].balance)]);
  });
  it.each([
    { corpus: 20000000, currentAge: 58, monthlyWithdrawal: 200000, annualReturnPct: 7, withdrawalInflationPct: 6, lifeExpectancy: 90 },
    { corpus: 50000000, currentAge: 62, monthlyWithdrawal: 100000, annualReturnPct: 9, withdrawalInflationPct: 5, lifeExpectancy: 85 },
  ])("moneyLast equals the web module (%#)", (input) => {
    const w = webCv.moneyLast(input);
    expect(appCv.moneyLast(input)).toEqual(w);
    const b = run(DEFS.moneylast, {
      corpus: input.corpus, currentAge: input.currentAge, withdrawal: input.monthlyWithdrawal, returnPct: input.annualReturnPct,
      withdrawalInflation: input.withdrawalInflationPct, lifeExpectancy: input.lifeExpectancy,
    });
    const lasts = w.runsOutAge == null ? "Lifetime" : `${w.yearsLasted.toFixed(0)} yrs`;
    expect(statOf(b, "Lasts for")).toBe(lasts);
    if (!w.lastsForLife) {
      expect(statOf(b, "The money runs out early")).toBe(`Runs out at age ${Math.floor(w.runsOutAge!)}`);
      expect(texts(b, "insight")[0]).toContain(`the corpus runs dry at age ${Math.floor(w.runsOutAge!)}`);
    } else {
      expect(statOf(b, "The money outlives the plan")).toMatch(/^Lasts/);
    }
    expect(tables(b)[0].rows.at(-1)![4]).toBe(inrCompact(w.schedule.at(-1)!.balance));
  });
});

describe("crorerace — ₹1 Crore Race", () => {
  it("prints the web's default race", () => {
    const race = webCv.croreRace({ sipAmounts: [5000, 10000, 25000, 50000, 100000], lumpsum: 0, annualReturnPct: 12, target: 10000000 });
    const b = run(DEFS.crorerace);
    expect(tables(b)[0].rows).toEqual(race.map((r) => [
      `${inr(r.sip)}/mo`,
      r.months != null ? `${(r.months / 12).toFixed(1)} yrs` : "60+ yrs",
      r.months != null ? webDate(r.months) : "—",
    ]));
    const mine = race[2];
    expect(texts(b, "insight")[0]).toBe(`At ₹25,000/month, your client reaches ₹1.00 Cr in ${(mine.months! / 12).toFixed(1)} years (by ${webDate(mine.months!)}). Doubling the SIP doesn’t take half the time — but it gets there meaningfully sooner. Pick the finish line, then the SIP.`);
  });
  it.each([
    { sipAmounts: [5000, 10000, 25000, 30000, 50000, 100000], lumpsum: 300000, annualReturnPct: 11, target: 20000000, yours: 30000 },
    { sipAmounts: [5000, 10000, 25000, 50000, 100000], lumpsum: 0, annualReturnPct: 1, target: 50000000, yours: 5000 },
  ])("croreRace equals the web module (%#)", ({ yours, ...p }) => {
    const w = webCv.croreRace(p);
    expect(appCv.croreRace(p)).toEqual(w);
    const b = run(DEFS.crorerace, { yourSip: yours, lumpsum: p.lumpsum, returnPct: p.annualReturnPct, target: String(p.target) });
    const rows = tables(b)[0].rows;
    expect(rows.map((r) => r[0])).toEqual(p.sipAmounts.map((s) => `${inr(s)}/mo`));
    const y = w.find((r) => r.sip === yours)!;
    const said = texts(b, "insight")[0];
    if (y.months != null) expect(said).toContain(`reaches ${inrCompact(p.target)} in ${(y.months / 12).toFixed(1)} years (by ${webDate(y.months)})`);
    else expect(said).toBe(`At ${inr(yours)}/month the goal isn’t reached within 60 years — step up the SIP or add a lumpsum.`);
  });
});
