/**
 * Advisor Tools: each def against the web CRM — the web maths module run on
 * the same inputs (webModule), and, for the calculators whose maths lives
 * inline in the web component, that component's own source code sliced out and
 * evaluated here (webInline), so a change to the web's formulas fails this test.
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import {
  DEFS, portfolioHealth, fundOverlap, aumOpportunity, reviewAverages, realStatement, realChecks, REAL_DEFAULTS,
  type OverlapRow, type RealGroups,
} from "../defs/advisor";
import * as appGp from "../web/goal-planning-calc";
import * as appXirr from "../web/xirr";
import * as appReb from "../web/rebalance";
import * as appDrag from "../web/expense-drag";
import * as appAar from "../web/asset-allocation-review";
import * as appPp from "../web/portfolio-projection";
import { inr, inrCompact, fmtPct } from "../fmt";
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

/** The web's own formatters (ui.tsx inr, charts.tsx inrShort). */
const webInr: (n: number) => string = webInline("ui", { pieces: [["function inr(", "/** Clamp"]], ret: "inr" });
const webInrShort: (n: number) => string = webInline("charts", { pieces: [["function inrShort(", "export function LinesChart"]], ret: "inrShort" });

const webGp = webModule<typeof appGp>("goal-planning/calc");
const webXirr = webModule<typeof appXirr>("calculators/xirr");
const webReb = webModule<typeof appReb>("calculators/rebalance");
const webDrag = webModule<typeof appDrag>("calculators/expense-drag");
const webAar = webModule<typeof appAar>("calculators/asset-allocation-review");
const webPp = webModule<typeof appPp>("calculators/portfolio-projection");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));

describe("every Advisor Tools def", () => {
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
  it("formats exactly as the web's inr / inrShort", () => {
    for (const n of [0, 999, 47_59_314.4, -1234, 1e7 + 1, 12_34_567, 2.5e5]) {
      expect(inr(n)).toBe(webInr(n));
      expect(inrCompact(n)).toBe(webInrShort(n));
    }
  });
});

describe("portfoliohealth — Portfolio Health Score", () => {
  const webHealth = (state: Record<string, any>) => webInline("PortfolioHealthScore", {
    pieces: [["const TARGETS", "export function PortfolioHealthScore"]],
    memo: ["const result = useMemo(() => {", "\n  }, ["],
    ret: "__memo",
  }, { inr: webInr, ...state });
  const DEFAULTS = {
    risk: "balanced", portfolioValue: 5000000, fundCount: 12, equityPct: 72, debtPct: 18, goldPct: 5, cashPct: 5,
    goalMappedPct: 45, requiredSip: 50000, activeSip: 28000, underperformers: 3, monthsSinceReview: 11,
  } as const;

  it("prints the web's default case", () => {
    // Balanced 60/30/5/5: allocation 18.14 + diversification 12 + goals 9 + SIP 8.4 + review 5 + quality 11.25 → 64.
    const b = run(DEFS.portfoliohealth);
    expect(statOf(b, "Health score")).toBe("64/100");
    expect(statOf(b, "Band")).toBe("Needs review");
    expect(statOf(b, "Unmapped portfolio")).toBe("₹27,50,000");
    expect(statOf(b, "Review priority")).toBe("35/100");
    const w = webHealth(DEFAULTS);
    expect(statOf(b, "Health score")).toBe(`${w.score}/100`);
    expect(tables(b)[0].rows[5]).toEqual(["Monthly SIP gap", webInr(w.sipGap), "Close goal funding gap"]);
    expect(texts(b, "insight")[0]).toBe(`This portfolio scores 64/100. ${w.band.next} Biggest RM talking point: ${w.actions[0]}`);
    expect(texts(b, "insight")[1]).toBe(`Conversation notes: ${w.actions.join(" ")} Potential review value at stake: ${webInrShort(w.unmappedValue)}.`);
  });
  it.each([
    { ...DEFAULTS, risk: "aggressive", fundCount: 30, equityPct: 40, debtPct: 50, goldPct: 0, cashPct: 10, goalMappedPct: 90, requiredSip: 0, underperformers: 0, monthsSinceReview: 2 },
    { ...DEFAULTS, risk: "conservative", fundCount: 6, portfolioValue: 18000000, goalMappedPct: 10, activeSip: 80000, underperformers: 1, monthsSinceReview: 20 },
  ] as const)("portfolioHealth equals the web component's maths (%#)", (c) => {
    const w = webHealth(c);
    expect(portfolioHealth(c as any)).toEqual(w);
    const b = run(DEFS.portfoliohealth, c);
    expect(statOf(b, "Health score")).toBe(`${w.score}/100`);
    expect(statOf(b, "Unmapped portfolio")).toBe(webInr(w.unmappedValue));
    expect(statOf(b, "Review priority")).toBe(`${w.reviewPriority}/100`);
  });
});

