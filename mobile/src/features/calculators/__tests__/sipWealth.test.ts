/**
 * SIP & Wealth Building: each def against the web CRM — the web module run on
 * the same inputs (webModule) and the reference figures the web component
 * documents in its header.
 */

import { webModule, WEB_LIB } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import { DEFS } from "../defs/sipWealth";
import * as app from "../web/sip-suite";
import * as app360 from "../web/sip360";
import * as appReck from "../web/stepup-reckoner";
import * as appGp from "../web/goal-planning-calc";
import * as appSal from "../web/salary-wealth";
import * as appFva from "../web/fv-annual-lumpsum";
import * as appAlr from "../web/annual-lumpsum-required";
import * as appStp from "../web/stp-comprehensive";
import * as appComp from "../web/compounding";
import { inr, inrCompact, fmtPct } from "../fmt";
import type { ResultBlock } from "../types";

/**
 * The web module at src/lib/<rel>, through webModule — or, when that cannot
 * load it, the same web source compiled by tsc and evaluated here. Needed for
 * goal-planning/calc: its Babel output requires
 * @babel/runtime/helpers/interopRequireDefault, which webModule's virtual mock
 * does not supply to a file outside mobile/ (jest resolves it for real and
 * fails). The file has no imports, so it needs no require.
 */
function webSource<T>(rel: string): T {
  try {
    return webModule<T>(rel);
  } catch {
    const ts = require("typescript");
    const fs = require("fs");
    const path = require("path");
    const src: string = fs.readFileSync(path.join(WEB_LIB, `${rel}.ts`), "utf8");
    const { outputText } = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const mod: { exports: any } = { exports: {} };
    const noImports = (id: string) => { throw new Error(`${rel} imports ${id}`); };
    new Function("module", "exports", "require", outputText)(mod, mod.exports, noImports);
    return mod.exports as T;
  }
}

const web = webModule<typeof app>("calculators/sip-suite");
const web360 = webModule<typeof app360>("calculators/sip360");
const webReck = webModule<typeof appReck>("calculators/stepup-reckoner");
const webGp = webSource<typeof appGp>("goal-planning/calc");
const webSal = webModule<typeof appSal>("calculators/salary-wealth");
const webFva = webModule<typeof appFva>("calculators/fv-annual-lumpsum");
const webAlr = webModule<typeof appAlr>("calculators/annual-lumpsum-required");
const webStp = webModule<typeof appStp>("calculators/stp-comprehensive");
const webComp = webModule<typeof appComp>("calculators/compounding");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));

describe("every SIP & Wealth def", () => {
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
});

describe("sipfv — SIP Future Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // SipFvCalculator.tsx: ₹10,000/month, 15 years, +₹2,000 a year →
    // ₹47,59,314 / ₹61,63,656 normal, ₹94,99,880 / ₹1,17,91,026 step-up at 12% / 15%.
    const b = run(DEFS.sipfv);
    expect(statOf(b, "SIP value @ 12%")).toBe("₹47,59,314");
    expect(statOf(b, "SIP value @ 15%")).toBe("₹61,63,656");
    expect(statOf(b, "Step-up SIP value @ 12%")).toBe("₹94,99,880");
    expect(statOf(b, "Step-up SIP value @ 15%")).toBe("₹1,17,91,026");
    expect(tables(b)[0].rows).toHaveLength(15);
  });
  it.each([
    { monthly: 5000, years: 10, ratesPct: [10], stepUp: null },
    { monthly: 25000, years: 22, ratesPct: [11, 14], stepUp: { mode: "pct", pct: 7 } },
  ] as const)("sipFv equals the web module (%#)", (input) => {
    const a = app.sipFv(input as any);
    expect(a).toEqual(web.sipFv(input as any));
    const b = run(DEFS.sipfv, { monthly: input.monthly, years: input.years, r1: input.ratesPct[0], useR2: input.ratesPct.length > 1, r2: input.ratesPct[1] ?? 0, withStepUp: !!input.stepUp, stepMode: "pct", stepPct: (input.stepUp as any)?.pct ?? 0 });
    expect(statOf(b, `SIP value @ ${input.ratesPct[0]}%`)).toBe(inr(web.sipFv(input as any).normal.fv[0]));
  });
});

