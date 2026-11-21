/**
 * Income & Withdrawal (SWP/STP): each def against the web CRM — the web module
 * run on the same inputs (webModule) and the reference figures the web
 * component documents in its header.
 */

import { webModule } from "../testing/webModules";
import { defaults, run, statOf, tables } from "../testing/helpers";
import { DEFS } from "../defs/income";
import * as appIb from "../web/income-bridge";
import * as appPer from "../web/swp-periodic";
import * as appEnd from "../web/swp-end-period";
import * as appSwpc from "../web/swp-comprehensive";
import * as appStp from "../web/stp-comprehensive";
import * as appGp from "../web/goal-planning-calc";
import * as appTgt from "../web/swp-target";
import * as appPros from "../web/prosperity-multiplier";
import * as appReb from "../web/swp-rebalance";
import { inr, fmtPct } from "../fmt";
import type { ResultBlock } from "../types";

const webIb = webModule<typeof appIb>("calculators/income-bridge");
const webPer = webModule<typeof appPer>("calculators/swp-periodic");
const webEnd = webModule<typeof appEnd>("calculators/swp-end-period");
const webSwpc = webModule<typeof appSwpc>("calculators/swp-comprehensive");
const webStp = webModule<typeof appStp>("calculators/stp-comprehensive");
const webGp = webModule<typeof appGp>("goal-planning/calc");
const webTgt = webModule<typeof appTgt>("calculators/swp-target");
const webPros = webModule<typeof appPros>("calculators/prosperity-multiplier");
const webReb = webModule<typeof appReb>("calculators/swp-rebalance");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));

describe("every Income & Withdrawal def", () => {
  it("covers the group's twelve catalog keys", () => {
    expect(Object.keys(DEFS).sort()).toEqual(
      ["bridge", "opm", "prosperity", "sipforswp", "stp", "stpcomp", "swp", "swpcomp", "swpend", "swpneed", "swpperiodic", "swprebal"],
    );
  });
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
  // A web field whose label changes with another input is two specs under one
  // key; at most one of them may ever be on screen.
  it.each(Object.keys(DEFS))("%s never shows two inputs with the same key", (key) => {
    const body = DEFS[key];
    const base = defaults(body);
    const variants: Record<string, any>[] = [base];
    for (const i of body.inputs) {
      if (i.options) for (const o of i.options) variants.push({ ...base, [i.key]: o.value });
      if (i.type === "toggle") variants.push({ ...base, [i.key]: !i.default });
    }
    // Every pair of choices too (e.g. withdrawal option × frequency).
    const choices = body.inputs.filter((i) => i.options || i.type === "toggle");
    for (const a of choices) for (const b of choices) {
      const av = a.options ? a.options.map((o) => o.value) : [true, false];
      const bv = b.options ? b.options.map((o) => o.value) : [true, false];
      for (const x of av) for (const y of bv) variants.push({ ...base, [a.key]: x, [b.key]: y });
    }
    for (const v of variants) {
      const shown = body.inputs.filter((i) => !i.visibleIf || i.visibleIf(v)).map((i) => i.key);
      expect(new Set(shown).size).toBe(shown.length);
    }
  });
});

/* ───────────────────────── bridge ───────────────────────── */

const bridgeInput = (o: Partial<appIb.IncomeBridgeInput> = {}): appIb.IncomeBridgeInput => ({
  calcType: "monthly_swp", investMode: "sip", planningType: "retirement",
  startAge: 35, sipTillAge: 60, retirementAge: 60, swpTillAge: 85,
  monthlySip: 10000, topUpPct: 0, lumpsum: 1000000, monthlySalary: 150000, savingsPct: 20, salaryGrowthPct: 8,
  accumReturnPct: 12, distReturnPct: 9, distInflationPct: 0, endBalance: 10000000, desiredMonthlySwp: 50000,
  ...o,
});

