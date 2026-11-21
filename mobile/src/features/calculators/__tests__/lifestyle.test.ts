/**
 * Dreams & Milestones, Essentials & Behaviour, Engagement & Fun: each def
 * against the web CRM — the web maths module run on the same inputs
 * (webModule), and, where the maths lives inline in the web component
 * (MonthlyBudgetPlanner, MoneyPersonalityQuiz), that component's own source
 * sliced out and evaluated here (webInline).
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import { DEFS, monthlyBudget, QUESTIONS, profileFor, type BudgetGroups } from "../defs/lifestyle";
import * as appAdv from "../web/advisory";
import * as appBucket from "../web/bucket-strategy";
import * as appJourney from "../web/journey-to-freedom";
import * as appFamily from "../web/family-wealth";
import * as appGp from "../web/goal-planning-calc";
import { inr, inrCompact } from "../fmt";
import type { ResultBlock } from "../types";

declare const __dirname: string;
const nodeRequire: any = require;
const fs = nodeRequire("fs");
const path = nodeRequire("path");
const ts = nodeRequire("typescript");

const WEB_COMPONENTS: string = path.resolve(__dirname, "../../../../../src/components/calculators");

/**
 * Evaluate a WEB component's inline maths: `pieces` are [start, end) source
 * ranges of top-level helpers; `memo` is the inside of a useMemo (between its
 * opening marker and the closing "}, [" of its deps), bound as `memoAs`;
 * `extra` are [start, end) ranges of component-body statements after it; `ret`
 * is the expression returned. Free variables (state, imported helpers) come
 * from `scope`.
 */
function webInline(
  file: string,
  o: { pieces?: Array<[string, string]>; memo?: [string, string]; memoAs?: string; extra?: Array<[string, string]>; ret: string },
  scope: Record<string, any> = {},
): any {
  const src: string = fs.readFileSync(path.join(WEB_COMPONENTS, `${file}.tsx`), "utf8").replace(/\r\n/g, "\n");
  const cut = (start: string, end: string, keepStart = true): string => {
    const i = src.indexOf(start);
    if (i < 0) throw new Error(`${file}: no "${start}"`);
    const j = src.indexOf(end, i + start.length);
    if (j < 0) throw new Error(`${file}: no "${end}" after "${start}"`);
    return src.slice(keepStart ? i : i + start.length, j);
  };
  const code = [
    "function __web() {",
    ...(o.pieces ?? []).map(([s, e]) => cut(s, e)),
    ...(o.memo ? [`const ${o.memoAs ?? "__memo"} = (() => {${cut(o.memo[0], o.memo[1], false)}\n})();`] : []),
    ...(o.extra ?? []).map(([s, e]) => cut(s, e)),
    `return (${o.ret});`,
    "}",
  ].join("\n");
  const { outputText } = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } });
  // eslint-disable-next-line no-new-func
  return new Function(...Object.keys(scope), `${outputText}\nreturn __web();`)(...Object.values(scope));
}

const webInrShort: (n: number) => string = webInline("charts", { pieces: [["function inrShort(", "export function LinesChart"]], ret: "inrShort" });

const webAdv = webModule<typeof appAdv>("calculators/advisory");
const webBucket = webModule<typeof appBucket>("calculators/bucket-strategy");
const webJourney = webModule<typeof appJourney>("calculators/journey-to-freedom");
const webFamily = webModule<typeof appFamily>("calculators/family-wealth");
const webGp = webModule<typeof appGp>("goal-planning/calc");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));
const hintOf = (b: ResultBlock[], label: string) => {
  const s = b.find((x) => x.type === "stat" && x.label === label);
  return s && s.type === "stat" ? s.hint : undefined;
};
const year = new Date().getFullYear();