describe("sip360 — SIP 360° Planner", () => {
  it("prints the web's default case", () => {
    const w = web360.computeSip360({
      monthly: 10000, years: 20, scenarios: [{ key: "s1", ratePct: 12 }, { key: "s2", ratePct: 15 }],
      stepUp: { enabled: true, pct: 10 }, limited: { enabled: false, durations: [5, 10, 15] },
      inflation: { enabled: false, pct: 6 }, delay: { enabled: false, periods: [2, 5, 7] },
    });
    const b = run(DEFS.sip360);
    expect(statOf(b, "Normal SIP")).toBe("₹24,00,000");
    expect(statOf(b, "Step-up SIP")).toBe(inr(w.stepUpInvested!));
    const fv = tables(b)[0];
    expect(fv.head).toEqual(["Mode", "@ 12% return", "@ 15% return"]);
    expect(fv.rows).toEqual([
      ["Normal SIP", inr(w.futureValue[0].normal), inr(w.futureValue[1].normal)],
      ["Step-up SIP", inr(w.futureValue[0].stepUp!), inr(w.futureValue[1].stepUp!)],
    ]);
    // The optional comparisons are off by default: sections 1–2 only.
    expect(texts(b, "section")).toEqual(["1. Total investment", "2. Expected future value"]);
  });
  it("shows the step-up total as — when the step-up is off", () => {
    const b = run(DEFS.sip360, { stepEnabled: false });
    expect(statOf(b, "Step-up SIP")).toBe("—");
    expect(tables(b)[0].rows).toHaveLength(1);
  });
  it.each([
    { monthly: 10000, years: 20, r: [12, 15], step: 10, lim: [5, 10, 15], infl: 6, delay: [2, 5, 7] },
    { monthly: 7500, years: 12, r: [11], step: 0, lim: [3, 12, 20], infl: 5.5, delay: [1, 4, 15] },
    { monthly: 40000, years: 25, r: [10, 13.5], step: 6, lim: [8, 0, 18], infl: 7, delay: [3, 0, 10] },
  ])("computeSip360 equals the web module, every comparison on (%#)", (c) => {
    const input = {
      monthly: c.monthly, years: c.years,
      scenarios: c.r.map((ratePct, i) => ({ key: (i === 0 ? "s1" : "s2") as "s1" | "s2", ratePct })),
      stepUp: { enabled: true, pct: c.step },
      limited: { enabled: true, durations: c.lim },
      inflation: { enabled: true, pct: c.infl },
      delay: { enabled: true, periods: c.delay },
    };
    const w = web360.computeSip360(input);
    expect(app360.computeSip360(input)).toEqual(w);
    const b = run(DEFS.sip360, {
      monthly: c.monthly, years: c.years, rate1: c.r[0], useRate2: c.r.length > 1, rate2: c.r[1] ?? 0,
      stepEnabled: true, stepPct: c.step, limitedEnabled: true, limited1: c.lim[0], limited2: c.lim[1], limited3: c.lim[2],
      inflationEnabled: true, inflationPct: c.infl, delayEnabled: true, delay1: c.delay[0], delay2: c.delay[1], delay3: c.delay[2],
    });
    const t = tables(b);
    expect(t[1].rows).toEqual(w.limited!.map((row) => [`${row.years} years`, inr(row.invested), ...row.values.map((x) => inr(x.value))]));
    expect(t[2].rows).toEqual(w.inflationAdjusted!.map((r) => [`@ ${fmtPct(r.ratePct)} return`, inr(r.nominal), inr(r.real)]));
    expect(t[3].rows).toEqual(w.costOfDelay!.map((row) => [`${row.delayYears} years`, ...row.required.map((q) => inr(q.sip))]));
    expect(texts(b, "section")).toEqual([
      "1. Total investment", "2. Expected future value", "3. Limited-period SIP impact",
      `4. Inflation-adjusted value (@ ${fmtPct(c.infl)} inflation)`, "5. Cost of delay",
    ]);
  });
  it("prints the suggested schemes and comments", () => {
    const b = run(DEFS.sip360, { scheme1: { code: "1", name: "Fund A" }, scheme2: { code: "2", name: "Fund B" }, comments: "Review in March" });
    expect(texts(b, "note")).toEqual(["Fund A, Fund B", "Review in March"]);
  });
});