describe("bridge — Income Bridge Planner", () => {
  it("prints the web's reference case to the rupee", () => {
    // IncomeBridgePlanner.tsx / income-bridge.ts: SIP ₹10,000 × 25y @12% → ₹1,70,22,066;
    // SWP 25y @9% leaving ₹1 cr → ₹1,29,323/mo, ₹3,87,96,786 in all.
    const b = run(DEFS.bridge);
    expect(statOf(b, "Accumulated corpus")).toBe("₹1,70,22,066");
    expect(statOf(b, "Monthly SWP")).toBe("₹1,29,323");
    expect(statOf(b, "Total withdrawal")).toBe("₹3,87,96,786");
    expect(statOf(b, "Total invested")).toBe("₹30,00,000");
    expect(statOf(b, "Phases")).toBe("25y build · 25y draw");
    const [acc, dist] = tables(b);
    expect(acc.rows).toHaveLength(25);
    expect(acc.rows[24]).toEqual(["60", "₹1,20,000", "₹1,70,22,066"]);
    expect(dist.head).toEqual(["Age", "Monthly SWP (avg)", "Year-end value", "Withdrawn that year"]);
    expect(dist.rows).toHaveLength(25);
    expect(texts(b, "section")).toEqual(["1. Accumulation — annual investment and year-end value", "2. Distribution — monthly withdrawal and year-end value"]);
  });
  it("prints the salary reference case to the rupee", () => {
    // income-bridge.ts: Salary ₹1,00,000 · 25% · +8%/yr · SIP 35→50, held to 60 @12% →
    // ₹5,70,32,643, invested ₹81,45,634; SWP to 80 @8%, 5% inflation, leave ₹1 cr →
    // first month ₹3,00,712, ₹12,20,30,233 withdrawn.
    const b = run(DEFS.bridge, {
      investMode: "salary", monthlySalary: 100000, savingsPct: 25, salaryGrowthPct: 8,
      sipTillAge: 50, swpTillAge: 80, distReturnPct: 8, distInflationPct: 5,
    });
    expect(statOf(b, "Accumulated corpus")).toBe("₹5,70,32,643");
    expect(statOf(b, "Total invested")).toBe("₹81,45,634");
    expect(statOf(b, "Monthly SWP (first month)")).toBe("₹3,00,712");
    expect(statOf(b, "Total withdrawal")).toBe("₹12,20,30,233");
  });
  it.each([
    bridgeInput({ topUpPct: 5, sipTillAge: 40, retirementAge: 50, swpTillAge: 90, distReturnPct: 7, distInflationPct: 5, monthlySip: 25000, endBalance: 6883098 }),
    bridgeInput({ calcType: "investment_need", investMode: "lumpsum_sip", desiredMonthlySwp: 80000, distInflationPct: 6 }),
    bridgeInput({ calcType: "investment_need", investMode: "salary", desiredMonthlySwp: 120000 }),
  ])("computeIncomeBridge equals the web module (%#)", (c) => {
    const w = webIb.computeIncomeBridge(c);
    expect(appIb.computeIncomeBridge(c)).toEqual(w);
    const b = run(DEFS.bridge, c);
    if (c.calcType === "monthly_swp") {
      expect(statOf(b, "Accumulated corpus")).toBe(inr(w.corpus));
      expect(statOf(b, /^Monthly SWP/)).toBe(inr(w.monthlySwp));
    } else {
      expect(statOf(b, "Corpus needed at SWP start")).toBe(inr(w.requiredCorpus!));
      expect(statOf(b, /^Monthly (SIP|investment) needed$/)).toBe(inr(w.requiredMonthlySip!));
      // The one-time lumpsum today beside the SIP (web f7f89a79).
      expect(statOf(b, /^Or (one-time|extra) lumpsum today/)).toBe(inr(w.lumpsumInsteadOfSip!));
      expect(texts(b, "insight").join(" ")).toContain(`${inr(w.lumpsumInsteadOfSip!)} invested today at 12% and left to grow.`);
    }
    expect(statOf(b, "Total withdrawal")).toBe(inr(w.totalWithdrawn));
  });
  it("tags every figure with its returns when scenario 2 is on", () => {
    const b = run(DEFS.bridge, { useS2: true });
    const w2 = webIb.computeIncomeBridge(bridgeInput({ accumReturnPct: 10, distReturnPct: 8 }));
    expect(statOf(b, "Accumulated corpus @ 12% / 9%")).toBe("₹1,70,22,066");
    expect(statOf(b, "Accumulated corpus @ 10% / 8%")).toBe(inr(w2.corpus));
    expect(statOf(b, "Monthly SWP @ 10% / 8%")).toBe(inr(w2.monthlySwp));
    expect(tables(b)[1].head).toEqual(["Age", "Monthly SWP (avg) @ 12% / 9%", "Year-end value @ 12% / 9%", "Monthly SWP (avg) @ 10% / 8%", "Year-end value @ 10% / 8%", "Withdrawn that year @ 12% / 9%"]);
  });
  it("warns when the end balance is out of reach", () => {
    const b = run(DEFS.bridge, { endBalance: 1e10 });
    expect(texts(b, "insight")[0]).toMatch(/^The balance you want to leave is larger/);
    expect(statOf(b, "Monthly SWP")).toBe("₹0");
  });
});

/* ───────────────────────── swpperiodic ───────────────────────── */

const periodicInput = (o: Partial<appPer.SwpPeriodicInput> = {}): appPer.SwpPeriodicInput => ({
  currentAge: 40, investMode: "sip", initialInvestment: 1000000, monthlySip: 10000, sipYears: 20,
  annualAmount: 120000, annualYears: 20, allocation: { debt: 0, hybrid: 0, equity: 100 }, returns: { debt: 7, hybrid: 9, equity: 12 },
  defermentRequired: false, distributionReturnPct: 8, defermentPeriodYears: 5,
  withdrawalIntervalYears: 2, numInstallments: 10, eachWithdrawalAmount: 100000,
  ...o,
});
const periodicDef = (c: appPer.SwpPeriodicInput) => ({
  currentAge: c.currentAge, investMode: c.investMode, initialInvestment: c.initialInvestment, monthlySip: c.monthlySip,
  sipYears: c.sipYears, annualAmount: c.annualAmount, annualYears: c.annualYears,
  allocDebt: c.allocation.debt, allocHybrid: c.allocation.hybrid, allocEquity: c.allocation.equity,
  retDebt: c.returns.debt, retHybrid: c.returns.hybrid, retEquity: c.returns.equity,
  defermentRequired: c.defermentRequired, distributionReturnPct: c.distributionReturnPct, defermentPeriodYears: c.defermentPeriodYears,
  withdrawalIntervalYears: c.withdrawalIntervalYears, numInstallments: c.numInstallments, eachWithdrawalAmount: c.eachWithdrawalAmount,
});