describe("every Dreams / Essentials / Engagement def", () => {
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

describe("passiveincome — Financial-Freedom Builder", () => {
  const base = { targetMonthlyToday: 100000, inflationPct: 6, postReturnPct: 9, yearsToFreedom: 15, existingCorpus: 0, buildReturnPct: 12, payoutYears: 0 };
  it("prints the web's default case, with the lumpsum beside the SIP", () => {
    const w = webAdv.passiveIncome(base);
    const b = run(DEFS.passiveincome);
    expect(statOf(b, "Invest this much every month")).toBe(`${inr(Math.round(w.requiredSip))}/mo`);
    expect(hintOf(b, "Invest this much every month")).toBe(`You're financially free in ${year + 15}`);
    expect(statOf(b, "Income in 15 yrs")).toBe(`${inr(Math.round(w.futureMonthly))}/mo`);
    expect(statOf(b, "Income in 15 yrs")).toBe("₹2,39,656/mo");
    expect(statOf(b, "Corpus needed")).toBe(webInrShort(w.corpusNeeded));
    expect(statOf(b, "Monthly SIP")).toBe(inr(Math.round(w.requiredSip)));
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(Math.round(w.lumpsumToday)));
    expect(texts(b, "insight")[0]).toBe(`To draw ₹1,00,000/month (≈ ₹2,39,656/mo after 6% inflation) forever, without ever touching the principal, your client needs a corpus of ${webInrShort(w.corpusNeeded)} — built with about ${inr(Math.round(w.requiredSip))}/month for 15 years, or a one-time lumpsum of about ${inr(Math.round(w.lumpsumToday))} invested today.`);
  });
  it.each([
    { ...base, payoutYears: 25, existingCorpus: 2500000, yearsToFreedom: 20 },
    { ...base, payoutYears: 30, buildReturnPct: 10, targetMonthlyToday: 60000 },
  ])("passiveIncome equals the web module (%#)", (c) => {
    const w = webAdv.passiveIncome(c);
    expect(appAdv.passiveIncome(c)).toEqual(w);
    const b = run(DEFS.passiveincome, {
      targetMonthly: c.targetMonthlyToday, inflation: c.inflationPct, postReturn: c.postReturnPct, yearsToFreedom: c.yearsToFreedom,
      existing: c.existingCorpus, buildReturn: c.buildReturnPct, payout: String(c.payoutYears),
    });
    expect(statOf(b, "Monthly SIP")).toBe(inr(Math.round(w.requiredSip)));
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(Math.round(w.lumpsumToday)));
    expect(texts(b, "insight")[0]).toContain(`for ${c.payoutYears} years, your client needs`);
  });
  it("shows — when income forever cannot beat inflation", () => {
    const b = run(DEFS.passiveincome, { postReturn: 6 });
    expect(statOf(b, "Monthly SIP")).toBe("—");
    expect(statOf(b, "Or one-time lumpsum today")).toBe("—");
    expect(texts(b, "insight")[0]).toBe("Income forever needs a post-freedom return above inflation — raise it or pick a fixed period.");
  });
});

describe("wedding — Dream Wedding Planner", () => {
  it("prints the web's default case, with the lumpsum beside the SIP", () => {
    const w = webAdv.inflatedGoalSip({ costToday: 3000000, years: 15, inflationPct: 7, existingSavings: 0, returnPct: 12 });
    const b = run(DEFS.wedding);
    expect(statOf(b, "Start a SIP of")).toBe(`${inr(Math.round(w.requiredSip))}/mo`);
    expect(statOf(b, "Cost in 15 yrs")).toBe(webInrShort(w.futureCost));
    expect(statOf(b, "Monthly SIP needed")).toBe(inr(Math.round(w.requiredSip)));
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(Math.round(w.lumpsumToday)));
    expect(texts(b, "insight")[0]).toBe(`A ₹30.0 L wedding today becomes ${webInrShort(w.futureCost)} in 15 years at 7% inflation. A SIP of ${inr(Math.round(w.requiredSip))}/month — or a one-time lumpsum of ${inr(Math.round(w.lumpsumToday))} invested today — funds it calmly, instead of breaking an FD or taking a loan at the last minute.`);
  });
  it.each([
    { costToday: 6000000, years: 8, inflationPct: 8, existingSavings: 500000, returnPct: 11, preset: "p2" },
    { costToday: 1800000, years: 4, inflationPct: 6, existingSavings: 0, returnPct: 10, preset: "custom" },
  ])("inflatedGoalSip equals the web module (%#)", ({ preset, ...c }) => {
    const w = webAdv.inflatedGoalSip(c);
    expect(appAdv.inflatedGoalSip(c)).toEqual(w);
    const b = run(DEFS.wedding, { preset, cost: preset === "custom" ? c.costToday : 1, years: c.years, inflation: c.inflationPct, existing: c.existingSavings, returnPct: c.returnPct });
    expect(statOf(b, "Monthly SIP needed")).toBe(inr(Math.round(w.requiredSip)));
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(Math.round(w.lumpsumToday)));
  });
});