describe("reckoner — Step-Up SIP Reckoner", () => {
  it("prints the web's reference case (nearest ₹1,000)", () => {
    // stepup-reckoner.ts: ₹10k / 30y / 12% → Regular ≈ ₹3.08 cr, +10%/yr ≈ ₹7.98 cr, +₹2,000/yr ≈ ₹7.57 cr.
    const w = webReck.computeReckoner({ monthly: 10000, ratePct: 12, periods: [10, 15, 20, 25, 30], stepUpPct: 10, stepUpAmount: 2000 });
    const b = run(DEFS.reckoner);
    const [corpus, invested] = tables(b);
    expect(corpus.head).toEqual(["Timeframe", "Regular SIP", "Step-up 10%/yr", "Step-up ₹2,000/yr"]);
    const last = corpus.rows[4];
    expect(last[0]).toBe("30 yrs");
    expect(last[1]).toBe(inr(webReck.roundToThousand(w.rows[4].regular.corpus)));
    expect(last[2]).toBe(inr(webReck.roundToThousand(w.rows[4].stepPct!.corpus)));
    expect(last[3]).toBe(inr(webReck.roundToThousand(w.rows[4].stepAmt!.corpus)));
    expect(w.rows[4].regular.corpus / 1e7).toBeCloseTo(3.08, 1);
    expect(w.rows[4].stepPct!.corpus / 1e7).toBeCloseTo(7.98, 1);
    expect(w.rows[4].stepAmt!.corpus / 1e7).toBeCloseTo(7.57, 1);
    expect(invested.rows[0]).toEqual(["10 yrs", "₹12,00,000", inr(webReck.roundToThousand(w.rows[0].stepPct!.invested)), inr(webReck.roundToThousand(w.rows[0].stepAmt!.invested))]);
    expect(texts(b, "note")).toEqual(["Every figure is rounded to the nearest ₹1,000."]);
  });
  it.each([
    { monthly: 5000, ratePct: 11, periods: [7, 3, 0, 12, 7], stepUpPct: 0, stepUpAmount: 1500 },
    { monthly: 22000, ratePct: 13.5, periods: [5, 10, 15, 20, 25], stepUpPct: 8, stepUpAmount: 0 },
  ])("computeReckoner equals the web module, exact rupees (%#)", (c) => {
    const w = webReck.computeReckoner(c);
    expect(appReck.computeReckoner(c)).toEqual(w);
    const b = run(DEFS.reckoner, {
      monthly: c.monthly, ratePct: c.ratePct, stepUpPct: c.stepUpPct, stepUpAmount: c.stepUpAmount, precision: "exact",
      period1: c.periods[0], period2: c.periods[1], period3: c.periods[2], period4: c.periods[3], period5: c.periods[4],
    });
    const corpus = tables(b)[0];
    expect(corpus.rows).toHaveLength(w.rows.length);
    expect(corpus.head).toHaveLength(2 + (w.hasStepPct ? 1 : 0) + (w.hasStepAmt ? 1 : 0));
    expect(corpus.rows[0][1]).toBe(inr(w.rows[0].regular.corpus));
    expect(texts(b, "note")).toEqual([]);
  });
});

