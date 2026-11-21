/**
 * Advisor Tools — mirrors the web group of the same name
 * (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def. Where the web
 * component keeps its maths inline (no lib module), the maths is copied here
 * verbatim, with the source file and function named above it.
 *
 * The web's add-a-row lists (funds, cashflows, asset classes, schemes) are a
 * fixed number of slots here, with a count input standing in for the web's
 * "+ Add" / remove buttons; each slot's default is the web's pre-filled row
 * (or the row the web's "+ Add" creates).
 */

import type { CalcBody, InputSpec, ResultBlock, SchemePick, Tone } from "../types";
import { inr, fmtPct, inrCompact as inrShort } from "../fmt";
import { fvLumpsum, fvSip } from "../web/goal-planning-calc";
import { computeXirr, type DatedCashflow } from "../web/xirr";
import { computeRebalance, type Holding } from "../web/rebalance";
import { computeExpenseDrag } from "../web/expense-drag";
import {
  ALLOC_CLASSES, computeAssetAllocationReview, EXISTING_DEFAULTS, SUGGESTED_DEFAULTS, type AllocRow, type PortfolioResult,
} from "../web/asset-allocation-review";
import { portfolioProjection, type PortfolioProjectionMode } from "../web/portfolio-projection";
import { TONE, stat, section, table, insight, note, opts } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** How many of a calculator's fixed slots are in use (the web's row count). */
const slotCount = (v: Record<string, any>, key: string, min: number, max: number): number => {
  const n = Math.round(Number(v[key]));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

type WebTone = "emerald" | "amber" | "rose" | "cyan";
const toneOf = (t: WebTone): Tone => TONE[t];

/* ───────────────────────── Portfolio Health Score ───────────────────────── */

// Copied verbatim from src/components/calculators/PortfolioHealthScore.tsx
// (TARGETS, clamp, allocationScore, scoreBand and the component's `result` useMemo).
type RiskProfile = "conservative" | "balanced" | "aggressive";
type ScoreTone = "emerald" | "amber" | "rose" | "cyan";

const TARGETS: Record<RiskProfile, { equity: number; debt: number; gold: number; cash: number; label: string }> = {
  conservative: { equity: 35, debt: 50, gold: 10, cash: 5, label: "Conservative" },
  balanced: { equity: 60, debt: 30, gold: 5, cash: 5, label: "Balanced" },
  aggressive: { equity: 80, debt: 15, gold: 5, cash: 0, label: "Aggressive" },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function allocationScore(current: number, target: number, weight: number): number {
  const gap = Math.abs(current - target);
  return weight * clamp(1 - gap / 35, 0, 1);
}

function scoreBand(score: number): { label: string; tone: ScoreTone; next: string } {
  if (score >= 80) return { label: "Healthy", tone: "emerald", next: "Maintain allocation and schedule periodic reviews." };
  if (score >= 60) return { label: "Needs review", tone: "amber", next: "Prioritise rebalancing and goal mapping." };
  return { label: "Action required", tone: "rose", next: "Run a full portfolio review before adding fresh money." };
}

export type PortfolioHealthInput = {
  risk: RiskProfile; portfolioValue: number; fundCount: number; equityPct: number; debtPct: number; goldPct: number;
  cashPct: number; goalMappedPct: number; requiredSip: number; activeSip: number; underperformers: number; monthsSinceReview: number;
};

export function portfolioHealth({
  risk, portfolioValue, fundCount, equityPct, debtPct, goldPct, cashPct, goalMappedPct, requiredSip, activeSip, underperformers, monthsSinceReview,
}: PortfolioHealthInput) {
  const t = TARGETS[risk];
  const allocation =
    allocationScore(equityPct, t.equity, 12) +
    allocationScore(debtPct, t.debt, 8) +
    allocationScore(goldPct, t.gold, 3) +
    allocationScore(cashPct, t.cash, 2);

  const diversification =
    fundCount <= 0 ? 0
      : fundCount <= 8 ? 15
        : fundCount <= 15 ? 12
          : fundCount <= 24 ? 8
            : 4;
  const goalMapping = clamp(goalMappedPct, 0, 100) * 0.2;
  const sipCoverage = requiredSip <= 0 ? 15 : clamp(activeSip / requiredSip, 0, 1) * 15; // max 15 — keeps the score ≤ 100
  const review = monthsSinceReview <= 3 ? 10 : monthsSinceReview <= 6 ? 8 : monthsSinceReview <= 12 ? 5 : 2;
  const quality = 15 * clamp(1 - underperformers / Math.max(1, fundCount), 0, 1);

  const score = Math.round(allocation + diversification + goalMapping + sipCoverage + review + quality);
  const band = scoreBand(score);
  const allocationDrift = Math.abs(equityPct - t.equity) + Math.abs(debtPct - t.debt) + Math.abs(goldPct - t.gold) + Math.abs(cashPct - t.cash);
  const unmappedValue = portfolioValue * (1 - clamp(goalMappedPct, 0, 100) / 100);
  const sipGap = Math.max(0, requiredSip - activeSip);
  const reviewPriority = clamp(
    Math.round((100 - score) * 0.55 + Math.min(25, allocationDrift * 0.4) + Math.min(20, unmappedValue / 500000)),
    0,
    100,
  );

  const actions = [
    allocationDrift > 25 ? "Rebalance asset allocation before adding fresh equity exposure." : "Allocation is close enough for a regular review.",
    goalMappedPct < 70 ? `Map ${inr(unmappedValue)} to specific goals.` : "Goal mapping is strong.",
    sipGap > 0 ? `Increase SIP by ${inr(sipGap)}/month to cover the plan gap.` : "SIP coverage is adequate.",
    underperformers > 0 ? `Review ${underperformers} underperforming fund${underperformers === 1 ? "" : "s"}.` : "No underperforming fund count entered.",
  ];

  return {
    target: t,
    score,
    band,
    allocation,
    diversification,
    goalMapping,
    sipCoverage,
    review,
    quality,
    allocationDrift,
    unmappedValue,
    sipGap,
    reviewPriority,
    actions,
  };
}

/** PortfolioHealthScore.tsx — Portfolio Health Score (inline maths above). The
 *  component-score bar chart is not drawn. */
const portfoliohealth: CalcBody = {
  inputs: [
    { key: "risk", label: "Risk profile", type: "segmented", default: "balanced", options: opts([["conservative", "Conservative"], ["balanced", "Balanced"], ["aggressive", "Aggressive"]]) },
    { key: "portfolioValue", label: "Portfolio value (INR)", type: "money", default: 5000000 },
    { key: "fundCount", label: "No. of funds", type: "int", default: 12 },
    { key: "equityPct", label: "Equity allocation (%)", type: "percent", default: 72 },
    { key: "debtPct", label: "Debt allocation (%)", type: "percent", default: 18 },
    { key: "goldPct", label: "Gold allocation (%)", type: "percent", default: 5 },
    { key: "cashPct", label: "Cash allocation (%)", type: "percent", default: 5 },
    { key: "goalMappedPct", label: "Goal mapped (%)", type: "percent", default: 45 },
    { key: "requiredSip", label: "Required SIP / month", type: "money", default: 50000 },
    { key: "activeSip", label: "Active SIP / month", type: "money", default: 28000 },
    { key: "underperformers", label: "Underperforming funds", type: "int", default: 3 },
    { key: "monthsSinceReview", label: "Months since review", type: "int", default: 11 },
  ],
  compute: (v) => {
    const risk: RiskProfile = v.risk === "conservative" || v.risk === "aggressive" ? v.risk : "balanced";
    const equityPct = nn(v.equityPct);
    const debtPct = nn(v.debtPct);
    const goldPct = nn(v.goldPct);
    const cashPct = nn(v.cashPct);
    const portfolioValue = nn(v.portfolioValue);
    const result = portfolioHealth({
      risk, portfolioValue, fundCount: nn(v.fundCount), equityPct, debtPct, goldPct, cashPct,
      goalMappedPct: nn(v.goalMappedPct), requiredSip: nn(v.requiredSip), activeSip: nn(v.activeSip),
      underperformers: nn(v.underperformers), monthsSinceReview: nn(v.monthsSinceReview),
    });
    const bandTone = toneOf(result.band.tone);
    const talkingPoint = result.actions.find((a) => !a.includes("strong") && !a.includes("adequate")) ?? result.actions[0];
    return [
      stat("Health score", `${result.score}/100`, bandTone),
      stat("Band", result.band.label, bandTone),
      stat("Unmapped portfolio", inr(result.unmappedValue), result.unmappedValue > 0 ? "warning" : "success"),
      stat("Review priority", `${result.reviewPriority}/100`, result.reviewPriority >= 70 ? "danger" : result.reviewPriority >= 45 ? "warning" : "success"),
      table(
        ["Metric", "Current", "Target / guide"],
        [
          ["Equity", `${equityPct}%`, `${result.target.equity}%`],
          ["Debt", `${debtPct}%`, `${result.target.debt}%`],
          ["Gold", `${goldPct}%`, `${result.target.gold}%`],
          ["Cash", `${cashPct}%`, `${result.target.cash}%`],
          ["Goal-mapped value", inr(portfolioValue - result.unmappedValue), `${result.target.label} plan`],
          ["Monthly SIP gap", inr(result.sipGap), "Close goal funding gap"],
        ],
      ),
      insight(`This portfolio scores ${result.score}/100. ${result.band.next} Biggest RM talking point: ${talkingPoint}`, bandTone),
      insight(`Conversation notes: ${result.actions.join(" ")} Potential review value at stake: ${inrShort(result.unmappedValue)}.`, "brand"),
    ];
  },
};

/* ───────────────────────── Fund Overlap ───────────────────────── */

// Copied verbatim from src/components/calculators/FundOverlapCalculator.tsx
// (CATEGORIES, pct and the component's `result` useMemo).
export type OverlapRow = {
  id: number;
  fundName: string;
  category: string;
  value: number;
  overlapPct: number;
  underperformancePct: number;
};

const CATEGORIES = [
  "Large Cap",
  "Flexi Cap",
  "Large & Mid Cap",
  "Mid Cap",
  "Small Cap",
  "ELSS",
  "Index",
  "Hybrid",
  "Debt",
  "Gold",
  "Other",
];

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function fundOverlap(rows: OverlapRow[], reviewThreshold: number) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const count = rows.length;
  const weightedOverlap = total <= 0 ? 0 : rows.reduce((sum, r) => sum + r.value * clamp(r.overlapPct, 0, 100), 0) / total;
  const categoryMap = new Map<string, OverlapRow[]>();
  for (const r of rows) {
    categoryMap.set(r.category, [...(categoryMap.get(r.category) ?? []), r]);
  }
  const duplicateFunds = [...categoryMap.values()].reduce((sum, group) => sum + Math.max(0, group.length - 1), 0);
  const duplicateValue = [...categoryMap.values()].reduce((sum, group) => {
    if (group.length <= 1) return sum;
    const sorted = [...group].sort((a, b) => b.value - a.value);
    return sum + sorted.slice(1).reduce((s, r) => s + r.value, 0);
  }, 0);
  const overlapCompression = (weightedOverlap / 100) * Math.max(0, count - 1);
  const duplicateCompression = duplicateFunds * 0.35;
  const effectiveFundCount = clamp(count - overlapCompression - duplicateCompression, 1, count);
  const overlapRisk = Math.round(clamp(weightedOverlap * 0.55 + duplicateFunds * 8 + count * 1.2, 0, 100));
  // The largest fund in each duplicate category is the one consolidation keeps,
  // so it is not counted in the trim total.
  const keepers = new Set(
    [...categoryMap.values()].filter((g) => g.length > 1).map((g) => [...g].sort((a, b) => b.value - a.value)[0].id),
  );
  const candidates = rows
    .filter((r) => !keepers.has(r.id))
    .filter((r) => r.overlapPct >= reviewThreshold || r.underperformancePct >= 1 || (categoryMap.get(r.category)?.length ?? 0) > 1)
    .sort((a, b) => b.overlapPct + b.underperformancePct * 8 - (a.overlapPct + a.underperformancePct * 8));
  const possibleTrim = candidates.reduce((sum, r) => sum + r.value, 0);
  const categoryRows = [...categoryMap.entries()]
    .map(([category, group]) => ({
      category,
      funds: group.length,
      value: group.reduce((sum, r) => sum + r.value, 0),
      avgOverlap: group.reduce((sum, r) => sum + r.overlapPct, 0) / group.length,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    total,
    count,
    weightedOverlap,
    duplicateFunds,
    duplicateValue,
    effectiveFundCount,
    overlapRisk,
    candidates,
    possibleTrim,
    categoryRows,
  };
}

/** The web's pre-filled rows (mk(...)), then the row "+ Add fund" creates. */
const OVERLAP_ROWS: Array<[string, string, number, number, number]> = [
  ["Large Cap Fund A", "Large Cap", 900000, 68, 1.2],
  ["Large Cap Fund B", "Large Cap", 650000, 72, 0.8],
  ["Flexi Cap Fund", "Flexi Cap", 850000, 46, 0],
  ["Index Fund", "Index", 600000, 58, 0],
  ["Mid Cap Fund", "Mid Cap", 500000, 24, 0],
];
const OVERLAP_SLOTS = 10;
const overlapSlot = (i: number): [string, string, number, number, number] => OVERLAP_ROWS[i] ?? ["New fund", "Flexi Cap", 0, 0, 0];

/** FundOverlapCalculator.tsx — Fund Overlap (inline maths above). Funds are
 *  ten slots ("Number of funds" shows the first N); a fund is picked from the
 *  Scheme Master, and an unpicked slot keeps the web's row name. The web's
 *  per-row Review / Keep signal is shown as the first results table; the
 *  category bar chart is not drawn. */
const fundoverlap: CalcBody = {
  inputs: [
    { key: "reviewThreshold", label: "Review threshold overlap (%)", type: "percent", default: 55 },
    { key: "count", label: "Number of funds", type: "int", default: OVERLAP_ROWS.length, min: 1, max: OVERLAP_SLOTS },
    ...Array.from({ length: OVERLAP_SLOTS }, (_, i): InputSpec[] => {
      const [, category, value, overlapPct, underPct] = overlapSlot(i);
      const shown = (v: Record<string, any>) => i < slotCount(v, "count", 1, OVERLAP_SLOTS);
      return [
        { key: `fund${i + 1}`, label: "Fund", type: "scheme", default: null, section: `Fund ${i + 1}`, visibleIf: shown },
        { key: `cat${i + 1}`, label: "Category", type: "select", default: category, options: opts(CATEGORIES.map((c): [string, string] => [c, c])), visibleIf: shown },
        { key: `value${i + 1}`, label: "Value (₹)", type: "money", default: value, visibleIf: shown },
        { key: `overlap${i + 1}`, label: "Overlap (%)", type: "percent", default: overlapPct, visibleIf: shown },
        { key: `under${i + 1}`, label: "Underperformance (%)", type: "percent", default: underPct, visibleIf: shown },
      ];
    }).flat(),
  ],
  compute: (v) => {
    const reviewThreshold = nn(v.reviewThreshold);
    const n = slotCount(v, "count", 1, OVERLAP_SLOTS);
    const rows: OverlapRow[] = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      fundName: (v[`fund${i + 1}`] as SchemePick)?.name ?? overlapSlot(i)[0],
      category: CATEGORIES.includes(v[`cat${i + 1}`]) ? v[`cat${i + 1}`] : overlapSlot(i)[1],
      value: nn(v[`value${i + 1}`]),
      overlapPct: clamp(nn(v[`overlap${i + 1}`]), 0, 100),
      underperformancePct: nn(v[`under${i + 1}`]),
    }));
    const result = fundOverlap(rows, reviewThreshold);
    const riskTone: Tone = result.overlapRisk >= 70 ? "danger" : result.overlapRisk >= 45 ? "warning" : "success";
    return [
      table(
        ["Fund", "Category", "Value", "Overlap", "Underperformance", "Signal"],
        rows.map((r) => {
          const duplicate = rows.some((x) => x.id !== r.id && x.category === r.category);
          const risky = r.overlapPct >= reviewThreshold || r.underperformancePct >= 1 || duplicate;
          return [r.fundName, r.category, inr(r.value), pct(r.overlapPct), pct(r.underperformancePct), risky ? "Review" : "Keep"];
        }),
      ),
      stat("Funds entered", `${result.count}`),
      stat("Effective funds", result.effectiveFundCount.toFixed(1), "brand"),
      stat("Weighted overlap", pct(result.weightedOverlap), result.weightedOverlap >= 55 ? "danger" : result.weightedOverlap >= 35 ? "warning" : "success"),
      stat("Overlap risk", `${result.overlapRisk}/100`, riskTone),
      table(["Category", "Funds", "Value", "Avg overlap"], result.categoryRows.map((r) => [r.category, `${r.funds}`, inr(r.value), pct(r.avgOverlap)])),
      insight(`This portfolio has ${result.count} funds, but behaves like roughly ${result.effectiveFundCount.toFixed(1)} differentiated funds. Duplicate-category value is ${inr(result.duplicateValue)}.`, riskTone),
      insight(`Consolidation candidates: ${result.candidates.length} funds, representing ${inr(result.possibleTrim)}. Start with high-overlap funds in duplicate categories before switching good performers.`, "brand"),
    ];
  },
};