describe("fundoverlap — Fund Overlap", () => {
  const webOverlap = (rows: OverlapRow[], reviewThreshold: number) => webInline("FundOverlapCalculator", {
    pieces: [["function pct(", "export function FundOverlapCalculator"]],
    memo: ["const result = useMemo(() => {", "\n  }, ["],
    ret: "__memo",
  }, { rows, reviewThreshold });
  const mk = (id: number, fundName: string, category: string, value: number, overlapPct: number, underperformancePct = 0): OverlapRow =>
    ({ id, fundName, category, value, overlapPct, underperformancePct });
  const WEB_ROWS = [
    mk(1, "Large Cap Fund A", "Large Cap", 900000, 68, 1.2),
    mk(2, "Large Cap Fund B", "Large Cap", 650000, 72, 0.8),
    mk(3, "Flexi Cap Fund", "Flexi Cap", 850000, 46, 0),
    mk(4, "Index Fund", "Index", 600000, 58, 0),
    mk(5, "Mid Cap Fund", "Mid Cap", 500000, 24, 0),
  ];

  it("prints the web's default case", () => {
    const w = webOverlap(WEB_ROWS, 55);
    const b = run(DEFS.fundoverlap);
    expect(statOf(b, "Funds entered")).toBe("5");
    expect(statOf(b, "Effective funds")).toBe(w.effectiveFundCount.toFixed(1));
    expect(statOf(b, "Overlap risk")).toBe(`${w.overlapRisk}/100`);
    const [signals, cats] = tables(b);
    expect(signals.rows.map((r) => r[5])).toEqual(["Review", "Review", "Keep", "Review", "Keep"]);
    expect(signals.rows[0].slice(0, 3)).toEqual(["Large Cap Fund A", "Large Cap", "₹9,00,000"]);
    expect(cats.rows[0]).toEqual(["Large Cap", "2", "₹15,50,000", "70%"]);
    expect(texts(b, "insight")[0]).toBe(`This portfolio has 5 funds, but behaves like roughly ${w.effectiveFundCount.toFixed(1)} differentiated funds. Duplicate-category value is ${webInr(w.duplicateValue)}.`);
    expect(texts(b, "insight")[1]).toContain(`Consolidation candidates: ${w.candidates.length} funds, representing ${webInr(w.possibleTrim)}.`);
  });
  it("fundOverlap equals the web component's maths", () => {
    const rows = [
      ...WEB_ROWS,
      mk(6, "Small Cap A", "Small Cap", 300000, 30, 2.5),
      mk(7, "Small Cap B", "Small Cap", 450000, 61, 0),
      mk(8, "New fund", "Flexi Cap", 0, 0),
    ];
    for (const threshold of [55, 40, 80]) expect(fundOverlap(rows, threshold)).toEqual(webOverlap(rows, threshold));
    const w = webOverlap(rows, 40);
    const over: Record<string, any> = { count: 8, reviewThreshold: 40 };
    rows.forEach((r, i) => Object.assign(over, { [`cat${i + 1}`]: r.category, [`value${i + 1}`]: r.value, [`overlap${i + 1}`]: r.overlapPct, [`under${i + 1}`]: r.underperformancePct }));
    const b = run(DEFS.fundoverlap, over);
    expect(statOf(b, "Funds entered")).toBe("8");
    expect(statOf(b, "Effective funds")).toBe(w.effectiveFundCount.toFixed(1));
    expect(texts(b, "insight")[1]).toContain(webInr(w.possibleTrim));
  });
});