describe("growing — Step-up SIP vs Regular SIP", () => {
  it("prints the web's default case", () => {
    const w = webGp.growingSipSchedule({ monthlySip: 100000, annualReturnPct: 14, annualGrowthPct: 10, years: 20 });
    const r = w.regular[19];
    const g = w.growing[19];
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    const b = run(DEFS.growing);
    expect(statOf(b, "Regular SIP corpus (20y)")).toBe(inr(r.fv));
    expect(statOf(b, "Growing SIP corpus (20y)")).toBe(inr(g.fv));
    expect(statOf(b, "Extra from step-up")).toBe(inr(g.fv - r.fv));
    expect(statOf(b, "Invested — regular")).toBe("₹2,40,00,000");
    expect(statOf(b, "Invested — growing")).toBe(inr(g.invested));
    expect(statOf(b, "Growing — profit % of cost")).toBe(pct(g.profitPctOfCorpus));
    const t = tables(b)[0];
    expect(t.rows).toHaveLength(20);
    expect(t.rows[19]).toEqual(["20", inrCompact(r.fv), inrCompact(r.invested), pct(r.profitPctOfCorpus), inrCompact(g.fv), inrCompact(g.invested), pct(g.profitPctOfCorpus)]);
  });
  it.each([
    { monthlySip: 5000, annualReturnPct: 12, annualGrowthPct: 5, years: 15 },
    { monthlySip: 30000, annualReturnPct: 0, annualGrowthPct: 12, years: 8 },
    { monthlySip: 12000, annualReturnPct: 11, annualGrowthPct: 7, years: 55 },
  ])("growingSipSchedule equals the web module (%#)", (c) => {
    const capped = { ...c, years: Math.min(40, Math.max(1, c.years)) };
    const w = webGp.growingSipSchedule(capped);
    expect(appGp.growingSipSchedule(capped)).toEqual(w);
    const b = run(DEFS.growing, { sip: c.monthlySip, returnPct: c.annualReturnPct, growthPct: c.annualGrowthPct, years: c.years });
    expect(statOf(b, `Growing SIP corpus (${capped.years}y)`)).toBe(inr(w.growing[capped.years - 1].fv));
  });
});

describe("salary — Salary → Wealth", () => {
  it("prints the web's reference case, wealth mode", () => {
    // salary-wealth.ts: 32 → 60, ₹1,20,000, +8%, SIP 10% till 60 @12%, existing ₹6,00,000 @12%.
    const b = run(DEFS.salary);
    expect(statOf(b, "Total salary received")).toBe("₹13,72,87,915");
    expect(statOf(b, "New investment through SIP")).toBe("₹1,37,28,791");
    expect(statOf(b, "Wealth from the SIP")).toBe("₹5,84,32,619");
    expect(statOf(b, "Wealth from existing investment")).toBe("₹1,43,30,320");
    expect(statOf(b, "Total wealth at 60")).toBe("₹7,27,62,939");
    expect(statOf(b, "Starting monthly SIP")).toBe("₹12,000");
    expect(texts(b, "note")[0]).toBe("To build, through the SIP alone, as much as the ₹13,72,87,915 of salary received, invest about 23.50% of the monthly salary (rising with it) until age 60.");
    expect(tables(b)[0].rows).toHaveLength(28);
  });
  it("prints the web's reference case, saving mode, with the lumpsum alternative", () => {
    // ₹10 cr target → starting SIP ₹17,594 = 14.66% of salary, new investment ₹2,01,28,161.
    const w = webSal.computeSalaryWealth({
      mode: "saving", currentAge: 32, retirementAge: 60, currentMonthlySalary: 120000, sipPctOfSalary: 10, annualIncrementPct: 8,
      investTillAge: 60, assumedReturnPct: 12, includeExisting: true, existingInvestment: 600000, existingReturnPct: 12, targetWealth: 100000000,
    });
    const b = run(DEFS.salary, { mode: "saving" });
    expect(statOf(b, "Starting monthly SIP needed")).toBe("₹17,594");
    expect(statOf(b, "As % of monthly salary")).toBe("14.66%");
    expect(statOf(b, "New investment till age 60")).toBe("₹2,01,28,161");
    expect(statOf(b, "Target wealth")).toBe("₹10,00,00,000");
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(w.requiredLumpsumToday!));
    expect(statOf(b, "Left invested for")).toBe("28 yrs, till age 60");
  });
  it.each([
    { mode: "wealth", currentAge: 25, retirementAge: 58, currentMonthlySalary: 60000, sipPctOfSalary: 15, annualIncrementPct: 6, investTillAge: 50, assumedReturnPct: 11, includeExisting: false, existingInvestment: 0, existingReturnPct: 11, targetWealth: 0 },
    { mode: "saving", currentAge: 40, retirementAge: 60, currentMonthlySalary: 250000, sipPctOfSalary: 0, annualIncrementPct: 5, investTillAge: 55, assumedReturnPct: 10, includeExisting: true, existingInvestment: 2500000, existingReturnPct: 8, targetWealth: 50000000 },
    { mode: "saving", currentAge: 45, retirementAge: 60, currentMonthlySalary: 100000, sipPctOfSalary: 0, annualIncrementPct: 5, investTillAge: 45, assumedReturnPct: 10, includeExisting: false, existingInvestment: 0, existingReturnPct: 10, targetWealth: 20000000 },
  ] as const)("computeSalaryWealth equals the web module (%#)", (c) => {
    const w = webSal.computeSalaryWealth(c);
    expect(appSal.computeSalaryWealth(c)).toEqual(w);
    const b = run(DEFS.salary, c);
    if (c.mode === "wealth") expect(statOf(b, `Total wealth at ${c.retirementAge}`)).toBe(inr(w.wealth));
    else expect(statOf(b, "Starting monthly SIP needed")).toBe(inr(w.requiredMonthlySip!));
    expect(statOf(b, "SIP corpus alone")).toBe(inr(w.wealth - w.existingFutureValue));
  });
  it("shows — when no investing years are left", () => {
    const b = run(DEFS.salary, { mode: "saving", currentAge: 45, investTillAge: 45, includeExisting: false });
    expect(statOf(b, "Starting monthly SIP needed")).toBe("—");
    expect(statOf(b, "As % of monthly salary")).toBe("—");
  });
});