/* ───────────────────────── AUM Opportunity ───────────────────────── */

// Copied verbatim from src/components/calculators/AumOpportunityCalculator.tsx
// (URGENCY, toneFor and the component's `result` useMemo).
type Urgency = "low" | "medium" | "high";

const URGENCY: { value: Urgency; label: string; multiplier: number }[] = [
  { value: "low", label: "Low", multiplier: 0.85 },
  { value: "medium", label: "Medium", multiplier: 1 },
  { value: "high", label: "High", multiplier: 1.2 },
];

function toneFor(score: number): WebTone {
  if (score >= 75) return "emerald";
  if (score >= 50) return "amber";
  return "rose";
}

export type AumOpportunityInput = {
  currentAum: number; currentSip: number; monthlyIncome: number; targetSavingsPct: number; idleCash: number; fdAmount: number;
  lowYieldInsurance: number; bonusExpected: number; familyAssetsOutside: number; stoppedSip: number; capturePct: number;
  returnPct: number; urgency: Urgency;
};

export function aumOpportunity({
  currentAum, currentSip, monthlyIncome, targetSavingsPct, idleCash, fdAmount, lowYieldInsurance, bonusExpected,
  familyAssetsOutside, stoppedSip, capturePct, returnPct, urgency,
}: AumOpportunityInput) {
  const investableSavings = (monthlyIncome * targetSavingsPct) / 100;
  const sipUpgrade = Math.max(0, investableSavings - currentSip) + stoppedSip;
  const capture = clamp(capturePct, 0, 100) / 100;
  const urgencyMultiplier = URGENCY.find((u) => u.value === urgency)?.multiplier ?? 1;

  // Urgency scales each source (so the rows add up to the headline); 0%
  // confidence captures nothing, and no source can exceed 100% of itself.
  const share = (rate: number) => (capture > 0 ? Math.min(1, rate * urgencyMultiplier) : 0);
  const idleCashOpp = idleCash * share(Math.min(0.8, capture + 0.15));
  const fdOpp = fdAmount * share(capture);
  const insuranceOpp = lowYieldInsurance * share(Math.min(0.65, capture + 0.05));
  const bonusOpp = bonusExpected * share(Math.min(0.75, capture + 0.1));
  const familyOpp = familyAssetsOutside * share(Math.min(0.5, capture * 0.75));

  const immediateOpportunity = idleCashOpp + fdOpp + insuranceOpp + bonusOpp + familyOpp;
  const annualSipOpportunity = sipUpgrade * 12;
  const oneYearAum = immediateOpportunity + annualSipOpportunity;
  const fiveYearAum = fvLumpsum(immediateOpportunity, returnPct, 60) + fvSip(sipUpgrade, returnPct, 60);
  const walletShareLiftPct = currentAum <= 0 ? 100 : (oneYearAum / currentAum) * 100;
  const priorityScore = Math.round(clamp(
    Math.log10(Math.max(1, oneYearAum)) * 12 +
    walletShareLiftPct * 0.9 +
    (urgency === "high" ? 15 : urgency === "medium" ? 8 : 0) +
    (sipUpgrade > 0 ? 10 : 0),
    0,
    100,
  ));
  const firstPitch =
    idleCashOpp >= fdOpp && idleCashOpp >= familyOpp ? "Idle money deployment"
      : fdOpp >= familyOpp ? "FD maturity / tax-efficient migration"
        : "Family wallet-share review";

  return {
    investableSavings,
    sipUpgrade,
    idleCashOpp,
    fdOpp,
    insuranceOpp,
    bonusOpp,
    familyOpp,
    immediateOpportunity,
    annualSipOpportunity,
    oneYearAum,
    fiveYearAum,
    walletShareLiftPct,
    priorityScore,
    firstPitch,
  };
}