describe("aumopportunity — AUM Opportunity", () => {
  const webAum = (state: Record<string, any>) => webInline("AumOpportunityCalculator", {
    pieces: [["const URGENCY", "export function AumOpportunityCalculator"]],
    memo: ["const result = useMemo(() => {", "\n  }, ["],
    ret: "__memo",
  }, { fvLumpsum: webGp.fvLumpsum, fvSip: webGp.fvSip, ...state });
  const DEFAULTS = {
    currentAum: 5000000, currentSip: 25000, monthlyIncome: 300000, targetSavingsPct: 20, idleCash: 700000, fdAmount: 2500000,
    lowYieldInsurance: 1000000, bonusExpected: 500000, familyAssetsOutside: 4000000, stoppedSip: 15000, capturePct: 35,
    returnPct: 11, urgency: "medium",
  } as const;

  it("prints the web's default case", () => {
    // SIP upgrade = (₹3,00,000 × 20% − ₹25,000) + ₹15,000 stopped = ₹50,000.
    const w = webAum(DEFAULTS);
    const b = run(DEFS.aumopportunity);
    expect(statOf(b, "SIP upgrade / month")).toBe("₹50,000");
    expect(statOf(b, "Immediate AUM opportunity")).toBe(webInr(w.immediateOpportunity));
    expect(statOf(b, "12-month book impact")).toBe(webInr(w.oneYearAum));
    expect(statOf(b, "Priority score")).toBe(`${w.priorityScore}/100`);
    expect(statOf(b, "5-year AUM impact")).toBe(webInr(w.fiveYearAum));
    expect(tables(b)[0].rows[5]).toEqual(["SIP upgrade annualised", "₹6,00,000", "Salary-linked step-up SIP"]);
    expect(texts(b, "insight")[0]).toBe(`This opportunity should be prioritised at ${w.priorityScore}/100. Lead with ${w.firstPitch}, then close the SIP upgrade of ₹50,000/month.`);
  });
  it.each([
    { ...DEFAULTS, urgency: "high", capturePct: 70, idleCash: 3000000 },
    { ...DEFAULTS, urgency: "low", capturePct: 0, currentAum: 0, returnPct: 0 },
  ] as const)("aumOpportunity equals the web component's maths (%#)", (c) => {
    const w = webAum(c);
    expect(aumOpportunity(c as any)).toEqual(w);
    const b = run(DEFS.aumopportunity, c);
    expect(statOf(b, "Immediate AUM opportunity")).toBe(webInr(w.immediateOpportunity));
    expect(statOf(b, "Wallet-share lift in year 1")).toBe(`${w.walletShareLiftPct.toFixed(1)}%`);
  });
});