describe("swpperiodic — SWP Periodic Withdrawal Planner", () => {
  it("prints the web's reference case to the rupee", () => {
    // swp-periodic.ts: monthly SIP ₹10,000 · 20 yrs · 12% · ₹1,00,000 every 2 yrs × 10 →
    // year-1 fund ₹1,27,665 · end value ₹57,99,873.
    const b = run(DEFS.swpperiodic);
    expect(statOf(b, "End value")).toBe("₹57,99,873");
    expect(statOf(b, "Each withdrawal (every 2y)")).toBe("₹1,00,000");
    expect(statOf(b, "Total periodic withdrawal")).toBe("₹10,00,000");
    expect(statOf(b, "Total invested")).toBe("₹24,00,000");
    const t = tables(b)[0];
    expect(t.head[0]).toBe("Age");
    expect(t.rows[0]).toEqual(["41", "₹1,20,000", "₹0", "₹1,27,665"]);
    expect(t.rows[1][2]).toBe("₹1,00,000");
    expect(texts(b, "note")[0]).toBe("Asset allocation: Total 100% · Assumed return per class: Avg 12.00%");
  });
  it.each([
    periodicInput({ investMode: "lumpsum_sip", allocation: { debt: 30, hybrid: 20, equity: 50 }, defermentRequired: true, defermentPeriodYears: 8 }),
    periodicInput({ investMode: "annual_lumpsum", currentAge: 0, eachWithdrawalAmount: 900000, numInstallments: 12 }),
  ])("computeSwpPeriodic equals the web module (%#)", (c) => {
    const w = webPer.computeSwpPeriodic(c);
    expect(appPer.computeSwpPeriodic(c)).toEqual(w);
    const b = run(DEFS.swpperiodic, periodicDef(c));
    expect(statOf(b, "End value")).toBe(inr(w.endValue));
    expect(statOf(b, "Total invested")).toBe(inr(w.totalInvested));
    if (w.corpusDepleted) {
      expect(statOf(b, `Total withdrawn (of ${inr(w.plannedPeriodicWithdrawal)})`)).toBe(inr(w.totalPeriodicWithdrawal));
      expect(texts(b, "insight")[0]).toContain(`runs out in year ${w.depletedYear}`);
    }
    if (!c.currentAge) expect(tables(b)[0].head[0]).toBe("Year");
  });
});

/* ───────────────────────── swpend ───────────────────────── */

const endInput = (o: Partial<appEnd.SwpEndInput> = {}): appEnd.SwpEndInput => ({
  investmentType: "sip", initialInvestment: 25000, defermentRequired: true, defermentYears: 20,
  accumulationRatePct: 12, swpRatePct: 9, includeInflation: false, inflationPct: 6,
  swpMode: "amount", swpAmount: 200000, swpPercentage: 6,
  ...o,
});

describe("swpend — SWP End Period", () => {
  it("prints the web's reference case to the rupee", () => {
    // swp-end-period.ts: SIP ₹25,000/mo × 20y @12% → ₹2,29,96,434; SWP ₹2,00,000/mo @9%
    // lasts 245 months = 20 years 5 months, ₹1,37,225 left.
    const b = run(DEFS.swpend);
    expect(statOf(b, "Accumulated value (SWP start)")).toBe("₹2,29,96,434");
    expect(statOf(b, "SWP period")).toBe("20 years 5 months");
    expect(statOf(b, "Monthly withdrawal")).toBe("₹2,00,000");
    expect(texts(b, "insight")[0]).toBe("The ₹2,29,96,434 corpus sustains ₹2,00,000/month for 20 years 5 months at a 9% SWP-period return, leaving ₹1,37,225 — not enough for one more withdrawal.");
    const [acc, dist] = tables(b);
    expect(acc.rows).toHaveLength(20);
    expect(dist.rows).toHaveLength(20);
    expect(dist.rows[0][0]).toBe("21");
    expect(texts(b, "section")).toEqual(["1. Accumulation — annual investment and year-end value", "2. Distribution — monthly SWP and year-end balance"]);
  });
  it("relabels the amount and period for a lumpsum, as the web does", () => {
    const shown = DEFS.swpend.inputs.filter((i) => !i.visibleIf || i.visibleIf({ investmentType: "lumpsum", defermentRequired: true })).map((i) => i.label);
    expect(shown).toContain("Initial investment (₹)");
    expect(shown).toContain("Deferment period (yrs)");
    expect(shown).not.toContain("Monthly SIP (₹)");
  });
  it.each([
    endInput({ investmentType: "lumpsum", initialInvestment: 5000000, defermentRequired: false, swpAmount: 40000, includeInflation: true }),
    endInput({ investmentType: "lumpsum", initialInvestment: 3000000, defermentYears: 7, swpMode: "percentage", swpPercentage: 5 }),
    endInput({ swpAmount: 100000 }),
  ])("computeSwpEndPeriod equals the web module (%#)", (c) => {
    const w = webEnd.computeSwpEndPeriod(c);
    expect(appEnd.computeSwpEndPeriod(c)).toEqual(w);
    const b = run(DEFS.swpend, c);
    expect(statOf(b, "Accumulated value (SWP start)")).toBe(inr(w.accumulatedValue));
    expect(statOf(b, "Total withdrawn")).toBe(inr(w.totalWithdrawn));
    expect(statOf(b, "SWP period")).toBe(w.perpetual ? "100+ years (sustains indefinitely)" : `${Math.floor(w.monthsLasted! / 12)} years ${w.monthsLasted! % 12} months`);
  });
});

/* ───────────────────────── swpcomp ───────────────────────── */

const swpcInput = (o: Partial<appSwpc.SwpCompInput> = {}): appSwpc.SwpCompInput => ({
  investMode: "lumpsum", lumpsum: 5000000, monthlySip: 25000, accumulationYears: 15, accumulationReturnPct: 12,
  defermentYears: 0, distReturnPct: 9, swpYears: 15, frequency: "monthly", withdrawalMode: "percentage",
  withdrawalAmount: 29167, withdrawalAnnualPct: 7, increment: "none", incrementPct: 6, incrementAmount: 1000,
  ...o,
});