describe("dreamcar — Dream Car, Invest First", () => {
  const base = { carPriceToday: 1500000, yearsToBuy: 4, carInflationPct: 6, investReturnPct: 11, downPaymentPct: 20, loanRatePct: 9.5, loanYears: 5 };
  it("prints the web's default case, with the lumpsum beside the SIP", () => {
    const w = webAdv.dreamCar(base);
    const b = run(DEFS.dreamcar);
    expect(statOf(b, "Car price in 4 yrs")).toBe(webInrShort(w.futurePrice));
    expect(statOf(b, "Invest-first SIP")).toBe(`${inr(Math.round(w.sipToBuyCash))}/mo`);
    expect(statOf(b, "Or invest-first lumpsum today")).toBe(inr(Math.round(w.lumpsumToBuyCash)));
    expect(statOf(b, "Auto-loan EMI")).toBe(`${inr(Math.round(w.emi))}/mo`);
    expect(statOf(b, "Loan interest paid")).toBe(webInrShort(w.loanInterest));
    expect(texts(b, "insight")[0]).toContain(`A one-time lumpsum of ${inr(Math.round(w.lumpsumToBuyCash))} invested today does the same with no monthly SIP.`);
  });
  it("dreamCar equals the web module", () => {
    const c = { ...base, carPriceToday: 2500000, yearsToBuy: 6, loanRatePct: 0, loanYears: 7, downPaymentPct: 35 };
    const w = webAdv.dreamCar(c);
    expect(appAdv.dreamCar(c)).toEqual(w);
    const b = run(DEFS.dreamcar, { price: c.carPriceToday, yearsToBuy: 6, loanRate: 0, loanYears: 7, downPct: 35 });
    expect(statOf(b, "Auto-loan EMI")).toBe(`${inr(Math.round(w.emi))}/mo`);
    expect(statOf(b, "Or invest-first lumpsum today")).toBe(inr(Math.round(w.lumpsumToBuyCash)));
  });
  it("asks for a buy-in year when it is 0", () => {
    expect(texts(run(DEFS.dreamcar, { yearsToBuy: 0 }), "insight")[0]).toBe("Set “Buy in” to at least 1 year to compare investing first with the loan.");
  });
});

describe("youthbucket — 4-Bucket Strategy", () => {
  const base = {
    monthlyExpenseToday: 80000, inflationPct: 6, ageNow: 25, freedomAge: 41, longevity: 90,
    debtReturnPct: 8, hybridReturnPct: 10, largeCapReturnPct: 12, midCapReturnPct: 15,
  };
  it("prints the web's default case, with the lumpsums beside the SIPs", () => {
    const w = webBucket.youthBucketStrategy(base);
    const b = run(DEFS.youthbucket);
    expect(statOf(b, "SIP with the 4-bucket strategy")).toBe(`${inr(Math.round(w.sipBucket))}/mo`);
    expect(hintOf(b, "SIP with the 4-bucket strategy")).toBe(`${(w.savingsPct * 100).toFixed(0)}% lower than the ${inr(Math.round(w.sipWithout))}/mo a single debt fund would need — freedom at 41 for your client`);
    expect(statOf(b, "Corpus — bucket strategy")).toBe(webInrShort(w.corpusBucket));
    expect(statOf(b, "SIP — single fund")).toBe(`${inr(Math.round(w.sipWithout))}/mo`);
    expect(statOf(b, "Or lumpsum today — bucket strategy")).toBe(webInrShort(w.lumpsumBucket));
    expect(statOf(b, "Or lumpsum today — single fund")).toBe(webInrShort(w.lumpsumWithout));
    const [t] = tables(b);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual(["Bucket 1 · Debt", "8%", "41–51", inr(Math.round(w.buckets[0].expenseAtStart)), webInrShort(w.buckets[0].pvAtFreedom)]);
  });
  it.each([
    { ...base, ageNow: 30, freedomAge: 50, longevity: 75 },
    { ...base, ageNow: 45, freedomAge: 45 },
  ])("youthBucketStrategy equals the web module (%#)", (c) => {
    const w = webBucket.youthBucketStrategy(c);
    expect(appBucket.youthBucketStrategy(c)).toEqual(w);
    const b = run(DEFS.youthbucket, { ageNow: c.ageNow, freedomAge: c.freedomAge, longevity: c.longevity });
    expect(statOf(b, "Corpus — single fund")).toBe(webInrShort(w.corpusWithout));
    expect(statOf(b, "SIP — bucket strategy")).toBe(w.yearsToFreedom <= 0 ? "—" : `${inr(Math.round(w.sipBucket))}/mo`);
  });
});