describe("xirr — XIRR", () => {
  it("prints the web's default cashflows", () => {
    const flows = [
      { date: "2021-04-01", amount: -100000 },
      { date: "2022-04-01", amount: -100000 },
      { date: "2023-04-01", amount: -100000 },
      { date: "2026-06-11", amount: 420000 },
    ];
    const w = webXirr.computeXirr(flows);
    const b = run(DEFS.xirr);
    expect(statOf(b, "XIRR (annualised)")).toBe(`${w.xirrPct!.toFixed(2)}%`);
    expect(statOf(b, "Total invested")).toBe("₹3,00,000");
    expect(statOf(b, "Total value / returned")).toBe("₹4,20,000");
    expect(statOf(b, "Absolute return")).toBe("40.0%");
    expect(texts(b, "insight")[0]).toBe(`These cashflows earned an annualised ${w.xirrPct!.toFixed(2)}% XIRR — a net gain of ₹1,20,000 on ₹3,00,000 invested. XIRR is the rate that fairly accounts for when each rupee went in or came out.`);
  });
  it.each([
    [{ date: "2020-01-15", amount: -50000 }, { date: "2020-07-15", amount: -25000 }, { date: "2023-03-31", amount: 98000 }],
    [{ date: "2024-01-01", amount: -200000 }, { date: "2024-06-01", amount: 30000 }, { date: "2025-01-01", amount: -50000 }, { date: "2026-01-01", amount: 190000 }],
  ])("computeXirr equals the web module (%#)", (...flows) => {
    const w = webXirr.computeXirr(flows);
    expect(appXirr.computeXirr(flows)).toEqual(w);
    const over: Record<string, any> = { count: flows.length };
    flows.forEach((f, i) => Object.assign(over, { [`date${i + 1}`]: f.date, [`kind${i + 1}`]: f.amount < 0 ? "invest" : "inflow", [`amount${i + 1}`]: Math.abs(f.amount) }));
    const b = run(DEFS.xirr, over);
    expect(statOf(b, "XIRR (annualised)")).toBe(`${w.xirrPct!.toFixed(2)}%`);
    expect(statOf(b, "Total invested")).toBe(inr(w.totalInvested));
  });
  it("says why when there is no XIRR", () => {
    const b = run(DEFS.xirr, { kind4: "invest" });
    expect(statOf(b, "XIRR (annualised)")).toBe("—");
    expect(texts(b, "insight")[0]).toBe("Add at least one investment (negative) and one inflow/value (positive) with valid dates to compute XIRR.");
  });
});

describe("rebalance — Portfolio Rebalancing", () => {
  const WEB_ROWS = [
    { assetClass: "Equity", currentValue: 1400000, targetPct: 60 },
    { assetClass: "Debt", currentValue: 700000, targetPct: 30 },
    { assetClass: "Gold", currentValue: 100000, targetPct: 10 },
  ];
  it("prints the web's default case", () => {
    // ₹22 L at 60/30/10 → Equity ₹13.2 L (sell ₹80,000), Debt ₹6.6 L (sell ₹40,000), Gold ₹2.2 L (buy ₹1.2 L).
    const b = run(DEFS.rebalance);
    expect(statOf(b, "Portfolio value")).toBe("₹22,00,000");
    expect(statOf(b, "To buy")).toBe("₹1,20,000");
    expect(statOf(b, "To sell")).toBe("₹1,20,000");
    expect(tables(b)[0].rows).toEqual([
      ["Equity", "₹14,00,000", "63.6%", "60%", "₹13,20,000", "Sell ₹80,000", "—"],
      ["Debt", "₹7,00,000", "31.8%", "30%", "₹6,60,000", "Sell ₹40,000", "—"],
      ["Gold", "₹1,00,000", "4.5%", "10%", "₹2,20,000", "Buy ₹1,20,000", "—"],
    ]);
    expect(texts(b, "insight")[0]).toBe("Rebalancing realigns risk to plan. Selling ₹1,20,000 of the overweight classes may trigger capital-gains tax.");
  });
  it.each([300000, 50000])("computeRebalance equals the web module with ₹%d of new money", (newMoney) => {
    const rows = [...WEB_ROWS, { assetClass: "Intl", currentValue: 250000, targetPct: 5 }];
    const w = webReb.computeRebalance(rows, newMoney);
    expect(appReb.computeRebalance(rows, newMoney)).toEqual(w);
    const b = run(DEFS.rebalance, { newMoney, count: 4, class4: "Intl", current4: 250000, target4: 5 });
    expect(statOf(b, "After new money")).toBe(inr(w.totalAfter));
    expect(statOf(b, "To sell")).toBe(inr(w.totalSell));
    expect(texts(b, "insight")[0]).toBe("Target allocation should total 100% (currently 105%).");
  });
});