describe("fvannual — FV of Annual Lumpsum", () => {
  it("prints the web's reference case to the rupee", () => {
    // fv-annual-lumpsum.ts: ₹5,00,000/yr · invest 15 · pay 10 · 12% → ₹1,73,19,046 (year 1 ₹5,60,000).
    const b = run(DEFS.fvannual);
    expect(statOf(b, "Total invested")).toBe("₹50,00,000");
    expect(statOf(b, "Future value @ 12.00%")).toBe("₹1,73,19,046");
    expect(statOf(b, "Wealth gain")).toBe("₹1,23,19,046");
    const t = tables(b)[0];
    expect(t.rows[0]).toEqual(["1", "₹5,00,000", "₹5,60,000"]);
    expect(t.rows[10][1]).toBe("—");
    expect(t.rows).toHaveLength(15);
  });
  it.each([
    { annualInvestment: 200000, investmentYears: 20, paymentYears: 20, scenario1Pct: 10, scenario2Pct: 14 },
    { annualInvestment: 150000, investmentYears: 8, paymentYears: 12, scenario1Pct: 9.5, scenario2Pct: null },
  ])("computeFvAnnualLumpsum equals the web module (%#)", (c) => {
    const w = webFva.computeFvAnnualLumpsum(c);
    expect(appFva.computeFvAnnualLumpsum(c)).toEqual(w);
    const b = run(DEFS.fvannual, { ...c, scenario2Pct: c.scenario2Pct ?? 0 });
    expect(statOf(b, `Future value @ ${c.scenario1Pct.toFixed(2)}%`)).toBe(inr(w.scenario1.futureValue));
    if (w.scenario2) {
      expect(statOf(b, `Future value @ ${c.scenario2Pct!.toFixed(2)}%`)).toBe(inr(w.scenario2.futureValue));
      expect(texts(b, "note")[0]).toBe(`Difference between scenarios: ${inr(Math.abs(w.scenario2.futureValue - w.scenario1.futureValue))} (Scenario 2 higher).`);
    } else {
      expect(texts(b, "insight")[0]).toMatch(/capped at the investment period \(8 years\)/);
    }
  });
});