describe("journey — Journey to Freedom", () => {
  it("prints the web's default case", () => {
    const w = webJourney.journeyToFreedom({ salaryMonthly: 50000, expensesMonthly: 30000, inflationPct: 5, returnPct: 12, maxYears: 30 });
    const b = run(DEFS.journey);
    expect(w.freedomYear).not.toBeNull();
    expect(statOf(b, "You reach Financial Freedom in")).toBe(`${w.freedomYear} years`);
    expect(statOf(b, "Investable surplus")).toBe("₹20,000/mo");
    expect(statOf(b, "Freedom corpus needed")).toBe(webInrShort(w.freedomCorpus));
    expect(statOf(b, "Corpus at freedom")).toBe(webInrShort(w.corpusAtFreedom!));
    const [t] = tables(b);
    expect(t.rows).toHaveLength(w.freedomYear! + 1);
    expect(t.rows[w.freedomYear! - 1][2]).toBe("Forever ✓");
    expect(t.rows[0]).toEqual(["1", webInrShort(w.rows[0].corpus), `${w.rows[0].yearsOfFreedom.toFixed(1)} yrs`]);
  });
  it.each([
    { salaryMonthly: 120000, expensesMonthly: 70000, inflationPct: 6, returnPct: 11, maxYears: 30 },
    { salaryMonthly: 40000, expensesMonthly: 38000, inflationPct: 7, returnPct: 9, maxYears: 30 },
  ])("journeyToFreedom equals the web module (%#)", (c) => {
    const w = webJourney.journeyToFreedom(c);
    expect(appJourney.journeyToFreedom(c)).toEqual(w);
    const b = run(DEFS.journey, { salary: c.salaryMonthly, expenses: c.expensesMonthly, inflation: c.inflationPct, returnPct: c.returnPct });
    expect(statOf(b, "Investable surplus")).toBe(`${inr(w.investmentMonthly)}/mo`);
    expect(tables(b)[0].rows).toHaveLength(w.freedomYear === null ? 12 : w.freedomYear + 1);
  });
  it("says there is nothing to invest when expenses meet income", () => {
    const b = run(DEFS.journey, { expenses: 50000 });
    expect(texts(b, "insight")[0]).toBe("Expenses meet or exceed income, so there’s nothing to invest yet. Trim spending or grow income to begin the journey.");
    expect(tables(b)).toHaveLength(0);
  });
});