/** AumOpportunityCalculator.tsx — AUM Opportunity (inline maths above). The
 *  opportunity bar chart is not drawn. */
const aumopportunity: CalcBody = {
  inputs: [
    { key: "urgency", label: "Urgency", type: "segmented", default: "medium", options: opts([["medium", "Medium"], ["high", "High"], ["low", "Low"]]) },
    { key: "capturePct", label: "Conversion confidence (%)", type: "percent", default: 35 },
    { key: "currentAum", label: "Current MF AUM", type: "money", default: 5000000 },
    { key: "currentSip", label: "Current SIP / month", type: "money", default: 25000 },
    { key: "monthlyIncome", label: "Monthly income", type: "money", default: 300000 },
    { key: "targetSavingsPct", label: "Target saving rate (%)", type: "percent", default: 20 },
    { key: "idleCash", label: "Idle bank cash", type: "money", default: 700000 },
    { key: "fdAmount", label: "FD / low-yield corpus", type: "money", default: 2500000 },
    { key: "lowYieldInsurance", label: "Insurance maturity / surrender", type: "money", default: 1000000 },
    { key: "bonusExpected", label: "Bonus / upcoming cash", type: "money", default: 500000 },
    { key: "familyAssetsOutside", label: "Family assets outside", type: "money", default: 4000000 },
    { key: "stoppedSip", label: "Stopped SIP / month", type: "money", default: 15000 },
    { key: "returnPct", label: "Assumed return (%)", type: "percent", default: 11 },
  ],
  compute: (v) => {
    const urgency: Urgency = v.urgency === "high" || v.urgency === "low" ? v.urgency : "medium";
    const returnPct = nn(v.returnPct);
    const result = aumOpportunity({
      currentAum: nn(v.currentAum), currentSip: nn(v.currentSip), monthlyIncome: nn(v.monthlyIncome),
      targetSavingsPct: nn(v.targetSavingsPct), idleCash: nn(v.idleCash), fdAmount: nn(v.fdAmount),
      lowYieldInsurance: nn(v.lowYieldInsurance), bonusExpected: nn(v.bonusExpected),
      familyAssetsOutside: nn(v.familyAssetsOutside), stoppedSip: nn(v.stoppedSip), capturePct: nn(v.capturePct),
      returnPct, urgency,
    });
    const tone = toneOf(toneFor(result.priorityScore));
    return [
      stat("Immediate AUM opportunity", inr(result.immediateOpportunity), "success"),
      stat("SIP upgrade / month", inr(result.sipUpgrade), result.sipUpgrade > 0 ? "success" : "warning"),
      stat("12-month book impact", inr(result.oneYearAum), "brand"),
      stat("Priority score", `${result.priorityScore}/100`, tone),
      table(
        ["Opportunity source", "Estimated capture", "RM angle"],
        [
          ["Idle bank cash", inr(result.idleCashOpp), "Liquid fund / STP starter conversation"],
          ["FD / low-yield corpus", inr(result.fdOpp), "Post-tax return comparison"],
          ["Insurance maturity / surrender", inr(result.insuranceOpp), "IRR and protection review"],
          ["Bonus / upcoming cash", inr(result.bonusOpp), "Goal-wise lumpsum deployment"],
          ["Family wallet share", inr(result.familyOpp), "Family review meeting"],
          ["SIP upgrade annualised", inr(result.annualSipOpportunity), "Salary-linked step-up SIP"],
        ],
        true,
      ),
      stat("5-year AUM impact", inr(result.fiveYearAum), "success"),
      stat("Current investable savings", inr(result.investableSavings)),
      stat("Wallet-share lift in year 1", `${result.walletShareLiftPct.toFixed(1)}%`, "brand"),
      insight(`This opportunity should be prioritised at ${result.priorityScore}/100. Lead with ${result.firstPitch}, then close the SIP upgrade of ${inr(result.sipUpgrade)}/month.`, tone),
      insight(`If captured and invested at ${returnPct}% p.a., the estimated 5-year book impact is ${inrShort(result.fiveYearAum)}. Use this as an RM planning estimate, not as a client return promise.`, "brand"),
    ];
  },
};

/* ───────────────────────── XIRR ───────────────────────── */

/** The web's pre-filled cashflows; a row "+ Add cashflow" creates copies the
 *  last date and invests ₹1,00,000. */
const XIRR_ROWS: Array<[string, number]> = [
  ["2021-04-01", -100000],
  ["2022-04-01", -100000],
  ["2023-04-01", -100000],
  ["2026-06-11", 420000],
];
const XIRR_SLOTS = 8;
const xirrSlot = (i: number): [string, number] => XIRR_ROWS[i] ?? [XIRR_ROWS[XIRR_ROWS.length - 1][0], -100000];