describe("annualreq — Annual Lumpsum for Target", () => {
  it("prints the web's reference case to the rupee", () => {
    // annual-lumpsum-required.ts: ₹25,00,000, 10y invest = 10y pay, 12% → ₹1,27,197 a year.
    const b = run(DEFS.annualreq);
    expect(statOf(b, "Required / yr @ 12%")).toBe("₹1,27,197");
    expect(texts(b, "insight")[0]).toBe("To reach ₹25,00,000 in 10 years at 12%, invest about ₹1,27,197/year.");
    const rows = tables(b)[0].rows;
    expect(rows[rows.length - 1][2]).toBe("₹25,00,000");
  });
  it.each([
    { targetAmount: 10000000, investmentYears: 18, paymentYears: 10, scenario1Pct: 12, scenario2Pct: 10 },
    { targetAmount: 3500000, investmentYears: 7, paymentYears: 7, scenario1Pct: 8.5, scenario2Pct: null },
    { targetAmount: 3500000, investmentYears: 7, paymentYears: 0, scenario1Pct: 8.5, scenario2Pct: null },
  ])("computeAnnualLumpsumRequired equals the web module (%#)", (c) => {
    const w = webAlr.computeAnnualLumpsumRequired(c);
    expect(appAlr.computeAnnualLumpsumRequired(c)).toEqual(w);
    const b = run(DEFS.annualreq, { ...c, useScenario2: c.scenario2Pct != null, scenario2Pct: c.scenario2Pct ?? 10 });
    expect(statOf(b, `Required / yr @ ${fmtPct(c.scenario1Pct)}`)).toBe(inr(w.scenario1.requiredAnnual));
    if (w.scenario2) expect(statOf(b, `Required / yr @ ${fmtPct(c.scenario2Pct!)}`)).toBe(inr(w.scenario2.requiredAnnual));
  });
});

describe("sip — Lumpsum + SIP Future Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // LumpsumSipFvCalculator.tsx: ₹15,000/month @15% + ₹10,00,000 @12%, 10 years.
    const b = run(DEFS.sip);
    expect(statOf(b, "SIP value @ 15%")).toBe("₹39,45,273");
    expect(statOf(b, "Lumpsum value @ 12%")).toBe("₹31,05,848");
    expect(statOf(b, "Total future value")).toBe("₹70,51,121");
    expect(statOf(b, "Total invested")).toBe("₹28,00,000");
    expect(tables(b)[0].rows).toHaveLength(10);
  });
  it.each([
    { monthlySip: 8000, sipPct: 12, lumpsum: 0, lumpsumPct: 9, years: 15 },
    { monthlySip: 0, sipPct: 14, lumpsum: 2500000, lumpsumPct: 11, years: 7 },
  ])("lumpsumPlusSipFv equals the web module (%#)", (c) => {
    const w = web.lumpsumPlusSipFv(c);
    expect(app.lumpsumPlusSipFv(c)).toEqual(w);
    expect(statOf(run(DEFS.sip, c), "Total future value")).toBe(inr(w.total));
  });
});

describe("cagr — CAGR", () => {
  it("prints the web's default case", () => {
    const w = webGp.cagrCalculate({ initialValue: 100000, finalValue: 250000, years: 5 });
    const b = run(DEFS.cagr);
    expect(statOf(b, "Absolute return")).toBe("150.00%");
    expect(statOf(b, "CAGR return")).toBe(`${w.cagrPct.toFixed(2)}% p.a.`);
    expect(statOf(b, "CAGR return")).toBe("20.11% p.a.");
    expect(statOf(b, "Absolute wealth gain")).toBe("₹1,50,000");
  });
  it.each([
    { initialValue: 500000, finalValue: 320000, years: 3.5 },
    { initialValue: 0, finalValue: 100000, years: 4 },
    { initialValue: 100000, finalValue: 180000, years: 0 },
  ])("cagrCalculate equals the web module (%#)", (c) => {
    const w = webGp.cagrCalculate(c);
    expect(appGp.cagrCalculate(c)).toEqual(w);
    const b = run(DEFS.cagr, c);
    expect(statOf(b, "Absolute wealth gain")).toBe(inr(c.finalValue - c.initialValue));
    expect(statOf(b, "CAGR return")).toBe(c.initialValue > 0 && c.years > 0 ? `${w.cagrPct.toFixed(2)}% p.a.` : "—");
  });
});