describe("swpcomp — SWP Comprehensive Planner", () => {
  it("prints the web's reference case", () => {
    // swp-comprehensive.ts: ₹50L lumpsum @9%, withdraw 7%/yr monthly for 15y → ₹29,167/mo,
    // final value ≈ ₹75.19L; max sustainable ≈ ₹49,674/mo (~11.9%/yr).
    const w = webSwpc.computeSwpComprehensive(swpcInput());
    const b = run(DEFS.swpcomp);
    expect(statOf(b, "Corpus at SWP start")).toBe("₹50,00,000");
    expect(statOf(b, "Withdrawal / month")).toBe("₹29,167");
    expect(statOf(b, "End value")).toBe(inr(w.finalValue));
    expect(statOf(b, "End value")).toMatch(/^₹75,1\d,\d{3}$/);
    expect(statOf(b, "Max sustainable / month")).toBe(inr(w.maxPerPeriodWithdrawal));
    expect(texts(b, "insight")[0]).toContain(`(${w.maxAnnualPct.toFixed(1)}%/yr)`);
    expect(w.maxAnnualPct.toFixed(1)).toBe("11.9");
    const [alloc, years] = tables(b);
    expect(alloc.rows).toEqual([["Hybrid", "100%", "9%"], ["Portfolio", "100%", "9.00%"]]);
    expect(years.head).toEqual(["Age", "Withdrawal / month", "Withdrawn that year", "Fund value at year-end"]);
    expect(years.rows[0][0]).toBe("61");
  });
  it("relabels the per-period amount with the frequency, as the web does", () => {
    const v = { investMode: "lumpsum", withdrawalMode: "amount", frequency: "quarterly", increment: "amount" };
    const shown = DEFS.swpcomp.inputs.filter((i) => !i.visibleIf || i.visibleIf(v)).map((i) => i.label);
    expect(shown).toContain("Withdrawal per quarter (₹)");
    expect(shown).toContain("Increment per quarter per year (₹)");
    expect(shown).not.toContain("Withdrawal per month (₹)");
  });
  it.each([
    swpcInput({ investMode: "lumpsum_sip", lumpsum: 1000000, defermentYears: 3, frequency: "quarterly", withdrawalMode: "amount", withdrawalAmount: 150000, increment: "percentage" }),
    swpcInput({ investMode: "sip", frequency: "annually", withdrawalMode: "amount", withdrawalAmount: 4000000, increment: "amount", incrementAmount: 50000 }),
  ])("computeSwpComprehensive equals the web module (%#)", (c) => {
    const w = webSwpc.computeSwpComprehensive(c);
    expect(appSwpc.computeSwpComprehensive(c)).toEqual(w);
    const per = appSwpc.FREQ_LABEL[c.frequency];
    const b = run(DEFS.swpcomp, {
      investMode: c.investMode, lumpsum: c.lumpsum, monthlySip: c.monthlySip, accumulationYears: c.accumulationYears,
      accumulationReturnPct: c.accumulationReturnPct, deferment: c.defermentYears > 0, defermentYears: c.defermentYears,
      swpYears: c.swpYears, frequency: c.frequency, withdrawalMode: c.withdrawalMode, withdrawalAmount: c.withdrawalAmount,
      withdrawalAnnualPct: c.withdrawalAnnualPct, increment: c.increment, incrementPct: c.incrementPct, incrementAmount: c.incrementAmount,
    });
    expect(statOf(b, "Corpus at SWP start")).toBe(inr(w.accumulatedCorpus));
    expect(statOf(b, `Max sustainable / ${per}`)).toBe(inr(w.maxPerPeriodWithdrawal));
    expect(statOf(b, "Total withdrawal")).toBe(inr(w.totalWithdrawn));
    if (w.depletedAtPeriod != null) expect(statOf(b, "End value (depleted)")).toBe("₹0");
    else expect(statOf(b, "End value")).toBe(inr(w.finalValue));
  });
  it("flags an allocation that does not total 100%", () => {
    const b = run(DEFS.swpcomp, { allocDebt: 30 });
    expect(texts(b, "insight")[0]).toBe("Allocation should total 100% (currently 130%).");
  });
});

/* ───────────────────────── stpcomp ───────────────────────── */

const stpcInput = (o: Partial<appStp.StpComprehensiveInput> = {}): appStp.StpComprehensiveInput => ({
  initialInvestment: 2500000, debtReturnPct: 5, equityReturnPct: 12, transferMode: "fixed", frequency: "weekly",
  numInstallments: 50, fixedBasis: "amount", fixedTransferAmount: 50000, fixedTransferPct: 2, totalMonths: 120,
  ...o,
});