/** XirrCalculator.tsx — XIRR (computeXirr). Cashflows are eight slots
 *  ("Number of cashflows", at least two as on the web); the signed amount is a
 *  Type switch (investment − / inflow or value +) and a positive amount, since
 *  a phone's number pad has no minus key. */
const xirr: CalcBody = {
  inputs: [
    { key: "count", label: "Number of cashflows", type: "int", default: XIRR_ROWS.length, min: 2, max: XIRR_SLOTS },
    ...Array.from({ length: XIRR_SLOTS }, (_, i): InputSpec[] => {
      const [date, amount] = xirrSlot(i);
      const shown = (v: Record<string, any>) => i < slotCount(v, "count", 2, XIRR_SLOTS);
      return [
        { key: `date${i + 1}`, label: "Date", type: "date", default: date, section: `Cashflow ${i + 1}`, visibleIf: shown },
        { key: `kind${i + 1}`, label: "Type", type: "segmented", default: amount < 0 ? "invest" : "inflow", options: opts([["invest", "Investment (−)"], ["inflow", "Inflow / value (+)"]]), visibleIf: shown },
        { key: `amount${i + 1}`, label: "Amount (₹)", type: "money", default: Math.abs(amount), visibleIf: shown },
      ];
    }).flat(),
  ],
  compute: (v) => {
    const n = slotCount(v, "count", 2, XIRR_SLOTS);
    const flows: DatedCashflow[] = Array.from({ length: n }, (_, i) => {
      const amt = nn(v[`amount${i + 1}`]);
      return { date: String(v[`date${i + 1}`] ?? ""), amount: v[`kind${i + 1}`] === "inflow" ? amt : -amt };
    });
    const result = computeXirr(flows);
    const out: ResultBlock[] = [
      stat("XIRR (annualised)", result.xirrPct == null ? "—" : `${result.xirrPct.toFixed(2)}%`, "brand"),
      stat("Total invested", inr(result.totalInvested)),
      stat("Total value / returned", inr(result.totalReturned)),
      stat("Absolute return", `${result.absoluteReturnPct.toFixed(1)}%`, result.netGain >= 0 ? "success" : "danger"),
    ];
    if (result.xirrPct != null) {
      out.push(insight(`These cashflows earned an annualised ${result.xirrPct.toFixed(2)}% XIRR — a net gain of ${inr(result.netGain)} on ${inr(result.totalInvested)} invested. XIRR is the rate that fairly accounts for when each rupee went in or came out.`, result.xirrPct >= 0 ? "success" : "danger"));
    } else {
      out.push(insight(result.hasBothSigns
        ? "Couldn't solve an XIRR for these cash flows — check the amounts and dates."
        : "Add at least one investment (negative) and one inflow/value (positive) with valid dates to compute XIRR.", "warning"));
    }
    return out;
  },
};

/* ───────────────────────── Portfolio Rebalancing ───────────────────────── */

const REBALANCE_ROWS: Array<[string, number, number]> = [
  ["Equity", 1400000, 60],
  ["Debt", 700000, 30],
  ["Gold", 100000, 10],
];
const REBALANCE_SLOTS = 6;
const rebalanceSlot = (i: number): [string, number, number] => REBALANCE_ROWS[i] ?? ["New class", 0, 0];

/** RebalanceCalculator.tsx — Portfolio Rebalancing (computeRebalance). Asset
 *  classes are six slots ("Number of asset classes"). */
const rebalance: CalcBody = {
  inputs: [
    { key: "newMoney", label: "New money to invest (₹, optional)", type: "money", default: 0 },
    { key: "count", label: "Number of asset classes", type: "int", default: REBALANCE_ROWS.length, min: 1, max: REBALANCE_SLOTS },
    ...Array.from({ length: REBALANCE_SLOTS }, (_, i): InputSpec[] => {
      const [assetClass, currentValue, targetPct] = rebalanceSlot(i);
      const shown = (v: Record<string, any>) => i < slotCount(v, "count", 1, REBALANCE_SLOTS);
      return [
        { key: `class${i + 1}`, label: "Asset class", type: "text", default: assetClass, section: `Asset class ${i + 1}`, visibleIf: shown },
        { key: `current${i + 1}`, label: "Current ₹", type: "money", default: currentValue, visibleIf: shown },
        { key: `target${i + 1}`, label: "Target %", type: "percent", default: targetPct, visibleIf: shown },
      ];
    }).flat(),
  ],
  compute: (v) => {
    const n = slotCount(v, "count", 1, REBALANCE_SLOTS);
    const rows: Holding[] = Array.from({ length: n }, (_, i) => ({
      assetClass: String(v[`class${i + 1}`] ?? ""),
      currentValue: nn(v[`current${i + 1}`]),
      targetPct: nn(v[`target${i + 1}`]),
    }));
    const result = computeRebalance(rows, nn(v.newMoney));
    const targetTotal = rows.reduce((s, r) => s + r.targetPct, 0);
    const targetBad = Math.abs(targetTotal - 100) > 0.01;
    const out: ResultBlock[] = [
      table(
        ["Asset class", "Current ₹", "Current %", "Target %", "Target ₹", "Action", "From new money"],
        rows.map((r, idx) => {
          const res = result.rows[idx];
          return [
            r.assetClass,
            inr(r.currentValue),
            `${res?.currentPct.toFixed(1)}%`,
            `${r.targetPct}%`,
            inr(res?.targetValue ?? 0),
            `${(res?.action ?? 0) >= 0 ? "Buy " : "Sell "}${inr(Math.abs(res?.action ?? 0))}`,
            res?.fromNewMoney ? inr(res.fromNewMoney) : "—",
          ];
        }),
      ),
    ];
    if (targetBad) out.push(insight(`Target allocation should total 100% (currently ${targetTotal.toFixed(0)}%).`, "danger"));
    out.push(
      stat("Portfolio value", inr(result.totalCurrent)),
      stat("After new money", inr(result.totalAfter), "brand"),
      stat("To buy", inr(result.totalBuy), "success"),
      stat("To sell", inr(result.totalSell), "danger"),
      insight(`Rebalancing realigns risk to plan. ${result.totalSell > 0
        ? `Selling ${inr(result.totalSell)} of the overweight classes may trigger capital-gains tax${result.newMoneyUsed > 0 ? ` — using the ${inr(result.newMoneyUsed)} of new money first keeps that to a minimum` : ""}.`
        : "New money alone covers the rebalance — no selling, so no tax event."}`, "brand"),
    );
    return out;
  },
};

/* ───────────────────────── Expense-Ratio Drag ───────────────────────── */

/** ExpenseDragCalculator.tsx — Expense-Ratio Drag (computeExpenseDrag). The
 *  wealth-gap chart is not drawn; its table is. */
const expensedrag: CalcBody = {
  inputs: [
    { key: "lumpsum", label: "Lumpsum (₹)", type: "money", default: 0 },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 25000 },
    { key: "years", label: "Years", type: "years", default: 20 },
    { key: "grossReturnPct", label: "Gross return (%)", type: "percent", default: 13 },
    { key: "expenseRatioAPct", label: "Expense ratio A (%)", type: "percent", default: 1.5 },
    { key: "expenseRatioBPct", label: "Expense ratio B (%)", type: "percent", default: 0.6 },
  ],
  compute: (v) => {
    const years = nn(v.years);
    const expenseRatioAPct = nn(v.expenseRatioAPct);
    const expenseRatioBPct = nn(v.expenseRatioBPct);
    const r = computeExpenseDrag({
      lumpsum: nn(v.lumpsum), monthlySip: nn(v.monthlySip), years, grossReturnPct: nn(v.grossReturnPct), expenseRatioAPct, expenseRatioBPct,
    });
    return [
      stat(`Option A (${fmtPct(expenseRatioAPct)} ER → ${fmtPct(r.netReturnA)})`, inr(r.fvA), "danger"),
      stat(`Option B (${fmtPct(expenseRatioBPct)} ER → ${fmtPct(r.netReturnB)})`, inr(r.fvB), "success"),
      stat("Cost of the higher ER", inr(r.drag), "danger"),
      stat("As % of corpus", `${r.dragPctOfCorpus.toFixed(1)}%`),
      section("1. Wealth gap over time"),
      table(
        ["Year", `A (${fmtPct(expenseRatioAPct)} ER)`, `B (${fmtPct(expenseRatioBPct)} ER)`, "Gap"],
        r.series.filter((p) => p.year % Math.max(1, Math.round(years / 20)) === 0 || p.year === years).map((p) => [
          `${p.year}`,
          inr(p.a),
          inr(p.b),
          inr(p.b - p.a),
        ]),
        true,
      ),
      insight(`A ${fmtPct(expenseRatioAPct - expenseRatioBPct)} higher expense ratio quietly costs ${inr(r.drag)} over ${years} years — about ${r.dragPctOfCorpus.toFixed(1)}% of the final corpus, on ${inr(r.totalInvested)} invested. The same gross return, very different outcomes — which is why fund and plan selection (and the advice behind it) matters.`, "danger"),
    ];
  },
};

