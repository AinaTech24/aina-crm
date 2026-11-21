/**
 * Ready Reckoners: each def against the web CRM — the web module run on the
 * same inputs (webModule) and the reference figures the web documents
 * (component headers and the maths modules' verified reference cases).
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import { DEFS, lakh } from "../defs/reckoners";
import * as appRr from "../web/ready-reckoner";
import * as appStp from "../web/stp-comprehensive";
import * as appIb from "../web/income-bridge";
import { inr } from "../fmt";
import type { ResultBlock } from "../types";

const webRr = webModule<typeof appRr>("calculators/ready-reckoner");
const webStp = webModule<typeof appStp>("calculators/stp-comprehensive");
const webIb = webModule<typeof appIb>("calculators/income-bridge");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));

/** Web ReadyReckoner `lakh`, via the platform Intl (Node has full ICU). */
const webLakh = (v: number) =>
  webRr.displayCell(v, "lakh").toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe("every Ready Reckoner def", () => {
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
      for (const o of i.options ?? []) expect(() => run(body, { [i.key]: o.value })).not.toThrow();
      if (i.type === "toggle") expect(() => run(body, { [i.key]: !i.default })).not.toThrow();
    }
  });
  it("the hand lakh formatter equals the web's toLocaleString", () => {
    for (const v of [805255.3, 8500000, 16459000, 123456789, 999, 0, 104999999]) expect(lakh(v)).toBe(webLakh(v));
  });
});

describe("lsreckoner — Lumpsum Growth Reckoner", () => {
  it("prints every reference cell (₹5,00,000; ₹ lakh)", () => {
    const b = run(DEFS.lsreckoner);
    const [grid] = tables(b);
    expect(grid.head).toEqual(["Return (p.a.)", "5 yrs", "10 yrs", "15 yrs", "20 yrs", "25 yrs"]);
    expect(grid.rows).toEqual([
      ["10.00%", "8.05", "12.97", "20.89", "33.64", "54.17"],
      ["12.00%", "8.81", "15.53", "27.37", "48.23", "85.00"],
      ["15.00%", "10.06", "20.23", "40.69", "81.83", "164.59"],
    ]);
    expect(texts(b, "section")).toEqual(["1. Projected value of the investment — invested ₹5,00,000"]);
    expect(texts(b, "insight")[0]).toBe(
      `At 10% a year, ₹5,00,000 invested once could become about ${inr(webRr.lumpsumFv(500000, 10, 25))} in 25 years.`,
    );
  });
  it("exact rupees, a dropped box, entry order", () => {
    const b = run(DEFS.lsreckoner, { exact: true, rate1: 15, rate2: 0, rate3: 10, period1: 25, period2: 5, period3: 0, period4: 0, period5: 0 });
    expect(tables(b)[0].rows).toEqual([
      ["15.00%", inr(webRr.lumpsumFv(500000, 15, 25)), inr(webRr.lumpsumFv(500000, 15, 5))],
      ["10.00%", inr(webRr.lumpsumFv(500000, 10, 25)), inr(webRr.lumpsumFv(500000, 10, 5))],
    ]);
    expect(texts(b, "note")[0]).toBe("Figures in ₹, rounded to the rupee. Returns compound once a year.");
  });
  it("asks for valid numbers on a zero amount", () => {
    const b = run(DEFS.lsreckoner, { amount: 0 });
    expect(tables(b)).toHaveLength(0);
    expect(texts(b, "insight")).toEqual(["Enter an amount above zero, at least one return rate and at least one period."]);
  });
});

describe("lsneedreckoner — Lumpsum Needed Reckoner", () => {
  it("prints every reference cell (target ₹1 crore; ₹ lakh)", () => {
    const b = run(DEFS.lsneedreckoner);
    expect(tables(b)[0].rows).toEqual([
      ["10.00%", "62.09", "38.55", "23.94", "14.86", "9.23"],
      ["12.00%", "56.74", "32.20", "18.27", "10.37", "5.88"],
      ["15.00%", "49.72", "24.72", "12.29", "6.11", "3.04"],
    ]);
    // ₹1 Cr @12% / 25y is ₹5,88,233 (the reference).
    expect(run(DEFS.lsneedreckoner, { rate1: 12, rate2: 0, rate3: 0, exact: true }).flatMap((x) => (x.type === "table" ? x.rows[0] : []))[5]).toBe("₹5,88,233");
  });
});

describe("sipreckoner — SIP Growth Reckoner", () => {
  it("prints every reference cell (₹10,000/month; ₹ lakh)", () => {
    const b = run(DEFS.sipreckoner);
    expect(tables(b)[0].rows).toEqual([
      ["10.00%", "7.72", "20.15", "40.16", "72.40", "124.32"],
      ["12.00%", "8.11", "22.40", "47.59", "91.99", "170.22"],
      ["15.00%", "8.73", "26.30", "61.64", "132.71", "275.66"],
    ]);
    expect(texts(b, "insight")[0]).toBe(
      `At 10% a year, a ₹10,000 monthly SIP for 25 years could grow to about ${inr(webRr.sipFv(10000, 10, 25))}, against ₹30,00,000 paid in.`,
    );
  });
});