describe("stpcomp — STP Comprehensive Planner", () => {
  it("prints the web's reference cases to the rupee", () => {
    // stp-comprehensive.ts: ₹25,00,000 · debt 5% · equity 12% · fixed ₹50,000 weekly × 50 · 10 yrs →
    // debt ₹95,911 · equity ₹73,48,509 · total ₹74,44,420 · 11.53%.
    const b = run(DEFS.stpcomp);
    expect(statOf(b, "Debt fund value")).toBe("₹95,911");
    expect(statOf(b, "Equity fund value")).toBe("₹73,48,509");
    expect(statOf(b, "Total fund value")).toBe("₹74,44,420");
    expect(statOf(b, "Annualised return")).toBe("11.53%");
    expect(texts(b, "note")[1]).toBe("Each transfer: ₹50,000. Total transferred to equity: ₹25,00,000 in 50 weekly transfer(s) over 520 period(s).");
    expect(tables(b)[0].rows).toHaveLength(10);
    expect(texts(b, "section")).toEqual(["1. Projected annual investment value"]);
    // ₹25,00,000 · fixed ₹50,000 monthly until exhausted · 10 yrs →
    // debt ₹1,586 · equity ₹67,21,922 · total ₹67,23,507 · 10.40%.
    const m = run(DEFS.stpcomp, { frequency: "monthly", numInstallments: 120 });
    expect(statOf(m, "Debt fund value")).toBe("₹1,586");
    expect(statOf(m, "Equity fund value")).toBe("₹67,21,922");
    expect(statOf(m, "Total fund value")).toBe("₹67,23,507");
    expect(statOf(m, "Annualised return")).toBe("10.40%");
    expect(texts(m, "insight")[0]).toMatch(/^The debt fund covers only \d+ of the 120 instalments; the remaining ₹1,586 is left in debt/);
  });
  it.each([
    stpcInput({ transferMode: "appreciation", frequency: "monthly", totalMonths: 180, initialInvestment: 1000000 }),
    stpcInput({ fixedBasis: "pctOfInitial", fixedTransferPct: 1.5, frequency: "fortnightly", numInstallments: 60, totalMonths: 30 }),
    stpcInput({ frequency: "quarterly", numInstallments: 8, fixedTransferAmount: 200000, totalMonths: 84 }),
  ])("computeStpComprehensive equals the web module (%#)", (c) => {
    const w = webStp.computeStpComprehensive(c);
    expect(appStp.computeStpComprehensive(c)).toEqual(w);
    const months = c.totalMonths % 12 === 0 ? { periodValue: c.totalMonths / 12, periodUnit: "years" } : { periodValue: c.totalMonths, periodUnit: "months" };
    const b = run(DEFS.stpcomp, { ...c, ...months });
    expect(statOf(b, "Total fund value")).toBe(inr(w.totalFinalValue));
    expect(statOf(b, "Equity fund value")).toBe(inr(w.equityFinalValue));
    expect(statOf(b, "Annualised return")).toBe(`${w.annualisedReturnPct.toFixed(2)}%`);
  });
  it("drops the year-wise table in the summary report", () => {
    expect(tables(run(DEFS.stpcomp, { report: "summary" }))).toHaveLength(0);
  });
});

/* ───────────────────────── opm ───────────────────────── */

describe("opm — OPM House (SWP)", () => {
  it("prints the web's reference case to the rupee", () => {
    // OpmHousePlanner.tsx: EMI ₹88,690.36 · total interest ₹1,12,85,686.52 · corpus left ₹2,03,10,747.42.
    const b = run(DEFS.opm);
    expect(statOf(b, "Monthly EMI")).toBe("₹88,690");
    expect(statOf(b, "Total interest")).toBe("₹1,12,85,687");
    expect(statOf(b, "Corpus left after 20 yrs")).toBe("₹2,03,10,747");
    expect(tables(b)[0].rows).toHaveLength(20);
    expect(texts(b, "insight")[0]).toContain("With a 3.2% spread (fund 12% vs loan 8.8%)");
  });
  it.each([
    { loanAmount: 5000000, loanRatePct: 9.5, tenureYears: 15, mfReturnPct: 13 },
    { loanAmount: 8000000, loanRatePct: 9, tenureYears: 25, mfReturnPct: 7 },
  ])("opmHouseStrategy equals the web module (%#)", (c) => {
    const w = webGp.opmHouseStrategy(c);
    expect(appGp.opmHouseStrategy(c)).toEqual(w);
    const b = run(DEFS.opm, { loanAmount: c.loanAmount, loanRate: c.loanRatePct, tenureYears: c.tenureYears, mfReturn: c.mfReturnPct });
    expect(statOf(b, "Monthly EMI")).toBe(inr(w.emi));
    if (w.corpusSurvived) expect(statOf(b, `Corpus left after ${c.tenureYears} yrs`)).toBe(inr(w.corpusLeft));
    else {
      expect(statOf(b, "Corpus runs out")).toBe(`Year ${w.depletedYear}`);
      expect(texts(b, "insight")[0]).toContain(`the SWP funds ${inr(w.swpPaid)} of the ${inr(w.totalPaid)} in EMIs`);
    }
  });
});

/* ───────────────────────── swp / swpneed / sipforswp ───────────────────────── */

const TAX: appTgt.SwpTax = { stPct: 20, stUptoYears: 1, ltPct: 12.5, ltFromYear: 2, indexationPct: 0 };