describe("expensedrag — Expense-Ratio Drag", () => {
  it("prints the web's default case", () => {
    const w = webDrag.computeExpenseDrag({ lumpsum: 0, monthlySip: 25000, years: 20, grossReturnPct: 13, expenseRatioAPct: 1.5, expenseRatioBPct: 0.6 });
    const b = run(DEFS.expensedrag);
    expect(statOf(b, "Option A (1.5% ER → 11.5%)")).toBe(inr(w.fvA));
    expect(statOf(b, "Option B (0.6% ER → 12.4%)")).toBe(inr(w.fvB));
    expect(statOf(b, "Cost of the higher ER")).toBe(inr(w.drag));
    expect(tables(b)[0].rows).toHaveLength(20);
    expect(texts(b, "insight")[0]).toContain(`A 0.9% higher expense ratio quietly costs ${inr(w.drag)} over 20 years`);
  });
  it.each([
    { lumpsum: 500000, monthlySip: 10000, years: 35, grossReturnPct: 12, expenseRatioAPct: 2.1, expenseRatioBPct: 0.9 },
    { lumpsum: 1000000, monthlySip: 0, years: 7, grossReturnPct: 10, expenseRatioAPct: 1, expenseRatioBPct: 1 },
  ])("computeExpenseDrag equals the web module (%#)", (c) => {
    const w = webDrag.computeExpenseDrag(c);
    expect(appDrag.computeExpenseDrag(c)).toEqual(w);
    const b = run(DEFS.expensedrag, c);
    expect(statOf(b, `Option A (${fmtPct(c.expenseRatioAPct)} ER → ${fmtPct(w.netReturnA)})`)).toBe(inr(w.fvA));
    expect(statOf(b, "As % of corpus")).toBe(`${w.dragPctOfCorpus.toFixed(1)}%`);
  });
});

describe("review — Review of Investments", () => {
  const webAverages = (rows: Array<{ perf: Record<string, number | ""> }>, shownPeriods: Array<{ key: string }>) =>
    webInline("ReviewOfInvestments", {
      extra: [["  const averages: Record<string, number | null> = {};", "\n  return ("]],
      ret: "averages",
    }, { rows, shownPeriods });

  it("shows the web's default columns and an empty average", () => {
    const b = run(DEFS.review);
    const [t] = tables(b);
    expect(t.head).toEqual(["Asset class", "Category", "Scheme", "6 mth", "1 Year", "3 Year", "5 Year", "10 Year"]);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual(["Equity", "Large Cap", "—", "—", "—", "—", "—", "—"]);
    expect(t.rows[3]).toEqual(["Average (unweighted)", "", "", "—", "—", "—", "—", "—"]);
  });
  it("averages typed returns the way the web does (blank is no figure, minus kept)", () => {
    const perfs = [{ y1: 12.5, y3: "" as const }, { y1: -3, y3: 0 }, { y1: "" as const, y3: 14.2 }];
    const shown = [{ key: "y1" }, { key: "y3" }, { key: "y10" }];
    const w = webAverages(perfs.map((perf) => ({ perf })), shown);
    expect(reviewAverages(perfs as any, shown as any)).toEqual(w);
    const b = run(DEFS.review, {
      ac2: "Custom", acCustom2: "PMS", cat3: "Gilt",
      p1_y1: "12.5", p2_y1: "-3", p2_y3: "0", p3_y3: "14.2",
    });
    const [t] = tables(b);
    expect(t.rows[1].slice(0, 2)).toEqual(["PMS", "Large Cap"]);
    expect(t.rows[0][4]).toBe("12.5%");
    expect(t.rows[1][4]).toBe("-3%");
    expect(t.rows[3]).toEqual(["Average (unweighted)", "", "", "—", `${w.y1.toFixed(2)}%`, `${w.y3.toFixed(2)}%`, "—", "—"]);
    expect(t.rows[3][4]).toBe("4.75%");
  });
  it("has no average row for a single scheme", () => {
    const [t] = tables(run(DEFS.review, { count: 1 }));
    expect(t.rows).toHaveLength(1);
  });
});