describe("sipneedreckoner — SIP Needed Reckoner", () => {
  it("prints every reference cell to the rupee, and the lumpsum beside it", () => {
    const b = run(DEFS.sipneedreckoner);
    const [sip, lump] = tables(b);
    expect(sip.rows).toEqual([
      ["10.00%", "₹49,638", "₹24,899", "₹13,812", "₹8,044", "₹4,809"],
      ["12.00%", "₹44,636", "₹21,011", "₹10,871", "₹5,875", "₹3,246"],
      ["15.00%", "₹38,020", "₹16,224", "₹7,535", "₹3,628", "₹1,776"],
    ]);
    const w = webRr.computeReadyReckoner({ mode: "sip_need", amount: 1e7, ratesPct: [10, 12, 15], years: [10, 15, 20, 25, 30] });
    expect(lump.rows).toEqual(w.rates.map((r, ri) => [`${r.toFixed(2)}%`, ...w.lumpsumCells![ri].map(webLakh)]));
    expect(texts(b, "section")).toEqual([
      "1. Monthly SIP needed — target ₹1,00,00,000",
      "2. Or a one-time lumpsum needed today — target ₹1,00,00,000",
    ]);
    expect(texts(b, "insight")[0]).toBe(
      `To build ₹1,00,00,000 in 30 years at 10% a year, a monthly SIP of about ${inr(w.cells[0][4])} is needed — starting earlier lowers it sharply. Or invest a one-time lumpsum of about ${inr(w.lumpsumCells![0][4])} today and leave it to grow.`,
    );
  });
  it("exact rupees prints the lumpsum grid in rupees", () => {
    const b = run(DEFS.sipneedreckoner, { exact: true });
    const w = webRr.computeReadyReckoner({ mode: "sip_need", amount: 1e7, ratesPct: [10, 12, 15], years: [10, 15, 20, 25, 30] });
    expect(tables(b)[1].rows[2]).toEqual(["15.00%", ...w.lumpsumCells![2].map((x) => inr(x))]);
  });
});

describe("computeReadyReckoner equals the web module", () => {
  it.each([
    { mode: "lumpsum_fv", amount: 750000, ratesPct: [8.5, null, 13], years: [3, 7.5, null, 40, 12] },
    { mode: "sip_need", amount: 25_000_000, ratesPct: [11, 0, 14], years: [8, 18, 28, null, null] },
    { mode: "sip_fv", amount: 3500, ratesPct: [9, 12.5, 99], years: [1, 2, 33, 101, 6] },
  ] as const)("%#", (input) => {
    const w = webRr.computeReadyReckoner(input as any);
    expect(appRr.computeReadyReckoner(input as any)).toEqual(w);
  });
  it("a def cell equals inr(web cell)", () => {
    const b = run(DEFS.sipreckoner, { amount: 7500, rate1: 11.5, rate2: 0, rate3: 0, period1: 17, period2: 0, period3: 0, period4: 0, period5: 0, exact: true });
    expect(tables(b)[0].rows).toEqual([["11.50%", inr(webRr.sipFv(7500, 11.5, 17))]]);
  });
});