describe("familywealth — Family Wealth Plan", () => {
  const CLASSES = [
    { name: "Equity", allocationPct: 70, returnPct: 12 },
    { name: "Hybrid", allocationPct: 10, returnPct: 10 },
    { name: "Debt", allocationPct: 10, returnPct: 7 },
    { name: "Others", allocationPct: 10, returnPct: 8 },
  ];
  it("prints the web's default case (year-1 total ₹18,85,300)", () => {
    const input = { lumpsum: 500000, monthlySip: 100000, currentAge: 30, targetAge: 60, classes: CLASSES };
    const w = webFamily.familyWealthPlan(input);
    expect(w.series[1].total).toBeCloseTo(1885300, 6);
    expect(appFamily.familyWealthPlan(input)).toEqual(w);
    const b = run(DEFS.familywealth);
    expect(statOf(b, "Surplus")).toBe("₹1,32,000/mo");
    expect(statOf(b, "Total wealth at age 60")).toBe(webInrShort(w.finalTotal));
    expect(hintOf(b, "Total wealth at age 60")).toBe(`over 30 years, from ${inr(w.totalInvested)} invested`);
    expect(statOf(b, "Wealth multiple")).toBe(`${(w.finalTotal / w.totalInvested).toFixed(1)}×`);
    expect(statOf(b, "Blended return")).toBe(`${w.blendedReturnPct.toFixed(1)}%`);
    const [byClass, years] = tables(b);
    expect(byClass.rows[0]).toEqual(["Equity", webInrShort(w.finalByClass[0]), `${((w.finalByClass[0] / w.finalTotal) * 100).toFixed(0)}%`]);
    expect(years.rows.map((r) => r[1])).toEqual(["0", "5", "10", "15", "20", "25", "30"]);
  });
  it("uses the surplus as the SIP, and flags an allocation that is not 100%", () => {
    const classes = CLASSES.map((c, i) => (i === 0 ? { ...c, allocationPct: 80 } : c));
    const w = webFamily.familyWealthPlan({ lumpsum: 500000, monthlySip: 132000, currentAge: 30, targetAge: 55, classes });
    const b = run(DEFS.familywealth, { useSurplus: true, targetAge: 55, alloc0: 80 });
    expect(statOf(b, "Corpus at 55")).toBe(webInrShort(w.finalTotal));
    expect(texts(b, "insight")[0]).toBe("Asset allocation: Total 110% — normalised to 100%");
    expect(texts(b, "insight")[1]).toContain("Investing ₹5,00,000 today plus ₹1,32,000/month across this mix");
  });
});

describe("emergency — Emergency Fund Planner", () => {
  it("prints the web's default case, with the lumpsum beside the SIP", () => {
    const w = webAdv.emergencyFund({ monthlyExpense: 60000, monthsBuffer: 6, existing: 50000, buildMonths: 12, parkReturnPct: 6 });
    const b = run(DEFS.emergency);
    expect(statOf(b, "Target fund")).toBe("₹3.6 L");
    expect(statOf(b, "Still needed")).toBe("₹3.1 L");
    expect(statOf(b, "Monthly SIP")).toBe(`${inr(Math.round(w.requiredSip))}/mo`);
    expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(Math.round(w.lumpsumToday)));
    expect(texts(b, "insight")[0]).toBe(`A 6-month safety net is ₹3.6 L. Your client can build the ₹3.1 L gap with about ${inr(Math.round(w.requiredSip))}/month over 12 months — or a one-time ${inr(Math.round(w.lumpsumToday))} parked today.`);
  });
  it.each([
    { monthlyExpense: 90000, monthsBuffer: 12, existing: 200000, buildMonths: 24, parkReturnPct: 7, buffer: "12" },
    { monthlyExpense: 40000, monthsBuffer: 3, existing: 150000, buildMonths: 6, parkReturnPct: 5, buffer: "3" },
  ])("emergencyFund equals the web module (%#)", ({ buffer, ...c }) => {
    const w = webAdv.emergencyFund(c);
    expect(appAdv.emergencyFund(c)).toEqual(w);
    const b = run(DEFS.emergency, { expense: c.monthlyExpense, buffer, existing: c.existing, buildMonths: c.buildMonths, parkReturn: c.parkReturnPct });
    if (w.gap <= 0) {
      expect(statOf(b, "Still needed")).toBe("Fully funded ✓");
      expect(statOf(b, "Or one-time lumpsum today")).toBe("—");
    } else {
      expect(statOf(b, "Or one-time lumpsum today")).toBe(inr(Math.round(w.lumpsumToday)));
    }
  });
});