describe("allocreview — Asset Allocation Review", () => {
  const over = (e: appAar.AllocRow[], s: appAar.AllocRow[]) => {
    const o: Record<string, any> = {};
    e.forEach((r, i) => Object.assign(o, { [`e${i}a`]: r.amount, [`e${i}r`]: r.returnPct }));
    s.forEach((r, i) => Object.assign(o, { [`s${i}a`]: r.amount, [`s${i}r`]: r.returnPct }));
    return o;
  };
  it("prints the web's default case", () => {
    const w = webAar.computeAssetAllocationReview(webAar.EXISTING_DEFAULTS, webAar.SUGGESTED_DEFAULTS, { horizonA: 5, horizonB: 10 });
    const b = run(DEFS.allocreview);
    expect(statOf(b, "Existing value (5y)")).toBe(inr(w.existing.valueA));
    expect(statOf(b, "Suggested value (10y)")).toBe(inr(w.suggested.valueB));
    expect(statOf(b, "Extra in 10 years")).toBe(inr(w.upliftB));
    expect(texts(b, "section")).toEqual([
      "1. Existing vs Suggested — the uplift", "2. Asset mix by risk bucket", "3. Projected growth (next 10 years)",
      "4. Existing portfolio — sleeve detail", "5. Suggested portfolio — sleeve detail",
    ]);
    const sleeves = tables(b)[2];
    expect(sleeves.rows[sleeves.rows.length - 1]).toEqual([
      "Total", `${inr(w.existing.lumpsumCorpus)} + ₹1,00,000/mo`, "100%", `${w.existing.blendedReturnPct.toFixed(2)}%`, inr(w.existing.valueA), inr(w.existing.valueB),
    ]);
  });
  it("computeAssetAllocationReview equals the web module", () => {
    const e = webAar.EXISTING_DEFAULTS.map((r, i) => ({ amount: r.amount + i * 50000, returnPct: r.returnPct + 0.5 }));
    const s = webAar.SUGGESTED_DEFAULTS.map((r) => ({ amount: r.amount * 2, returnPct: r.returnPct }));
    const w = webAar.computeAssetAllocationReview(e, s, { horizonA: 3, horizonB: 15 });
    expect(appAar.computeAssetAllocationReview(e, s, { horizonA: 3, horizonB: 15 })).toEqual(w);
    const b = run(DEFS.allocreview, { horizonA: 3, horizonB: 15, ...over(e, s) });
    expect(statOf(b, "Extra in 3 years")).toBe(inr(w.upliftA));
    expect(statOf(b, "Existing value (15y)")).toBe(inr(w.existing.valueB));
  });
});