describe("stpreckoner / stpneedreckoner — STP Ready Reckoners", () => {
  const SC = [{ debtPct: 5, equityPct: 10 }, { debtPct: 6, equityPct: 12 }, { debtPct: 7, equityPct: 15 }];
  const YRS = [5, 10, 15, 20, 25];
  it("prints the reference cells (₹50 L, capital appreciation, 5% | 10% for 5 yrs)", () => {
    const fv = run(DEFS.stpreckoner);
    expect(tables(fv)[0].rows[0][1]).toBe("65.60");
    const need = run(DEFS.stpneedreckoner);
    expect(tables(need)[0].rows[0][1]).toBe("38.11");
    const w = webStp.stpReckonerGrid({ kind: "fv", amount: 5e6, scenarios: SC, years: YRS, mode: "appreciation", fixedPct: 1 });
    expect(tables(fv)[0]).toEqual({
      head: ["Debt | equity return", "5 yrs", "10 yrs", "15 yrs", "20 yrs", "25 yrs"],
      rows: SC.map((s, i) => [`${s.debtPct}% | ${s.equityPct}%`, ...w[i].map((x) => (x / 1e5).toFixed(2))]),
    });
    expect(texts(fv, "insight")[0]).toBe(
      `₹50,00,000 parked in a 7% debt fund and moved into a 15% equity fund (capital appreciation (the debt fund's monthly gain)) could grow to ${inr(w[2][4])} in 25 years.`,
    );
    const wn = webStp.stpReckonerGrid({ kind: "need", amount: 5e6, scenarios: SC, years: YRS, mode: "appreciation", fixedPct: 1 });
    expect(texts(need, "insight")[0]).toBe(`At 7% | 15% over 25 years, about ${inr(wn[2][4])} placed today reaches ₹50,00,000.`);
  });
  it.each([
    { kind: "fv", amount: 2_500_000, mode: "fixedPct", fixedPct: 2, scenarios: [{ debtPct: 6.5, equityPct: 11 }, { debtPct: 4, equityPct: 9 }, { debtPct: 7.5, equityPct: 14 }], years: [3, 8, 12, 0, 30] },
    { kind: "need", amount: 10_000_000, mode: "fixedPct", fixedPct: 1.5, scenarios: SC, years: YRS },
    { kind: "need", amount: 4_000_000, mode: "appreciation", fixedPct: 1, scenarios: SC, years: [1, 2, 4, 6, 9] },
  ] as const)("stpReckonerGrid equals the web module (%#)", (input) => {
    const w = webStp.stpReckonerGrid(input as any);
    expect(appStp.stpReckonerGrid(input as any)).toEqual(w);
    const b = run(input.kind === "fv" ? DEFS.stpreckoner : DEFS.stpneedreckoner, {
      amount: input.amount, transfer: input.mode === "fixedPct" ? "fixed" : "appreciation", pct: input.fixedPct,
      ...Object.fromEntries(input.scenarios.flatMap((s, i) => [[`debt${i + 1}`, s.debtPct], [`equity${i + 1}`, s.equityPct]])),
      ...Object.fromEntries(input.years.map((y, i) => [`period${i + 1}`, y])),
    });
    expect(tables(b)[0].rows.map((r) => r.slice(1))).toEqual(w.map((row) => row.map((x) => (Number.isFinite(x) ? (x / 1e5).toFixed(2) : "—"))));
    if (Number.isFinite(w[2][4])) expect(texts(b, "insight")[0]).toContain(inr(w[2][4]));
  });
});