describe("swp — Monthly SWP from Lumpsum", () => {
  it("prints the web's reference case to the rupee", () => {
    // swp-target.ts: ₹1 cr · 25y · 9% · 5% inflation · leave ₹1 cr → first-year average SWP
    // ₹46,646, total ₹2,67,15,270; tax ST 20% (≤1y) / LT 12.5% → year-1 tax ₹5,110.
    const b = run(DEFS.swp);
    expect(statOf(b, "First-year average SWP @ 9%")).toBe("₹46,646");
    expect(statOf(b, "Total withdrawal @ 9%")).toBe("₹2,67,15,270");
    const [years, tax] = tables(b);
    expect(years.head).toEqual(["Age", "Monthly SWP (avg)", "Year-end value"]);
    expect(years.rows[0][0]).toBe("61");
    expect(years.rows[0][1]).toBe("₹46,646");
    expect(tax.rows[0][2]).toBe("₹5,110");
    expect(texts(b, "section")).toEqual(["1. Monthly withdrawal and investment value", "2. Annual tax and post-tax withdrawal @ 9%"]);
  });
  it.each([
    { lumpsum: 5000000, deferYears: 3, swpYears: 20, ratePct: 10, inflationPct: 0, endBalance: 0, currentAge: null, tax: null },
    { lumpsum: 20000000, deferYears: 0, swpYears: 30, ratePct: 8, inflationPct: 6, endBalance: 5000000, currentAge: 55, tax: { ...TAX, indexationPct: 4 } },
  ])("swpFromLumpsum equals the web module (%#)", (c) => {
    const w = webTgt.swpFromLumpsum(c);
    expect(appTgt.swpFromLumpsum(c)).toEqual(w);
    const b = run(DEFS.swp, {
      lumpsum: c.lumpsum, defer: c.deferYears > 0, deferYears: c.deferYears, swpYears: c.swpYears, rate1: c.ratePct,
      useInflation: c.inflationPct > 0, inflationPct: c.inflationPct, endBalance: c.endBalance, currentAge: c.currentAge ?? 0,
      useTax: !!c.tax, ...(c.tax ?? {}),
    });
    const lbl = c.inflationPct > 0 ? "First-year average SWP" : "Monthly SWP";
    expect(statOf(b, `${lbl} @ ${fmtPct(c.ratePct)}`)).toBe(inr(w.firstYearAvgSwp));
    expect(statOf(b, `Total withdrawal @ ${fmtPct(c.ratePct)}`)).toBe(inr(w.totalWithdrawal));
    if (c.tax) expect(texts(b, "insight")[0]).toContain(`Tax over the period comes to about ${inr(w.totalTax)}.`);
  });
  it("says when the balance asked for is out of reach", () => {
    const b = run(DEFS.swp, { endBalance: 1e10 });
    expect(texts(b, "insight")[0]).toMatch(/^The balance asked for is more than ₹1,00,00,000 grows to with no withdrawals at 9%/);
  });
});

describe("swpneed — Lumpsum for Monthly SWP", () => {
  it("prints the web's reference case to the rupee", () => {
    // swp-target.ts: ₹2,00,000/mo · 25y · 9% · 5% inflation · leave ₹1 cr → lumpsum ₹3,99,24,637,
    // total withdrawal ₹11,71,46,904.
    const b = run(DEFS.swpneed);
    expect(statOf(b, "Lumpsum needed today @ 9%")).toBe("₹3,99,24,637");
    expect(statOf(b, "Total withdrawal @ 9%")).toBe("₹11,71,46,904");
    expect(texts(b, "insight")[0]).toBe("To draw ₹2,00,000 a month (rising with 5% inflation) for 25 years and keep ₹1,00,00,000 at the end, invest ₹3,99,24,637 today at 9%.");
    // Tax is off by default here (on in "Monthly SWP from a Lumpsum").
    expect(texts(b, "section")).toEqual(["1. Monthly withdrawal and investment value"]);
  });
  it.each([
    { firstMonthlySwp: 75000, deferYears: 5, swpYears: 20, ratePct: 10, inflationPct: 6, endBalance: 0, currentAge: 50, tax: TAX },
    { firstMonthlySwp: 300000, deferYears: 0, swpYears: 15, ratePct: 7.5, inflationPct: 0, endBalance: 20000000, currentAge: null, tax: null },
  ])("lumpsumForSwp equals the web module (%#)", (c) => {
    const w = webTgt.lumpsumForSwp(c);
    expect(appTgt.lumpsumForSwp(c)).toEqual(w);
    const b = run(DEFS.swpneed, {
      monthlySwp: c.firstMonthlySwp, defer: c.deferYears > 0, deferYears: c.deferYears, swpYears: c.swpYears, rate1: c.ratePct,
      useRate2: true, rate2: 11, useInflation: c.inflationPct > 0, inflationPct: c.inflationPct, endBalance: c.endBalance,
      currentAge: c.currentAge ?? 0, useTax: !!c.tax,
    });
    const w2 = webTgt.lumpsumForSwp({ ...c, ratePct: 11 });
    expect(statOf(b, `Lumpsum needed today @ ${fmtPct(c.ratePct)}`)).toBe(inr(w.lumpsumToday));
    expect(statOf(b, "Lumpsum needed today @ 11%")).toBe(inr(w2.lumpsumToday));
    expect(tables(b)[0].head).toEqual([c.currentAge ? "Age" : "Year", `Monthly SWP (avg) @ ${fmtPct(c.ratePct)}`, `Year-end value @ ${fmtPct(c.ratePct)}`, "Monthly SWP (avg) @ 11%", "Year-end value @ 11%"]);
    if (c.deferYears > 0) expect(tables(b)[0].rows[0][1]).toBe("—");
  });
});