/* ───────────────────────── Review of Investments ───────────────────────── */

// Copied verbatim from src/components/calculators/ReviewOfInvestments.tsx
// (PERIODS, DEFAULT_VISIBLE, ASSET_CLASSES, CATEGORIES, signedNum, `averages`).
const PERIODS = [
  { key: "m1", label: "1 mth" },
  { key: "m3", label: "3 mth" },
  { key: "m6", label: "6 mth" },
  { key: "y1", label: "1 Year" },
  { key: "y3", label: "3 Year" },
  { key: "y5", label: "5 Year" },
  { key: "y10", label: "10 Year" },
  { key: "si", label: "Since Inception" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const DEFAULT_VISIBLE: Record<PeriodKey, boolean> = {
  m1: false, m3: false, m6: true, y1: true, y3: true, y5: true, y10: true, si: false,
};

const REVIEW_ASSET_CLASSES = ["Equity", "Debt", "Hybrid", "Commodity", "Solution Oriented", "Other", "Custom"];
const REVIEW_CATEGORIES = [
  "Large Cap", "Large & Mid Cap", "Mid Cap", "Small Cap", "Flexi Cap", "Multi Cap",
  "ELSS (Tax Saver)", "Focused", "Value / Contra", "Sectoral / Thematic", "Index / ETF",
  "Aggressive Hybrid", "Balanced Advantage", "Conservative Hybrid", "Multi Asset", "Arbitrage",
  "Liquid", "Ultra Short Duration", "Short Duration", "Corporate Bond", "Gilt", "Dynamic Bond",
  "Gold / Silver", "Other", "Custom",
];

function signedNum(raw: string): number {
  // Returns may be negative — keep the sign (clampNum would floor at 0).
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** A return cell as the web stores it (updatePerf): "" when blank, else the signed number. */
const perfCell = (raw: unknown): number | "" => {
  const s = raw == null ? "" : String(raw);
  return s === "" ? "" : signedNum(s);
};

type Perf = Partial<Record<PeriodKey, number | "">>;

/** Unweighted average per visible period, across the rows that have a value. */
export function reviewAverages(perfs: Perf[], shownPeriods: Array<{ key: PeriodKey }>): Record<string, number | null> {
  const averages: Record<string, number | null> = {};
  for (const p of shownPeriods) {
    const vals = perfs.map((r) => r[p.key]).filter((x): x is number => typeof x === "number");
    averages[p.key] = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  }
  return averages;
}

const REVIEW_SLOTS = 6;

/** ReviewOfInvestments.tsx — Review of Investments. Works from typed-in
 *  figures, as the web allows: the web's MFAPI auto-fill of trailing returns
 *  is not offered here (each return is typed; blank = no figure; a minus sign
 *  is allowed). Schemes are six slots ("Number of schemes", three as on the
 *  web); "Custom" asset class / category opens a free-text field as on the web. */
const review: CalcBody = {
  inputs: [
    ...PERIODS.map((p, i): InputSpec => ({
      key: `show_${p.key}`, label: p.label, type: "toggle", default: DEFAULT_VISIBLE[p.key], ...(i === 0 ? { section: "Show periods" } : {}),
    })),
    { key: "count", label: "Number of schemes", type: "int", default: 3, min: 1, max: REVIEW_SLOTS },
    ...Array.from({ length: REVIEW_SLOTS }, (_, i): InputSpec[] => {
      const n = i + 1;
      const shown = (v: Record<string, any>) => i < slotCount(v, "count", 1, REVIEW_SLOTS);
      return [
        { key: `ac${n}`, label: "Asset class", type: "select", default: "Equity", options: opts(REVIEW_ASSET_CLASSES.map((c): [string, string] => [c, c])), section: `Scheme ${n}`, visibleIf: shown },
        { key: `acCustom${n}`, label: "Custom asset class", type: "text", default: "", placeholder: "Custom…", visibleIf: (v) => shown(v) && v[`ac${n}`] === "Custom" },
        { key: `cat${n}`, label: "Category", type: "select", default: "Large Cap", options: opts(REVIEW_CATEGORIES.map((c): [string, string] => [c, c])), visibleIf: shown },
        { key: `catCustom${n}`, label: "Custom category", type: "text", default: "", placeholder: "Custom…", visibleIf: (v) => shown(v) && v[`cat${n}`] === "Custom" },
        { key: `scheme${n}`, label: "Scheme", type: "scheme", default: null, visibleIf: shown },
        ...PERIODS.map((p): InputSpec => ({
          key: `p${n}_${p.key}`, label: `${p.label} return (%)`, type: "text", default: "", placeholder: "%",
          visibleIf: (v) => shown(v) && !!v[`show_${p.key}`],
        })),
      ];
    }).flat(),
  ],
  compute: (v) => {
    const shownPeriods = PERIODS.filter((p) => !!v[`show_${p.key}`]);
    const n = slotCount(v, "count", 1, REVIEW_SLOTS);
    const pickOf = (value: unknown, custom: unknown, list: string[], fallback: string) =>
      value === "Custom" ? String(custom ?? "") : list.includes(String(value)) ? String(value) : fallback;
    const rows = Array.from({ length: n }, (_, i) => {
      const k = i + 1;
      const perf: Perf = {};
      for (const p of PERIODS) perf[p.key] = perfCell(v[`p${k}_${p.key}`]);
      return {
        assetClass: pickOf(v[`ac${k}`], v[`acCustom${k}`], REVIEW_ASSET_CLASSES, "Equity"),
        category: pickOf(v[`cat${k}`], v[`catCustom${k}`], REVIEW_CATEGORIES, "Large Cap"),
        scheme: (v[`scheme${k}`] as SchemePick)?.name ?? "",
        perf,
      };
    });
    const averages = reviewAverages(rows.map((r) => r.perf), shownPeriods);
    const body = rows.map((r) => [
      r.assetClass,
      r.category,
      r.scheme || "—",
      ...shownPeriods.map((p) => {
        const x = r.perf[p.key];
        return typeof x === "number" ? `${x}%` : "—";
      }),
    ]);
    if (rows.length > 1) {
      body.push(["Average (unweighted)", "", "", ...shownPeriods.map((p) => (averages[p.key] == null ? "—" : `${averages[p.key]!.toFixed(2)}%`))]);
    }
    return [
      table(["Asset class", "Category", "Scheme", ...shownPeriods.map((p) => p.label)], body, rows.length > 1),
      note("*Mutual fund investments are subject to market risk; read all scheme-related documents carefully. Past performance may or may not be sustained."),
    ];
  },
};

/* ───────────────────────── Asset Allocation Review ───────────────────────── */

/** AssetAllocationReview.tsx bucketRows. */
function bucketRows(e: PortfolioResult, s: PortfolioResult): string[][] {
  const keys = Array.from(new Set([...e.buckets.map((b) => b.bucket), ...s.buckets.map((b) => b.bucket)]));
  return keys.map((k) => {
    const eb = e.buckets.find((b) => b.bucket === k);
    const sb = s.buckets.find((b) => b.bucket === k);
    return [
      k,
      inr(eb?.amount ?? 0),
      `${(eb?.pct ?? 0).toFixed(1)}%`,
      inr(sb?.amount ?? 0),
      `${(sb?.pct ?? 0).toFixed(1)}%`,
    ];
  });
}

/** AssetAllocationReview.tsx PortfolioTable. */
function portfolioTable(p: PortfolioResult, yA: number, yB: number): ResultBlock {
  const rows: string[][] = p.sleeves
    .filter((sl) => sl.amount > 0)
    .map((sl) => [
      sl.label + (sl.kind === "monthly" ? " (/mo)" : ""),
      inr(sl.amount),
      sl.kind === "monthly" ? "—" : `${sl.allocationPct.toFixed(1)}%`,
      `${sl.returnPct.toFixed(1)}%`,
      inr(sl.fvA),
      inr(sl.fvB),
    ]);
  rows.push([
    "Total",
    inr(p.lumpsumCorpus) + (p.sipMonthly > 0 ? ` + ${inr(p.sipMonthly)}/mo` : ""),
    "100%",
    `${p.blendedReturnPct.toFixed(2)}%`,
    inr(p.valueA),
    inr(p.valueB),
  ]);
  return table(["Sleeve", "Amount", "% Alloc", "Return", `Value ${yA}y`, `Value ${yB}y`], rows, true);
}

/** AssetAllocationReview.tsx — Asset Allocation Review, Existing vs Suggested
 *  (computeAssetAllocationReview). The web's editing grid becomes two sets of
 *  twelve sleeve inputs behind an "Edit" switch. The bucket bar charts are not
 *  drawn; the growth chart's figures are a table in section 3, so the web's
 *  section numbers hold. */
const allocreview: CalcBody = {
  inputs: [
    { key: "horizonA", label: "Horizon A (years)", type: "years", default: 5 },
    { key: "horizonB", label: "Horizon B (years)", type: "years", default: 10 },
    { key: "edit", label: "Edit", type: "segmented", default: "existing", options: opts([["existing", "Existing"], ["suggested", "Suggested"]]) },
    ...ALLOC_CLASSES.map((c, i): InputSpec[] => {
      const head = `${c.label}${c.kind === "monthly" ? " /mo" : ""}`;
      const isE = (v: Record<string, any>) => v.edit !== "suggested";
      const isS = (v: Record<string, any>) => v.edit === "suggested";
      return [
        { key: `e${i}a`, label: "Existing — amount (₹)", type: "money", default: EXISTING_DEFAULTS[i].amount, section: head, visibleIf: isE },
        { key: `e${i}r`, label: "Existing — return (%)", type: "percent", default: EXISTING_DEFAULTS[i].returnPct, visibleIf: isE },
        { key: `s${i}a`, label: "Suggested — amount (₹)", type: "money", default: SUGGESTED_DEFAULTS[i].amount, section: head, visibleIf: isS },
        { key: `s${i}r`, label: "Suggested — return (%)", type: "percent", default: SUGGESTED_DEFAULTS[i].returnPct, visibleIf: isS },
      ];
    }).flat(),
  ],
  compute: (v) => {
    const horizonA = nn(v.horizonA);
    const horizonB = nn(v.horizonB);
    const existing: AllocRow[] = ALLOC_CLASSES.map((_, i) => ({ amount: nn(v[`e${i}a`]), returnPct: nn(v[`e${i}r`]) }));
    const suggested: AllocRow[] = ALLOC_CLASSES.map((_, i) => ({ amount: nn(v[`s${i}a`]), returnPct: nn(v[`s${i}r`]) }));
    const result = computeAssetAllocationReview(existing, suggested, { horizonA, horizonB });
    const yA = horizonA, yB = horizonB;
    const e = result.existing, s = result.suggested;
    return [
      section("1. Existing vs Suggested — the uplift"),
      stat(`Existing value (${yA}y)`, inr(e.valueA)),
      stat(`Suggested value (${yA}y)`, inr(s.valueA), "brand"),
      stat(`Extra in ${yA} years`, inr(result.upliftA), result.upliftA >= 0 ? "success" : "danger"),
      stat(`Existing value (${yB}y)`, inr(e.valueB)),
      stat(`Suggested value (${yB}y)`, inr(s.valueB), "brand"),
      stat(`Extra in ${yB} years`, inr(result.upliftB), result.upliftB >= 0 ? "success" : "danger"),
      insight(`On the same corpus of ${inr(e.lumpsumCorpus)} (plus ${inr(e.sipMonthly)}/mo SIP), the suggested allocation lifts the blended return from ${e.blendedReturnPct.toFixed(2)}% to ${s.blendedReturnPct.toFixed(2)}% and projects ${inr(Math.abs(result.upliftB))} ${result.upliftB >= 0 ? "more" : "less"} wealth in ${yB} years.`, result.upliftB >= 0 ? "success" : "warning"),
      section("2. Asset mix by risk bucket"),
      table(["Bucket", "Existing ₹", "Existing %", "Suggested ₹", "Suggested %"], bucketRows(e, s)),
      section(`3. Projected growth (next ${Math.max(yA, yB)} years)`),
      table(["Year", "Existing", "Suggested"], e.growth.map((g, i) => [`${g.year}`, inr(g.value), inr(s.growth[i]?.value ?? 0)])),
      section("4. Existing portfolio — sleeve detail"),
      portfolioTable(e, yA, yB),
      section("5. Suggested portfolio — sleeve detail"),
      portfolioTable(s, yA, yB),
      note("* Illustration only. Each sleeve is assumed to grow at its stated annual return; the SIP sleeve compounds monthly (begin-of-month). The gross corpus and allocation % exclude the monthly SIP. Returns are not guaranteed and vary with markets. Not investment advice — mutual fund investments are subject to market risks."),
    ];
  },
};

/* ───────────────────────── REAL Statement ───────────────────────── */

// Copied verbatim from src/components/calculators/RealStatement.tsx (the
// field lists, sum, pctOf and the component's `m` useMemo and `checks`).
type Group = Record<string, number>;
const sum = (g: Group) => Object.values(g).reduce((a, b) => a + (b || 0), 0);
const pctOf = (x: number, base: number) => (base > 0 ? (x / base) * 100 : 0);

type Fields = { key: string; label: string }[];

const INCOME_FIELDS: Fields = [
  { key: "salary", label: "Salary (Husband + Wife)" },
  { key: "bonus", label: "Bonus / variable (monthly avg)" },
  { key: "business", label: "Business income" },
  { key: "rental", label: "Rental income" },
  { key: "investment", label: "Investment income" },
];
const HOUSEHOLD: Fields = [
  { key: "rent", label: "House rent" },
  { key: "society", label: "Society / maintenance / repair" },
  { key: "food", label: "Food, grocery & toiletries" },
  { key: "vehicle", label: "Vehicle — fuel / maintenance / travel" },
  { key: "health", label: "Medicines / doctor / healthcare" },
  { key: "utilities", label: "Electricity / water / AMCs" },
  { key: "help", label: "Domestic help / driver" },
  { key: "telecom", label: "Mobile / internet" },
  { key: "subs", label: "TV / newspapers / subscriptions" },
  { key: "otherHh", label: "Others" },
];
const LIFESTYLE: Fields = [
  { key: "clothes", label: "Clothes & accessories" },
  { key: "shopping", label: "Shopping / gifts / gadgets" },
  { key: "dining", label: "Dining / movies / sports" },
  { key: "personalCare", label: "Personal care — salon / spa / gym" },
  { key: "travel", label: "Travel & annual vacations" },
  { key: "advisors", label: "Coach / advisor / CA fees" },
  { key: "hobbies", label: "Hobbies / club memberships" },
  { key: "courses", label: "Professional courses / education" },
  { key: "charity", label: "Charity / donations" },
  { key: "otherLs", label: "Others" },
];
const DEPENDENT: Fields = [
  { key: "children", label: "Children — school / college / tuitions" },
  { key: "parents", label: "Contribution to parents" },
  { key: "relatives", label: "Siblings / relatives" },
];
const INS_PREMIUMS: Fields = [
  { key: "life", label: "Life insurance (term / pure)" },
  { key: "healthIns", label: "Health insurance (mediclaim / PA / CI)" },
  { key: "general", label: "General insurance (motor & others)" },
];
const LOAN_EMIS: Fields = [
  { key: "homeEmi", label: "Home loan EMI" },
  { key: "vehicleEmi", label: "Vehicle loan EMI" },
  { key: "otherEmi", label: "Other loan EMIs" },
];
const ONGOING_INV: Fields = [
  { key: "mfSip", label: "MF SIPs" },
  { key: "policiesRd", label: "Policies / RDs" },
  { key: "otherInv", label: "Others" },
];
const LIQUID: Fields = [
  { key: "savingsBank", label: "Savings bank" },
  { key: "liquidFunds", label: "Liquid funds" },
  { key: "cash", label: "Cash in hand" },
];
const DEBT: Fields = [
  { key: "fd", label: "Fixed deposits" },
  { key: "ppf", label: "PPF" },
  { key: "epf", label: "EPF / SA / gratuity" },
  { key: "nsc", label: "NSC / POMIS / KVP / RDs" },
  { key: "npsDebt", label: "NPS (debt portion)" },
  { key: "debtMf", label: "Debt mutual funds" },
  { key: "insSv", label: "Insurance policies — surrender value" },
  { key: "bonds", label: "Bonds / debentures / CDs" },
];
const EQUITY: Fields = [
  { key: "directEq", label: "Direct equity / PMS / AIF" },
  { key: "equityMf", label: "Equity mutual funds" },
  { key: "npsEq", label: "NPS (equity portion)" },
  { key: "ulip", label: "ULIPs — surrender value" },
];
const GOLD: Fields = [
  { key: "goldEtf", label: "Gold ETFs / funds" },
  { key: "goldPhysical", label: "Gold bars / coins" },
];
const REAL_ESTATE: Fields = [
  { key: "apartment", label: "Apartment / house (investment)" },
  { key: "plot", label: "Plot / land / holiday home" },
  { key: "reits", label: "Real estate funds / REITs" },
];
const PERSONAL: Fields = [
  { key: "primaryHouse", label: "Primary house" },
  { key: "vehicles", label: "Vehicles" },
  { key: "jewellery", label: "Jewellery" },
];
const LIABILITIES: Fields = [
  { key: "homeLoan", label: "Home loan — outstanding" },
  { key: "vehicleLoan", label: "Vehicle loan — outstanding" },
  { key: "personalLoan", label: "Personal loan" },
  { key: "educationLoan", label: "Education loan" },
  { key: "otherLoan", label: "Other loans (gold loan etc.)" },
  { key: "creditCard", label: "Credit card outstanding" },
];

export type RealGroups = {
  income: Group; household: Group; lifestyle: Group; dependent: Group; insurance: Group; emis: Group; ongoing: Group;
  liquid: Group; debt: Group; equity: Group; gold: Group; realEstate: Group; personal: Group; liabilities: Group;
};

export function realStatement({
  income, household, lifestyle, dependent, insurance, emis, ongoing, liquid, debt, equity, gold, realEstate, personal, liabilities,
}: RealGroups) {
  const incomeM = sum(income);
  const incomeA = incomeM * 12;
  const expM = sum(household) + sum(lifestyle) + sum(dependent) + sum(insurance) + sum(emis);
  const expA = expM * 12;
  const savingsM = incomeM - expM;
  const ongoingM = sum(ongoing);
  const surplusM = savingsM - ongoingM;

  const tLiquid = sum(liquid), tDebt = sum(debt), tEquity = sum(equity), tGold = sum(gold), tRe = sum(realEstate), tPersonal = sum(personal);
  const totalAssets = tLiquid + tDebt + tEquity + tGold + tRe + tPersonal;
  const totalLiab = sum(liabilities);
  const notionalNW = totalAssets - totalLiab;
  const actualNW = (totalAssets - tPersonal) - totalLiab;
  // Investable (financial) assets exclude real estate + personal use assets.
  const investable = tLiquid + tDebt + tEquity + tGold;

  return {
    incomeM, incomeA, expM, expA, savingsM, ongoingM, surplusM,
    tLiquid, tDebt, tEquity, tGold, tRe, tPersonal,
    totalAssets, totalLiab, notionalNW, actualNW, investable,
    savingsRate: pctOf(savingsM, incomeM),
    expenseRatio: pctOf(expM, incomeM),
    emergencyMonths: expM > 0 ? tLiquid / expM : 0,
    leverage: pctOf(totalLiab, totalAssets),
    solvency: pctOf(notionalNW, totalAssets),
  };
}

/** RealStatement.tsx `checks` + `score` — the financial-health ratios. */
export function realChecks(m: ReturnType<typeof realStatement>) {
  const checks = [
    { name: "Savings rate", val: `${m.savingsRate.toFixed(0)}%`, ok: m.savingsRate >= 20, good: "Healthy savings discipline", bad: "Aim to save ≥ 20% of income" },
    { name: "Expense ratio", val: `${m.expenseRatio.toFixed(0)}%`, ok: m.expenseRatio <= 70, good: "Expenses well within income", bad: "Expenses are high vs income" },
    { name: "Emergency fund", val: `${m.emergencyMonths.toFixed(1)} mo`, ok: m.emergencyMonths >= 6, good: "6+ months of liquid cushion", bad: "Build 6 months of expenses in liquid assets" },
    { name: "Leverage (debt/assets)", val: `${m.leverage.toFixed(0)}%`, ok: m.leverage <= 40, good: "Comfortable leverage", bad: "Debt is high vs assets — deleverage" },
  ];
  const score = checks.filter((c) => c.ok).length;
  return { checks, score };
}

/** The web's defaults: the Network FP worked example (RealStatement.tsx useState seeds). */
export const REAL_DEFAULTS: RealGroups = {
  income: { salary: 140000, bonus: 20833, business: 0, rental: 0, investment: 0 },
  household: { rent: 0, society: 0, food: 15000, vehicle: 0, health: 5000, utilities: 7000, help: 0, telecom: 2000, subs: 3000, otherHh: 8000 },
  lifestyle: { clothes: 0, shopping: 10000, dining: 0, personalCare: 10000, travel: 0, advisors: 0, hobbies: 0, courses: 0, charity: 0, otherLs: 0 },
  dependent: { children: 12500, parents: 0, relatives: 0 },
  insurance: { life: 5500, healthIns: 2500, general: 0 },
  emis: { homeEmi: 0, vehicleEmi: 0, otherEmi: 0 },
  ongoing: { mfSip: 0, policiesRd: 0, otherInv: 0 },
  liquid: { savingsBank: 180000, liquidFunds: 0, cash: 0 },
  debt: { fd: 900000, ppf: 0, epf: 850000, nsc: 0, npsDebt: 0, debtMf: 0, insSv: 0, bonds: 0 },
  equity: { directEq: 0, equityMf: 1400000, npsEq: 0, ulip: 0 },
  gold: { goldEtf: 0, goldPhysical: 0 },
  realEstate: { apartment: 9500000, plot: 1800000, reits: 0 },
  personal: { primaryHouse: 0, vehicles: 600000, jewellery: 0 },
  liabilities: { homeLoan: 2200000, vehicleLoan: 300000, personalLoan: 0, educationLoan: 0, otherLoan: 0, creditCard: 0 },
};

/** The groups in the web's order: [group, title (the web's editor title), fields]. */
const REAL_GROUPS: Array<[keyof RealGroups, string, Fields]> = [
  ["income", "Revenue (Income)", INCOME_FIELDS],
  ["household", "Household", HOUSEHOLD],
  ["lifestyle", "Lifestyle", LIFESTYLE],
  ["dependent", "Dependent", DEPENDENT],
  ["insurance", "Insurance premiums", INS_PREMIUMS],
  ["emis", "Loan EMIs", LOAN_EMIS],
  ["ongoing", "Ongoing investments (SIPs / RDs)", ONGOING_INV],
  ["liquid", "Liquid assets", LIQUID],
  ["debt", "Debt assets", DEBT],
  ["equity", "Equity assets", EQUITY],
  ["gold", "Gold assets", GOLD],
  ["realEstate", "Real-estate assets", REAL_ESTATE],
  ["personal", "Personal assets (excluded from Actual NW)", PERSONAL],
  ["liabilities", "Outstanding liabilities", LIABILITIES],
];
/** The input heading of each group; the first group of a REAL letter carries it. */
const REAL_HEADING: Record<keyof RealGroups, string> = {
  income: "R · Revenue (Income)",
  household: "E · Expenses — Household (₹/mo)",
  lifestyle: "Lifestyle (₹/mo)",
  dependent: "Dependent (₹/mo)",
  insurance: "Insurance premiums (₹/mo)",
  emis: "Loan EMIs (₹/mo)",
  ongoing: "Ongoing investments (SIPs / RDs) (₹/mo)",
  liquid: "A · Assets (present value) — Liquid assets",
  debt: "Debt assets",
  equity: "Equity assets",
  gold: "Gold assets",
  realEstate: "Real-estate assets",
  personal: "Personal assets (excluded from Actual NW)",
  liabilities: "L · Liabilities — Outstanding liabilities",
};

/** RealStatement.tsx — the REAL Statement, Net Worth & Cashflow (inline maths
 *  above). Each group's editor is a run of inputs under a heading; the group
 *  totals the editors print are tables in the results. The investable-mix bar
 *  is its legend, as a table. */
const realstatement: CalcBody = {
  inputs: REAL_GROUPS.flatMap(([g, , fields]) =>
    fields.map((f, i): InputSpec => ({
      key: `${g}_${f.key}`,
      label: g === "income" ? `${f.label} (₹/mo)` : f.label,
      type: "money",
      default: REAL_DEFAULTS[g][f.key] ?? 0,
      ...(i === 0 ? { section: REAL_HEADING[g] } : {}),
    })),
  ),
  compute: (v) => {
    const groups = Object.fromEntries(
      REAL_GROUPS.map(([g, , fields]) => [g, Object.fromEntries(fields.map((f) => [f.key, Math.max(0, Number(v[`${g}_${f.key}`]) || 0)]))]),
    ) as RealGroups;
    const m = realStatement(groups);
    const { checks, score } = realChecks(m);
    const totalRow = (g: keyof RealGroups, suffix = ""): string[] => {
      const title = REAL_GROUPS.find((x) => x[0] === g)![1];
      return [title, `${inr(sum(groups[g]))}${suffix}`];
    };
    const signTone = (x: number): Tone => (x >= 0 ? "success" : "danger");
    // Investable-asset mix (the part an MFD actually advises on).
    const mix = [
      { label: "Equity", value: m.tEquity },
      { label: "Debt", value: m.tDebt },
      { label: "Liquid", value: m.tLiquid },
      { label: "Gold", value: m.tGold },
    ];
    const out: ResultBlock[] = [
      stat("Total income (annual)", inr(m.incomeA), "brand"),
      stat("Surplus for new investments", `${inr(m.surplusM)}/mo`, signTone(m.surplusM)),
      stat("Notional net worth", inr(m.notionalNW), signTone(m.notionalNW)),
      stat("Actual net worth", inr(m.actualNW), signTone(m.actualNW)),
      section("R. Revenue (Income)"),
      note(`Total income: ${inr(m.incomeM)}/mo · ${inr(m.incomeA)}/yr`),
      section("E. Expenses"),
      table(["Group", "Total"], (["household", "lifestyle", "dependent", "insurance", "emis", "ongoing"] as const).map((g) => totalRow(g, "/mo"))),
      stat("Total income", `${inr(m.incomeM)}/mo`),
      stat("Total expenses", `${inr(m.expM)}/mo`),
      stat("Total savings", `${inr(m.savingsM)}/mo`, signTone(m.savingsM)),
      stat("Ongoing investments", `${inr(m.ongoingM)}/mo`),
      stat("Surplus for new SIPs", `${inr(m.surplusM)}/mo`, signTone(m.surplusM)),
      section("A. Assets (present value)"),
      table(["Group", "Total"], (["liquid", "debt", "equity", "gold", "realEstate", "personal"] as const).map((g) => totalRow(g))),
      note(`Total assets: ${inr(m.totalAssets)} · Investable (financial) assets: ${inr(m.investable)}`),
      section("L. Liabilities"),
      table(["Group", "Total"], [totalRow("liabilities")]),
      section("Net worth"),
      stat("Total assets", inr(m.totalAssets)),
      stat("Total liabilities", inr(m.totalLiab), m.totalLiab > 0 ? "danger" : undefined),
      stat("Notional net worth (incl. personal)", inr(m.notionalNW), signTone(m.notionalNW)),
      stat("Actual net worth (excl. personal)", inr(m.actualNW), signTone(m.actualNW)),
    ];
    if (m.investable > 0) {
      out.push(
        section("Investable asset mix"),
        table(["Asset", "Value", "Share"], mix.map((b) => [b.label, inrShort(b.value), `${pctOf(b.value, m.investable).toFixed(0)}%`])),
      );
    }
    out.push(
      section("Financial-health ratios"),
      stat("Score", `${score}/4`, score >= 3 ? "success" : score >= 2 ? "warning" : "danger"),
      table(["Ratio", "Value", "Verdict"], checks.map((c) => [c.name, c.val, c.ok ? `✓ ${c.good}` : `⚠ ${c.bad}`])),
      insight(`${m.surplusM > 0
        ? `This household can invest about ${inr(m.surplusM)}/month (${inr(m.surplusM * 12)}/yr) of fresh surplus.`
        : "Expenses + ongoing investments currently absorb all income — there's no fresh surplus to deploy."} Actual net worth (excluding personal-use assets like the primary home, vehicles and jewellery) is ${inr(m.actualNW)}; investable financial assets are ${inr(m.investable)}. Notional net worth including those assets is ${inr(m.notionalNW)}.`, m.surplusM > 0 ? "success" : "warning"),
      note("Modelled on Network FP's REAL Statement. Income/expenses are entered monthly (annualised ×12); assets & liabilities are present values."),
    );
    return out;
  },
};

/* ───────────────────────── Portfolio Projection ───────────────────────── */

/** PortfolioProjectionReport.tsx — Portfolio Projection (portfolioProjection).
 *  The growth chart is not drawn; its year table is. The web's line under the
 *  inputs (what the increased plan invests) is the first note. */
const portproj: CalcBody = {
  inputs: [
    { key: "mode", label: "Show", type: "segmented", default: "incremental", options: opts([["current", "Current investments"], ["incremental", "Current + increased investments"]]) },
    { key: "portfolioValue", label: "Current portfolio value (₹)", type: "money", default: 2500000 },
    { key: "annualLumpsum", label: "Lumpsum added every year (₹)", type: "money", default: 200000 },
    { key: "annualLumpsumIncrease", label: "Raise the yearly lumpsum by (₹)", type: "money", default: 50000, visibleIf: (v) => v.mode !== "current" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 25000 },
    { key: "sipIncrease", label: "Raise the SIP each year by (₹)", type: "money", default: 5000, visibleIf: (v) => v.mode !== "current" },
    { key: "ratePct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "years", label: "Period (yrs)", type: "years", default: 20 },
  ],
  compute: (v) => {
    const mode: PortfolioProjectionMode = v.mode === "current" ? "current" : "incremental";
    const annualLumpsum = nn(v.annualLumpsum);
    const annualLumpsumIncrease = nn(v.annualLumpsumIncrease);
    const monthlySip = nn(v.monthlySip);
    const sipIncrease = nn(v.sipIncrease);
    const ratePct = nn(v.ratePct);
    const years = nn(v.years);
    const result = portfolioProjection({ portfolioValue: nn(v.portfolioValue), annualLumpsum, annualLumpsumIncrease, monthlySip, sipIncrease, ratePct, years, mode });
    const cur = result.current;
    const inc = result.incremental;
    const out: ResultBlock[] = [];
    if (inc) {
      out.push(note(`In the increased plan the yearly lumpsum is ${inr(annualLumpsum + annualLumpsumIncrease)} every year, and the SIP goes up by ${inr(sipIncrease)} every year starting this year (${inr(monthlySip + sipIncrease)}, then ${inr(monthlySip + 2 * sipIncrease)}, …).`));
    }
    out.push(
      stat("Invested — current plan", inr(cur.totalInvested)),
      stat(`Value in ${years} yrs — current plan`, inr(cur.components.total), "brand"),
    );
    if (inc) {
      out.push(
        stat("Invested — increased plan", inr(inc.totalInvested)),
        stat(`Value in ${years} yrs — increased plan`, inr(inc.components.total), "success"),
      );
    }
    if (inc && result.extraValue > 0) {
      out.push(insight(`Putting in ${inr(result.extraInvested)} more over ${years} years could add ${inr(result.extraValue)} to the portfolio at ${fmtPct(ratePct)} a year.`, "success"));
    }
    out.push(
      section("1. Expected portfolio value"),
      table(
        ["Component", "Current plan", ...(inc ? ["Increased plan"] : [])],
        [
          ["Today's portfolio", inr(cur.components.portfolio), ...(inc ? [inr(inc.components.portfolio)] : [])],
          ["Yearly lumpsums", inr(cur.components.annualLumpsum), ...(inc ? [inr(inc.components.annualLumpsum)] : [])],
          ["SIP", inr(cur.components.sip), ...(inc ? [inr(inc.components.sip)] : [])],
          ["Total", inr(cur.components.total), ...(inc ? [inr(inc.components.total)] : [])],
        ],
        true,
      ),
    );
    if (cur.rows.length > 0) {
      out.push(
        section("2. Year by year — investment and expected value"),
        table(
          [
            "Year",
            "Invested (current)", "Cumulative (current)", "Value (current)",
            ...(inc ? ["Invested (increased)", "Cumulative (increased)", "Value (increased)"] : []),
          ],
          cur.rows.map((r, i) => [
            `${r.year}`,
            inr(r.annualInvestment), inr(r.cumulativeInvestment), inr(r.fundValue),
            ...(inc ? [inr(inc.rows[i].annualInvestment), inr(inc.rows[i].cumulativeInvestment), inr(inc.rows[i].fundValue)] : []),
          ]),
          true,
        ),
      );
    }
    out.push(note("* Illustration only. Year 1's investment includes today's portfolio. The yearly lumpsum is added at the start of each year; the SIP at the start of each month, at the effective monthly equivalent of the yearly return. Returns are neither indicative nor guaranteed. Not investment advice."));
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  portfoliohealth, fundoverlap, aumopportunity, xirr, rebalance, expensedrag, review, allocreview, realstatement, portproj,
};