describe("sipswp — SIP–SWP Ready Reckoner", () => {
  it("prints the web's reference case to the rupee", () => {
    // SipSwpReckoner.tsx: salary ₹1,00,000 · 25% · +8%/yr · 35→50, held to 60
    // @12%; SWP to 80 @8%, 5% inflation, leave ₹1 cr → corpus ₹5,70,32,643,
    // first-month SWP ₹3,00,712 (income-bridge: invested ₹81,45,634,
    // ₹12,20,30,233 withdrawn).
    const b = run(DEFS.sipswp);
    expect(statOf(b, "Total accumulated")).toBe("₹5,70,32,643");
    expect(statOf(b, "Monthly SWP (first month)")).toBe("₹3,00,712");
    expect(statOf(b, "Total investment")).toBe("₹81,45,634");
    expect(statOf(b, "Total withdrawal")).toBe("₹12,20,30,233");
    const [acc, dist] = tables(b);
    expect(acc.rows).toHaveLength(25);
    expect(dist.rows).toHaveLength(20);
    expect(texts(b, "section")).toEqual(["1. Building the corpus — year by year", "2. Drawing the income — year by year"]);
    const w = webIb.computeIncomeBridge({
      calcType: "monthly_swp", investMode: "salary", planningType: "retirement", startAge: 35, sipTillAge: 50, retirementAge: 60, swpTillAge: 80,
      monthlySip: 25000, topUpPct: 5, lumpsum: 1000000, monthlySalary: 100000, savingsPct: 25, salaryGrowthPct: 8, accumReturnPct: 12,
      distReturnPct: 8, distInflationPct: 5, endBalance: 10000000, desiredMonthlySwp: 300000,
    });
    expect(texts(b, "note")[0]).toBe(`Max ${inr(w.maxEndBalance)} — what the corpus grows to if nothing is withdrawn.`);
    expect(texts(b, "insight")).toEqual([
      `25% of a ₹1,00,000 salary rising 8% a year builds ₹5,70,32,643 by age 60 (including 10 years of waiting with no new money). That pays ₹3,00,712 in the first month, rising every month to ${inr(w.lastMonthlySwp)}, until age 80, and leaves ${inr(w.endBalanceActual)}.`,
    ]);
  });
  it("SIP ₹10,000 · 35→60 @12%, SWP 60→85 @9% leaving ₹1 cr (the module's reference)", () => {
    const b = run(DEFS.sipswp, {
      investMode: "sip", monthlySip: 10000, topUpPct: 0, sipTillAge: 60, distReturnPct: 9, distInflationPct: 0, swpTillAge: 85,
    });
    expect(statOf(b, "Total accumulated")).toBe("₹1,70,22,066");
    expect(statOf(b, "Monthly SWP")).toBe("₹1,29,323");
  });
  it.each([
    { calcType: "investment_need", investMode: "sip", planningType: "retirement", startAge: 30, sipTillAge: 45, retirementAge: 55, swpTillAge: 85, monthlySip: 0, topUpPct: 7, lumpsum: 0, monthlySalary: 0, savingsPct: 0, salaryGrowthPct: 0, accumReturnPct: 11, distReturnPct: 7, distInflationPct: 6, endBalance: 5_000_000, desiredMonthlySwp: 150000 },
    { calcType: "investment_need", investMode: "lumpsum_sip", planningType: "invest_now_withdraw_later", startAge: 40, sipTillAge: 50, retirementAge: 52, swpTillAge: 70, monthlySip: 0, topUpPct: 5, lumpsum: 2_000_000, monthlySalary: 0, savingsPct: 0, salaryGrowthPct: 0, accumReturnPct: 12, distReturnPct: 8, distInflationPct: 4, endBalance: 0, desiredMonthlySwp: 80000 },
    { calcType: "investment_need", investMode: "salary", planningType: "retirement", startAge: 28, sipTillAge: 55, retirementAge: 58, swpTillAge: 88, monthlySip: 0, topUpPct: 0, lumpsum: 0, monthlySalary: 150000, savingsPct: 20, salaryGrowthPct: 7, accumReturnPct: 12, distReturnPct: 8, distInflationPct: 5, endBalance: 10_000_000, desiredMonthlySwp: 200000 },
    { calcType: "monthly_swp", investMode: "lumpsum", planningType: "retirement", startAge: 45, sipTillAge: 45, retirementAge: 60, swpTillAge: 80, monthlySip: 0, topUpPct: 0, lumpsum: 5_000_000, monthlySalary: 0, savingsPct: 0, salaryGrowthPct: 0, accumReturnPct: 10, distReturnPct: 7, distInflationPct: 5, endBalance: 1_000_000, desiredMonthlySwp: 0 },
  ] as const)("computeIncomeBridge equals the web module (%#)", (input) => {
    const w = webIb.computeIncomeBridge(input);
    expect(appIb.computeIncomeBridge(input)).toEqual(w);
    const b = run(DEFS.sipswp, {
      ...input,
      retirementAge: input.retirementAge,
      swpStartAge: input.retirementAge,
    });
    expect(statOf(b, input.calcType === "investment_need" ? "Corpus needed at SWP start" : "Total accumulated")).toBe(inr(w.corpus));
    expect(statOf(b, "Total investment")).toBe(inr(w.totalInvested));
    const mode: string = input.investMode;
    if (input.calcType === "investment_need" && mode !== "lumpsum") {
      expect(statOf(b, /^Monthly SIP needed/)).toBe(inr(w.requiredMonthlySip!));
      expect(statOf(b, /lumpsum today/)).toBe(inr(w.lumpsumInsteadOfSip!));
    }
    if (input.investMode === "salary" && input.calcType === "investment_need") {
      expect(statOf(b, "SIP as % of salary needed")).toBe(`${w.requiredSavingsPct!.toFixed(1)}%`);
    }
  });
  it("lumpsum, investment needed: the lumpsum today", () => {
    const b = run(DEFS.sipswp, { calcType: "investment_need", investMode: "lumpsum" });
    const w = webIb.computeIncomeBridge({
      calcType: "investment_need", investMode: "lumpsum", planningType: "retirement", startAge: 35, sipTillAge: 50, retirementAge: 60, swpTillAge: 80,
      monthlySip: 25000, topUpPct: 5, lumpsum: 1000000, monthlySalary: 100000, savingsPct: 25, salaryGrowthPct: 8, accumReturnPct: 12,
      distReturnPct: 8, distInflationPct: 5, endBalance: 10000000, desiredMonthlySwp: 300000,
    });
    expect(statOf(b, "Lumpsum needed today")).toBe(inr(w.requiredLumpsum!));
    expect(statOf(b, "Monthly SIP needed")).toBeUndefined();
  });
  it("flags impossible ages", () => {
    const b = run(DEFS.sipswp, { sipTillAge: 30, swpTillAge: 55 });
    expect(texts(b, "insight")[0]).toBe("Check the ages: the SIP must end after the start age; the SWP must end after it starts.");
  });
  it("the plan's own SWP start age is used", () => {
    const a = run(DEFS.sipswp, { planningType: "invest_now_withdraw_later", swpStartAge: 55, retirementAge: 60 });
    const b = run(DEFS.sipswp, { retirementAge: 55 });
    expect(statOf(a, "Total accumulated")).toBe(statOf(b, "Total accumulated"));
  });
});