describe("lumpsumfv — Lumpsum Future Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // LumpsumFvCalculator.tsx: ₹5,00,000 for 10 years → ₹20,22,779 at 15%, ₹15,52,924 at 12%.
    const b = run(DEFS.lumpsumfv);
    expect(statOf(b, "Future value @ 15%")).toBe("₹20,22,779");
    expect(statOf(b, "Future value @ 12%")).toBe("₹15,52,924");
    expect(statOf(b, "Period")).toBe("10 yrs");
    const t = tables(b)[0];
    expect(t.rows[0][1]).toBe("₹5,00,000");
    expect(t.rows[1][1]).toBe("—");
  });
  it.each([
    { amount: 1200000, years: 18, ratesPct: [9] },
    { amount: 75000, years: 4, ratesPct: [7.5, 13] },
  ])("lumpsumFv equals the web module (%#)", (c) => {
    const w = web.lumpsumFv(c);
    expect(app.lumpsumFv(c)).toEqual(w);
    const b = run(DEFS.lumpsumfv, { amount: c.amount, years: c.years, r1: c.ratesPct[0], useR2: c.ratesPct.length > 1, r2: c.ratesPct[1] ?? 0 });
    expect(statOf(b, `Future value @ ${fmtPct(c.ratesPct[0])}`)).toBe(inr(w.fv[0]));
  });
});

describe("stepupfv — Step-Up SIP Future Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // StepUpSipFvCalculator.tsx: ₹10,000/month +10% a year for 20 years.
    const b = run(DEFS.stepupfv);
    expect(statOf(b, "Total invested")).toBe("₹68,73,000");
    expect(statOf(b, "Future value @ 12%")).toBe("₹1,86,31,383");
    expect(statOf(b, "Future value @ 15%")).toBe("₹2,49,73,181");
    expect(tables(b)[0].rows).toHaveLength(20);
  });
  it.each([
    { monthly: 3000, stepUpPct: 15, years: 12, ratesPct: [11] },
    { monthly: 50000, stepUpPct: 5, years: 25, ratesPct: [10, 12.5] },
  ])("stepUpSipFv equals the web module (%#)", (c) => {
    const w = web.stepUpSipFv(c);
    expect(app.stepUpSipFv(c)).toEqual(w);
    const b = run(DEFS.stepupfv, { monthly: c.monthly, stepUpPct: c.stepUpPct, years: c.years, r1: c.ratesPct[0], useR2: c.ratesPct.length > 1, r2: c.ratesPct[1] ?? 0 });
    expect(statOf(b, `Future value @ ${fmtPct(c.ratesPct[0])}`)).toBe(inr(w.fv[0]));
    expect(statOf(b, "Monthly SIP in the last year")).toBe(inr(w.rows[w.rows.length - 1].monthly));
  });
});

describe("limitedfv — Limited-Period SIP Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // LimitedSipFvCalculator.tsx: ₹5,000/month for 5 years, held 10 more.
    const b = run(DEFS.limitedfv);
    expect(statOf(b, "Total invested")).toBe("₹3,00,000");
    expect(statOf(b, "Value after 15 yrs @ 12%")).toBe("₹12,59,478");
    expect(statOf(b, "Value after 15 yrs @ 15%")).toBe("₹17,66,737");
    const t = tables(b)[0];
    expect(t.rows).toHaveLength(15);
    expect(t.rows[5].slice(0, 3)).toEqual(["6", "—", "—"]);
  });
  it.each([
    { monthly: 20000, sipYears: 10, deferYears: 0, ratesPct: [12] },
    { monthly: 7000, sipYears: 3, deferYears: 17, ratesPct: [10, 14] },
  ])("limitedSipFv equals the web module (%#)", (c) => {
    const w = web.limitedSipFv(c);
    expect(app.limitedSipFv(c)).toEqual(w);
    const b = run(DEFS.limitedfv, { monthly: c.monthly, sipYears: c.sipYears, deferYears: c.deferYears, r1: c.ratesPct[0], useR2: c.ratesPct.length > 1, r2: c.ratesPct[1] ?? 0 });
    expect(statOf(b, `Value after ${c.sipYears + c.deferYears} yrs @ ${fmtPct(c.ratesPct[0])}`)).toBe(inr(w.fv[0]));
  });
});