describe("sipforswp — SIP for Monthly SWP", () => {
  it("prints the web's reference case to the rupee, with the lumpsum beside the SIP", () => {
    // swp-target.ts: ₹1,00,000/mo · SIP 20y @12% · SWP 30y @7% · leave ₹50 L → corpus
    // ₹1,60,19,597, SIP ₹17,415.
    const w = webTgt.sipForSwp({ firstMonthlySwp: 100000, sipYears: 20, deferYears: 0, swpYears: 30, accPct: 12, distPct: 7, inflationPct: 0, endBalance: 5000000, currentAge: 40 });
    const b = run(DEFS.sipforswp);
    expect(statOf(b, "Corpus needed @ 12% / 7%")).toBe("₹1,60,19,597");
    expect(statOf(b, "Monthly SIP needed @ 12% / 7%")).toBe("₹17,415");
    expect(statOf(b, "One-time lumpsum today @ 12% / 7%")).toBe(inr(w.lumpsumToday));
    expect(statOf(b, "Total withdrawal @ 12% / 7%")).toBe(inr(w.totalWithdrawal));
    const [acc, dist] = tables(b);
    expect(acc.rows).toHaveLength(20);
    expect(acc.rows[19][0]).toBe("60");
    expect(dist.rows[0][0]).toBe("61");
    expect(texts(b, "insight")[0]).toContain(`or a one-time lumpsum of ${inr(w.lumpsumToday)} invested today at 12% grows to the same corpus by then.`);
  });
  it.each([
    { firstMonthlySwp: 60000, sipYears: 15, deferYears: 5, swpYears: 25, accPct: 13, distPct: 8, inflationPct: 5, endBalance: 0, currentAge: 35 },
    { firstMonthlySwp: 150000, sipYears: 25, deferYears: 0, swpYears: 20, accPct: 11, distPct: 6, inflationPct: 6, endBalance: 10000000, currentAge: null },
  ])("sipForSwp equals the web module (%#)", (c) => {
    const w = webTgt.sipForSwp(c);
    expect(appTgt.sipForSwp(c)).toEqual(w);
    const b = run(DEFS.sipforswp, {
      monthlySwp: c.firstMonthlySwp, sipYears: c.sipYears, defer: c.deferYears > 0, deferYears: c.deferYears, swpYears: c.swpYears,
      acc1: c.accPct, dist1: c.distPct, useInflation: c.inflationPct > 0, inflationPct: c.inflationPct, endBalance: c.endBalance,
      currentAge: c.currentAge ?? 0,
    });
    const tag = `${fmtPct(c.accPct)} / ${fmtPct(c.distPct)}`;
    expect(statOf(b, `Monthly SIP needed @ ${tag}`)).toBe(inr(w.monthlySip));
    expect(statOf(b, `One-time lumpsum today @ ${tag}`)).toBe(inr(w.lumpsumToday));
    expect(statOf(b, `Corpus needed @ ${tag}`)).toBe(inr(w.corpus));
  });
  it("warns when the SWP-phase return equals inflation", () => {
    const b = run(DEFS.sipforswp, { useInflation: true, inflationPct: 7 });
    expect(texts(b, "insight")[1]).toBe("The SWP-phase return equals inflation, so the withdrawal grows as fast as the money it is drawn from.");
  });
});

/* ───────────────────────── stp ───────────────────────── */

describe("stp — Future Value of STP", () => {
  it("prints the web's reference cases to the rupee", () => {
    // StpFutureValueCalculator.tsx: ₹25L · ₹50,000/month · 10 yrs · 5% / 12% → ₹67,23,507, 10.40% a year.
    const b = run(DEFS.stp);
    expect(statOf(b, "Total value")).toBe("₹67,23,507");
    expect(statOf(b, "Annualised return")).toBe("10.40%");
    expect(texts(b, "insight")[0]).toMatch(/^₹25,00,000 in a 5% debt fund, moving ₹50,000 every month into a 12% equity fund, could be worth ₹67,23,507 after 10 years\. The debt fund covers \d+ transfers; from month \d+ it holds less than one, so the remaining ₹1,586 stays in debt\.$/);
    expect(texts(b, "section")).toEqual(["1. Year-wise value of the plan"]);
    // stp-comprehensive.ts: ₹10,00,000 · appreciation · debt 5% · equity 12% · 15 yrs → ₹29,20,778.
    const a = run(DEFS.stp, { initial: 1000000, years: 15, transfer: "appreciation" });
    expect(statOf(a, "Total value")).toBe("₹29,20,778");
    expect(texts(a, "insight")[0]).toContain("moving capital appreciation (the debt fund's monthly gain) into a 12% equity fund");
  });
  it.each([
    { initial: 4000000, years: 7, debtPct: 6.5, equityPct: 14, mode: "fixedPct", fixedPct: 1.5 },
    { initial: 1500000, years: 12, debtPct: 7, equityPct: 11, mode: "fixedAmount", fixedAmount: 10000 },
  ] as const)("computeMonthlyStp equals the web module (%#)", (c) => {
    const w = webStp.computeMonthlyStp(c);
    expect(appStp.computeMonthlyStp(c)).toEqual(w);
    const b = run(DEFS.stp, {
      initial: c.initial, years: c.years, debtPct: c.debtPct, equityPct: c.equityPct, transfer: "fixed",
      fixedBy: c.mode, amount: (c as any).fixedAmount ?? 0, pct: (c as any).fixedPct ?? 0,
    });
    expect(statOf(b, "Total value")).toBe(inr(w.totalFinalValue));
    expect(statOf(b, "Debt fund value")).toBe(inr(w.debtFinalValue));
    expect(tables(b)[0].rows).toHaveLength(c.years);
  });
  it("shows only the disclaimer for a zero period", () => {
    const b = run(DEFS.stp, { years: 0 });
    expect(b.map((x) => x.type)).toEqual(["note"]);
  });
});

/* ───────────────────────── prosperity ───────────────────────── */