describe("realstatement — REAL Statement", () => {
  const webReal = (g: RealGroups) => webInline("RealStatement", {
    pieces: [["const sum = ", "function GroupEditor"], ["const C = {", "export function RealStatement"]],
    memo: ["const m = useMemo(() => {", "\n  }, ["],
    memoAs: "m",
    extra: [["  const mix = [", "\n  return ("]],
    ret: "{ m, checks, score, mix }",
  }, g as any);

  it("prints the web's worked example (the defaults)", () => {
    const w = webReal(REAL_DEFAULTS);
    const b = run(DEFS.realstatement);
    // Income ₹1,60,833/mo; expenses ₹80,500/mo → ₹80,333 surplus.
    expect(statOf(b, "Total income (annual)")).toBe("₹19,29,996");
    expect(statOf(b, "Surplus for new investments")).toBe("₹80,333/mo");
    expect(statOf(b, "Notional net worth")).toBe(webInr(w.m.notionalNW));
    expect(statOf(b, "Actual net worth")).toBe(webInr(w.m.actualNW));
    expect(statOf(b, "Score")).toBe(`${w.score}/4`);
    const ratios = tables(b).find((t) => t.head[0] === "Ratio")!;
    expect(ratios.rows).toEqual(w.checks.map((c: any) => [c.name, c.val, c.ok ? `✓ ${c.good}` : `⚠ ${c.bad}`]));
  });
  it("realStatement equals the web component's maths", () => {
    const g: RealGroups = JSON.parse(JSON.stringify(REAL_DEFAULTS));
    g.emis.homeEmi = 65000;
    g.ongoing.mfSip = 30000;
    g.liabilities.creditCard = 120000;
    g.liquid.savingsBank = 20000;
    const w = webReal(g);
    const m = realStatement(g);
    expect(m).toEqual(w.m);
    expect(realChecks(m)).toEqual({ checks: w.checks, score: w.score });
    const b = run(DEFS.realstatement, { emis_homeEmi: 65000, ongoing_mfSip: 30000, liabilities_creditCard: 120000, liquid_savingsBank: 20000 });
    expect(statOf(b, "Surplus for new SIPs")).toBe(`${webInr(w.m.surplusM)}/mo`);
    expect(statOf(b, "Score")).toBe(`${w.score}/4`);
    const mix = tables(b).find((t) => t.head[0] === "Asset")!;
    expect(mix.rows[0]).toEqual(["Equity", webInrShort(w.mix[0].value), `${((w.mix[0].value / w.m.investable) * 100).toFixed(0)}%`]);
  });
});

describe("portproj — Portfolio Projection", () => {
  it("prints the web's reference case to the rupee", () => {
    // portfolio-projection.ts: ₹25 L, ₹2 L a year (+₹50,000), SIP ₹25,000 (+₹5,000), 12%, 20 yrs → ₹6,32,51,914 vs ₹9,95,74,779.
    const b = run(DEFS.portproj);
    expect(statOf(b, "Value in 20 yrs — current plan")).toBe("₹6,32,51,914");
    expect(statOf(b, "Value in 20 yrs — increased plan")).toBe("₹9,95,74,779");
    const [components, years] = tables(b);
    expect(components.rows[3]).toEqual(["Total", "₹6,32,51,914", "₹9,95,74,779"]);
    expect(years.rows).toHaveLength(20);
    expect(texts(b, "note")[0]).toBe("In the increased plan the yearly lumpsum is ₹2,50,000 every year, and the SIP goes up by ₹5,000 every year starting this year (₹30,000, then ₹35,000, …).");
  });
  it.each([
    { portfolioValue: 1000000, annualLumpsum: 0, annualLumpsumIncrease: 0, monthlySip: 15000, sipIncrease: 2000, ratePct: 10, years: 15, mode: "incremental" },
    { portfolioValue: 4000000, annualLumpsum: 300000, annualLumpsumIncrease: 0, monthlySip: 0, sipIncrease: 0, ratePct: 11, years: 12, mode: "current" },
  ] as const)("portfolioProjection equals the web module (%#)", (c) => {
    const w = webPp.portfolioProjection(c);
    expect(appPp.portfolioProjection(c)).toEqual(w);
    const b = run(DEFS.portproj, c);
    expect(statOf(b, `Value in ${c.years} yrs — current plan`)).toBe(inr(w.current.components.total));
    expect(statOf(b, "Invested — current plan")).toBe(inr(w.current.totalInvested));
    if (c.mode === "current") expect(statOf(b, "Invested — increased plan")).toBeUndefined();
  });
});