describe("sipstp — SIP + STP Future Value", () => {
  it("prints the web's reference case to the rupee", () => {
    // SipStpFutureValueCalculator.tsx: SIP ₹10,000 @12% + STP ₹10L 5% → 12%, 15 yrs → ₹76,80,092.
    const b = run(DEFS.sipstp);
    expect(statOf(b, "Total value")).toBe("₹76,80,092");
    const t = tables(b)[0];
    expect(t.rows).toHaveLength(15);
    expect(t.rows[14][5]).toBe("₹76,80,092");
  });
  it.each([
    { monthlySip: 5000, sipRatePct: 13, stpLumpsum: 2500000, debtPct: 6.5, equityPct: 11, years: 10 },
    { monthlySip: 0, sipRatePct: 12, stpLumpsum: 500000, debtPct: 7, equityPct: 14, years: 20 },
  ])("computeSipStpFv equals the web module (%#)", (c) => {
    const w = webStp.computeSipStpFv(c);
    expect(appStp.computeSipStpFv(c)).toEqual(w);
    const b = run(DEFS.sipstp, c);
    expect(statOf(b, "Total value")).toBe(inr(w.total));
    expect(statOf(b, "STP equity fund value")).toBe(inr(w.stpEquityValue));
    expect(texts(b, "note")[0]).toContain(`(${inr(w.monthlyTransfer)} a month)`);
  });
});

describe("compounding — Compound Interest", () => {
  it("prints the web's reference case to the rupee", () => {
    // compounding.ts: ₹1,00,000 at 10% quarterly for 5 years → ₹1,63,862; effective 10.38%.
    const b = run(DEFS.compounding, { rate: 10, years: 5 });
    expect(statOf(b, "Value after 5 yrs")).toBe("₹1,63,862");
    expect(statOf(b, "Effective annual rate")).toBe("10.38%");
    expect(texts(b, "insight")[0]).toBe(`10% compounded quarterly works out to 10.38% a year, so ₹1,00,000 grows to ₹1,63,862 in 5 years. Compounded only once a year it would earn 10% flat; daily compounding would give ${webComp.effectiveAnnualRate(10, 365).toFixed(2)}%.`);
    // ₹1,000 at the end of every month, 12% compounded monthly, one year → ₹12,682.50.
    const rd = run(DEFS.compounding, { principal: 0, rate: 12, years: 1, frequency: "monthly", addition: 1000, addFreq: "monthly", timing: "end" });
    expect(statOf(rd, "Value after 1 yrs")).toBe("₹12,683");
  });
  it.each([
    { principal: 250000, ratePct: 7.25, years: 12, frequency: "half_yearly", addition: 5000, additionFrequency: "quarterly", additionTiming: "start" },
    { principal: 50000, ratePct: 9, years: 8, frequency: "daily", addition: 0, additionFrequency: "monthly", additionTiming: "end" },
  ] as const)("compounding equals the web module (%#)", (c) => {
    const w = webComp.compounding(c);
    expect(appComp.compounding(c)).toEqual(w);
    const b = run(DEFS.compounding, { principal: c.principal, rate: c.ratePct, years: c.years, frequency: c.frequency, addition: c.addition, addFreq: c.additionFrequency, timing: c.additionTiming });
    expect(statOf(b, `Value after ${c.years} yrs`)).toBe(inr(w.total));
    expect(statOf(b, "Interest earned")).toBe(inr(w.interest));
  });
});