const prosInput = (o: Partial<appPros.ProsperityInput> = {}): appPros.ProsperityInput => ({
  monthlySip: 50000, investYears: 20, accumRatePct: 12, sipStepUpPct: 0, lumpsum: 0,
  monthlyWithdrawal: 200000, withdrawalYears: 40, withdrawRatePct: 12, inflationPct: 6,
  ...o,
});

describe("prosperity — Prosperity Multiplier", () => {
  it("prints the web's default case", () => {
    const w = webPros.computeProsperityMultiplier(prosInput());
    const b = run(DEFS.prosperity);
    expect(statOf(b, "Invested (20y)")).toBe("₹1,20,00,000");
    expect(statOf(b, "Corpus at year 20")).toBe(inr(w.totalCorpus));
    expect(statOf(b, "Total income drawn (40y)")).toBe(inr(w.totalWithdrawn));
    if (w.depletedYear) expect(statOf(b, "Corpus runs out")).toBe(`Year ${20 + w.depletedYear}`);
    else expect(statOf(b, "Corpus after 40y")).toBe(inr(w.endingCorpus));
    const [acc, draw] = tables(b);
    expect(acc.rows).toHaveLength(20);
    expect(draw.rows).toHaveLength(40);
    expect(draw.rows[0][0]).toBe("21");
    expect(texts(b, "section")).toEqual(["3. The headline", "5. Accumulation ledger (year by year)", "6. Withdrawal ledger (year by year)"]);
  });
  it.each([
    prosInput({ sipStepUpPct: 10, lumpsum: 500000, monthlyWithdrawal: 100000, withdrawalYears: 30 }),
    prosInput({ monthlySip: 20000, investYears: 15, monthlyWithdrawal: 300000, withdrawRatePct: 9 }),
  ])("computeProsperityMultiplier equals the web module (%#)", (c) => {
    const w = webPros.computeProsperityMultiplier(c);
    expect(appPros.computeProsperityMultiplier(c)).toEqual(w);
    const b = run(DEFS.prosperity, c);
    expect(statOf(b, `Corpus at year ${c.investYears}`)).toBe(inr(w.totalCorpus));
    expect(statOf(b, `Invested (${c.investYears}y)`)).toBe(inr(w.totalInvested));
    if (w.depletedYear) {
      expect(statOf(b, "Corpus runs out")).toBe(`Year ${c.investYears + w.depletedYear}`);
      expect(texts(b, "insight")[0]).toMatch(/^The corpus is exhausted in year/);
    } else expect(statOf(b, `Corpus after ${c.withdrawalYears}y`)).toBe(inr(w.endingCorpus));
  });
});

/* ───────────────────────── swprebal ───────────────────────── */

const rebInput = (o: Partial<appReb.SwpRebalanceInput> = {}): appReb.SwpRebalanceInput => ({
  initial: 7500000, debtAllocPct: 50, debtReturnPct: 6, balancedReturnPct: 9, annualWithdrawalPct: 7,
  frequency: "monthly", years: 22, rebalanceYears: 5, currentAge: 58,
  ...o,
});

describe("swprebal — SWP Rebalance", () => {
  it("prints the web's reference case to the rupee", () => {
    // swp-rebalance.ts: ₹75 L at 58 · 50% debt @ 6% · 50% balanced @ 9% · 7% a year withdrawn monthly ·
    // 22y · rebalance every 5y → monthly SWP ₹42,406, total ₹1,11,95,208, closing ₹1,00,96,496,
    // transfer ₹20,19,840 at ages 63/68/73/78.
    const b = run(DEFS.swprebal);
    expect(statOf(b, "Monthly SWP")).toBe("₹42,406");
    expect(statOf(b, "Total withdrawal")).toBe("₹1,11,95,208");
    expect(statOf(b, "Closing value")).toBe("₹1,00,96,496");
    expect(statOf(b, "Expected portfolio return")).toBe("7.50%");
    const t = tables(b)[0];
    const switched = t.rows.filter((r) => r[7] !== "—").map((r) => [r[0], r[7]]);
    expect(switched).toEqual([["63", "₹20,19,840"], ["68", "₹20,19,840"], ["73", "₹20,19,840"], ["78", "₹20,19,840"]]);
    expect(texts(b, "note")[0]).toMatch(/^Monthly · ₹42,406, Quarterly · ₹[\d,]+, Half-yearly · ₹[\d,]+, Yearly · ₹5,25,000$/);
  });
  it.each([
    rebInput({ frequency: "quarterly", debtAllocPct: 70, annualWithdrawalPct: 6, currentAge: null }),
    rebInput({ frequency: "yearly", years: 15, rebalanceYears: 3, annualWithdrawalPct: 9 }),
  ])("computeSwpRebalance equals the web module (%#)", (c) => {
    const w = webReb.computeSwpRebalance(c);
    expect(appReb.computeSwpRebalance(c)).toEqual(w);
    const b = run(DEFS.swprebal, { ...c, currentAge: c.currentAge ?? 0 });
    const name = { monthly: "Monthly", quarterly: "Quarterly", halfyearly: "Half-yearly", yearly: "Yearly" }[c.frequency];
    expect(statOf(b, `${name} SWP`)).toBe(inr(w.perPeriodSwp));
    expect(statOf(b, "Closing value")).toBe(inr(w.closingValue));
    if (w.debtShortfallYear != null) expect(texts(b, "insight").join(" ")).toContain(`cannot cover the withdrawals in year ${w.debtShortfallYear}`);
    if (c.annualWithdrawalPct > w.portfolioReturnPct) expect(texts(b, "insight")[0]).toMatch(/^Outside the usual limits/);
  });
});