describe("buckets — Retirement Bucket Strategy", () => {
  it("prints the web's default case", () => {
    // ₹5 Cr, ₹1.5 L/month (₹18 L a year): 3 yrs cash ₹54 L, 7 yrs debt ₹1.26 Cr, the rest ₹3.2 Cr in equity.
    const b = run(DEFS.buckets);
    expect(statOf(b, "Bucket 1 · Cash")).toBe("₹54.0 L");
    expect(statOf(b, "Bucket 2 · Debt")).toBe("₹1.26 Cr");
    expect(statOf(b, "Bucket 3 · Equity")).toBe("₹3.20 Cr");
    expect(hintOf(b, "Bucket 2 · Debt")).toBe("Years 4–10 — short-term debt");
    expect(texts(b, "insight")[0]).toBe("On ₹5.00 Cr with ₹1,50,000/month spending: keep ₹54.0 L in cash (the next 3 years are crash-proof), ₹1.26 Cr in debt, and let ₹3.20 Cr compound in equity. Refill Bucket 1 from Bucket 2, and Bucket 2 from equity in good years — so the retiree never sells equity in a downturn.");
  });
  it("retirementBuckets equals the web module (a short corpus)", () => {
    const c = { corpus: 4000000, monthlyExpense: 150000, bucket1Years: 3, bucket2Years: 7 };
    const w = webAdv.retirementBuckets(c);
    expect(appAdv.retirementBuckets(c)).toEqual(w);
    const b = run(DEFS.buckets, { corpus: c.corpus });
    expect(statOf(b, "Bucket 1 · Cash")).toBe(webInrShort(w.b1));
    // Bucket 1 funds only 40 L ÷ 18 L = 2.2 years of the 3 asked.
    expect(texts(b, "insight")[0]).toContain("(the next 2.2 years are crash-proof)");
  });
});

describe("sippause — Cost of Pausing a SIP", () => {
  it("prints the web's default case", () => {
    const w = webAdv.sipPauseCost({ monthlySip: 25000, returnPct: 12, yearsRemaining: 20, monthsSkipped: 6 });
    const b = run(DEFS.sippause);
    expect(statOf(b, "Skipping 6 SIPs costs the goal")).toBe(webInrShort(w.costAtHorizon));
    expect(hintOf(b, "Skipping 6 SIPs costs the goal")).toBe(`on just ₹1,50,000 of skipped contributions — a ${(w.costAtHorizon / w.contributed).toFixed(1)}× loss`);
    expect(statOf(b, "Contributions skipped")).toBe("₹1,50,000");
  });
  it.each([
    { monthlySip: 10000, returnPct: 14, yearsRemaining: 25, monthsSkipped: 1 },
    { monthlySip: 50000, returnPct: 10, yearsRemaining: 2, monthsSkipped: 36 },
  ])("sipPauseCost equals the web module (%#)", (c) => {
    const w = webAdv.sipPauseCost(c);
    expect(appAdv.sipPauseCost(c)).toEqual(w);
    const b = run(DEFS.sippause, { sip: c.monthlySip, returnPct: c.returnPct, yearsRemaining: c.yearsRemaining, monthsSkipped: c.monthsSkipped });
    expect(statOf(b, "Contributions skipped")).toBe(inr(w.contributed));
    expect(statOf(b, "Lost at goal date")).toBe(webInrShort(w.costAtHorizon));
  });
  it("says SIP, not SIPs, for one month", () => {
    expect(statOf(run(DEFS.sippause, { monthsSkipped: 1 }), "Skipping 1 SIP costs the goal")).toBeDefined();
  });
});

describe("budget — Monthly Budget Planner", () => {
  const webBudget = (g: BudgetGroups, projectReturn: number, projectYears: number) => webInline("MonthlyBudgetPlanner", {
    pieces: [["const sum = ", "function GroupEditor"], ["const COLORS", "export function MonthlyBudgetPlanner"]],
    memo: ["const m = useMemo(() => {", "\n  }, ["],
    memoAs: "m",
    extra: [["  const rows = [", "\n  return ("]],
    ret: "{ m, rows, score, bars, surplusToInvest, surplusCorpus }",
  }, { ...g, projectReturn, projectYears, fvSip: webGp.fvSip });
  const DEFAULTS: BudgetGroups = {
    inflows: { income: 150000, additional: 0, rental: 0, spouse: 50000 },
    essential: { rent: 35000, propertyTax: 1000, utilities: 6000, groceries: 15000, transport: 6000, medical: 3000, schoolFees: 12000, insurance: 5000 },
    lifestyle: { maid: 4000, shopping: 6000, travel: 5000, dine: 6000 },
    emis: { home: 30000, car: 10000, personal: 0, other: 0 },
    invest: { mf: 20000, stocks: 5000, fd: 5000, others: 0 },
  };
  // The web's rows also carry a colour; the app's do not.
  const noColour = (x: any) => ({ ...x, rows: x.rows.map(({ color, ...r }: any) => r), bars: x.bars.map(({ color, ...r }: any) => r) });

  it("prints the web's default case", () => {
    // Inflow ₹2,00,000; essential ₹83,000 + lifestyle ₹21,000 + EMIs ₹40,000 + investments ₹30,000 = ₹1,74,000 → ₹26,000 leftover.
    const w = webBudget(DEFAULTS, 12, 20);
    expect(monthlyBudget(DEFAULTS, 12, 20)).toEqual(noColour(w));
    const b = run(DEFS.budget);
    expect(statOf(b, "Total inflow")).toBe("₹2,00,000/mo");
    expect(statOf(b, "Total outflow")).toBe("₹1,74,000/mo");
    expect(statOf(b, "Leftover")).toBe("₹26,000/mo");
    expect(statOf(b, "Savings rate")).toBe(`${(w.m.savingsRate * 100).toFixed(0)}%`);
    expect(statOf(b, "Score")).toBe(`${w.score}/5`);
    const health = tables(b).find((t) => t.head[3] === "Verdict")!;
    expect(health.rows).toEqual(w.rows.map((r: any) => [r.name, inr(r.val), `${(r.pct * 100).toFixed(0)}%`, r.ok ? `✓ ${r.good}` : `⚠ ${r.bad}`]));
    expect(texts(b, "insight")[0]).toBe(`Investing the ₹26,000/month leftover becomes ${webInrShort(w.surplusCorpus)} in 20 years.`);
  });
  it("monthlyBudget equals the web component's maths", () => {
    const g: BudgetGroups = JSON.parse(JSON.stringify(DEFAULTS));
    g.inflows.spouse = 0;
    g.emis.personal = 15000;
    const w = webBudget(g, 10, 15);
    expect(monthlyBudget(g, 10, 15)).toEqual(noColour(w));
    const b = run(DEFS.budget, { inflows_spouse: 0, emis_personal: 15000, projectReturn: 10, projectYears: 15 });
    expect(statOf(b, "Leftover")).toBe(`${inr(w.m.leftout)}/mo`);
    expect(statOf(b, "Score")).toBe(`${w.score}/5`);
    expect(texts(b, "insight")[1]).toContain(`${5 - w.score} area(s) need attention.`);
  });
});

describe("quiz — Money Personality Quiz", () => {
  const web = webInline("MoneyPersonalityQuiz", { pieces: [["const QUESTIONS", "export function MoneyPersonalityQuiz"]], ret: "{ QUESTIONS, profileFor }" });
  const answers = (picks: number[]) => Object.fromEntries(picks.map((p, i) => [`q${i + 1}`, String(p)]));

  it("asks the web's questions and scores them as the web does", () => {
    expect(QUESTIONS).toEqual(web.QUESTIONS);
    for (let s = 8; s <= 32; s++) expect(profileFor(s)).toEqual(web.profileFor(s));
  });
  it("waits for all eight answers", () => {
    expect(texts(run(DEFS.quiz), "note")).toEqual(["0/8 answered — finish all to reveal the profile."]);
    expect(texts(run(DEFS.quiz, { q1: "2", q2: "1", q5: "0" }), "note")).toEqual(["3/8 answered — finish all to reveal the profile."]);
  });
  it.each([
    [[0, 0, 0, 0, 0, 0, 0, 0], 8],
    [[1, 2, 1, 2, 1, 2, 1, 2], 20],
    [[3, 3, 3, 3, 3, 3, 3, 3], 32],
  ])("reveals the profile for %j", (picks, score) => {
    const p = web.profileFor(score);
    const b = run(DEFS.quiz, answers(picks));
    expect(statOf(b, "You are")).toBe(p.name);
    expect(hintOf(b, "You are")).toBe(p.tagline);
    expect(statOf(b, "Risk score")).toBe(`${score} / 32`);
    expect(tables(b)[0].rows).toEqual([["Equity", `${p.equity}%`], ["Debt", `${p.debt}%`], ["Gold", `${p.gold}%`]]);
  });
});

describe("timemachine — Inflation Time Machine", () => {
  it("prints the web's default case", () => {
    const w = webAdv.timeMachine({ amount: 5000000, fromYear: year, toYear: year + 20, inflationPct: 6 });
    const b = run(DEFS.timemachine);
    const label = `₹50,00,000 in ${year} will need to be`;
    expect(statOf(b, label)).toBe(inr(Math.round(w.equivalent)));
    expect(statOf(b, label)).toBe("₹1,60,35,677");
    expect(hintOf(b, label)).toBe(`to buy the same things in ${year + 20} (20 years later)`);
    expect(statOf(b, "🎬 Movie ticket")).toBe(`₹250 → ${inr(Math.round(250 * Math.pow(1.06, 20)))}`);
    expect(statOf(b, "🏠 ₹1 Cr today")).toBe(`₹1.00 Cr → ${webInrShort(10000000 * Math.pow(1.06, 20))}`);
    expect(texts(b, "insight")[0]).toBe("At 6% inflation, money kept idle loses roughly half its value every ~12 years. Beating inflation isn’t optional — it’s the whole point of investing.");
  });
  it("timeMachine equals the web module, backwards too", () => {
    const c = { amount: 100000, fromYear: 2000, toYear: 1990, inflationPct: 7 };
    const w = webAdv.timeMachine(c);
    expect(appAdv.timeMachine(c)).toEqual(w);
    const b = run(DEFS.timemachine, { amount: 100000, fromYear: 2000, toYear: 1990, inflation: 7 });
    expect(statOf(b, "₹1,00,000 in 2000 had the buying power of")).toBe(inr(Math.round(w.equivalent)));
    expect(hintOf(b, "₹1,00,000 in 2000 had the buying power of")).toBe("to buy the same things in 1990 (10 years earlier)");
  });
});

describe("doubling — Wealth Doubling", () => {
  it("prints the web's default case", () => {
    const w = webAdv.doublingTimeline({ amount: 1000000, returnPct: 12, doublings: 4 });
    const b = run(DEFS.doubling);
    expect(statOf(b, "Money doubles every")).toBe("6.1 yrs");
    expect(statOf(b, "Rule of 72 estimate")).toBe("6.0 yrs");
    const [t] = tables(b);
    expect(t.rows).toEqual(w.rows.map((r) => [`${r.multiple}×`, webInrShort(r.value), `${r.years.toFixed(1)} yrs`, String(year + Math.round(r.years))]));
    expect(t.rows[3][1]).toBe("₹1.60 Cr");
  });
  it.each([
    { amount: 250000, returnPct: 8, doublings: 6 },
    { amount: 500000, returnPct: 0, doublings: 3 },
  ])("doublingTimeline equals the web module (%#)", (c) => {
    const w = webAdv.doublingTimeline(c);
    expect(appAdv.doublingTimeline(c)).toEqual(w);
    const b = run(DEFS.doubling, c);
    expect(tables(b)[0].rows).toHaveLength(c.doublings);
    if (c.returnPct <= 0) {
      expect(statOf(b, "Money doubles every")).toBe("—");
      expect(texts(b, "insight")[0]).toBe("At 0% p.a. money never doubles — enter a positive return.");
    } else {
      expect(statOf(b, "Money doubles every")).toBe(`${w.yearsToDouble.toFixed(1)} yrs`);
    }
  });
});
