/**
 * Goals & Planning — mirrors the web group of the same name
 * (src/components/calculators/*, maths in ./web). Labels, defaults, figures and
 * the order of results follow the web component named on each def. Where the
 * web lets the user add rows (goals, milestones), the app offers a fixed number
 * of slots: the web's pre-filled rows first, then "+ Add" rows behind an
 * include toggle.
 *
 * Every "SIP needed for a goal" result shows the one-time lumpsum today beside
 * it, exactly where the web component does (web commit f7f89a79).
 */

import type { CalcBody, InputSpec, ResultBlock } from "../types";
import { inr, fmtPct, inrCompact } from "../fmt";
import { computeGoal, type CostBasis } from "../web/goal-planner";
import { computeMultipurpose, type CalcType, type ReportType, type WithdrawalOption } from "../web/multipurpose";
import { vacationPlan, inflatedTarget } from "../web/goal-planning-calc";
import { computeChildEducation, type EduMilestone } from "../web/child-education";
import { computeChildSip } from "../web/child-sip";
import { computeGoalCollision, isDueNow, type CollisionGoal } from "../web/goal-collision";
import { computeGoalFeasibility, type FeasGoal } from "../web/goal-feasibility";
import {
  sipForTarget, limitedSipNeed, stepUpSipForTarget, sipLumpsumForTarget, lumpsumForTarget,
} from "../web/sip-suite";
import { retirementNeed } from "../web/retirement-need";
import { computeSipStpForTarget, stpRequiredForTarget, type MonthlyStpMode } from "../web/stp-comprehensive";
import {
  ppfCalc, PPF_DEFAULT_RATE_PCT, PPF_EXTENSION_YEARS, PPF_MAX_DEPOSIT, PPF_TERM_YEARS, type PpfExtension,
} from "../web/ppf";
import {
  epfCalc, EPF_DEFAULT_RATE_PCT, EPF_EMPLOYEE_PCT, EPF_EMPLOYER_SHARE_PCT, EPF_RETIREMENT_AGE, EPS_WAGE_CEILING,
  type EpfEmployerMode,
} from "../web/epf";
import { scenarioInputs, ratesOf, reportInput, stat, section, table, insight, note, opts, TONE } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** One of `allowed`, else the web's default. */
const pick = <T extends string>(x: unknown, allowed: readonly T[], dflt: T): T =>
  (allowed as readonly unknown[]).includes(x) ? (x as T) : dflt;

/** 1 … n. */
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

type Values = Record<string, any>;

/** Slot 1 is always in use (the web never lets the last row go); slot i > 1
 *  when its include toggle `<prefix><i>on` is set. */
const slotOn = (prefix: string) => (v: Values, i: number): boolean => i === 1 || !!v[`${prefix}${i}on`];

/** The include toggle that stands in for the web's "+ Add …" button. */
const includeToggle = (key: string, heading: string, label: string, dflt: boolean): InputSpec => ({
  key, label, type: "toggle", default: dflt, section: heading,
});

/* ───────────────────────── Goal Planner ───────────────────────── */

/** GoalPlannerCalculator.tsx — Goal Planner (computeGoal). The web's add /
 *  remove goal list is four slots: its two pre-filled goals, then two "New Goal"
 *  rows (the web's "+ Add new goal" defaults). The cost is one input per cost
 *  basis, so each keeps the web's label. */
const GOAL_SLOTS = [
  { purpose: "Child Education", cost: 5000000, period: 15, limited: 10, on: true },
  { purpose: "Retirement Corpus", cost: 100000000, period: 25, limited: 20, on: true },
  { purpose: "New Goal", cost: 2500000, period: 10, limited: 7, on: false },
  { purpose: "New Goal", cost: 2500000, period: 10, limited: 7, on: false },
];
const goalOn = slotOn("g");
const RATE_ALLOC: Array<{ key: "debt" | "hybrid" | "equity"; label: string; rate: number; alloc: number }> = [
  { key: "debt", label: "Debt", rate: 6, alloc: 0 },
  { key: "hybrid", label: "Hybrid", rate: 9, alloc: 0 },
  { key: "equity", label: "Equity", rate: 12, alloc: 100 },
];
const goalplan: CalcBody = {
  inputs: GOAL_SLOTS.flatMap((d, idx): InputSpec[] => {
    const i = idx + 1;
    const p = `g${i}`;
    const on = (v: Values) => goalOn(v, i);
    const current = (v: Values) => on(v) && v[`${p}basis`] === "current";
    return [
      ...(i > 1 ? [includeToggle(`${p}on`, `Goal ${i}`, "Include this goal", d.on)] : []),
      { key: `${p}purpose`, label: "Purpose of investment", type: "text", default: d.purpose, placeholder: "Purpose of investment", visibleIf: on, ...(i === 1 ? { section: "Goal 1" } : {}) },
      { key: `${p}basis`, label: "Cost basis", type: "segmented", default: "future", options: opts([["future", "Future cost"], ["current", "Current cost"]]), visibleIf: on },
      { key: `${p}costF`, label: "Future cost (₹)", type: "money", default: d.cost, visibleIf: (v) => on(v) && !current(v) },
      { key: `${p}costC`, label: "Current cost (₹)", type: "money", default: d.cost, visibleIf: current },
      { key: `${p}infl`, label: "Inflation (%)", type: "percent", default: 6, visibleIf: current },
      { key: `${p}period`, label: "Period (yrs)", type: "years", default: d.period, visibleIf: on },
      { key: `${p}limited`, label: "Limited SIP years", type: "years", default: d.limited, visibleIf: on },
      { key: `${p}combo`, label: "Lumpsum (for combo) (₹)", type: "money", default: 500000, visibleIf: on },
      ...RATE_ALLOC.flatMap((ra): InputSpec[] => [
        { key: `${p}${ra.key}Rate`, label: `${ra.label} return %`, type: "percent", default: ra.rate, visibleIf: on },
        { key: `${p}${ra.key}Alloc`, label: `${ra.label} allocation %`, type: "percent", default: ra.alloc, visibleIf: on },
      ]),
    ];
  }),
  compute: (v) => {
    const goals = range(GOAL_SLOTS.length).filter((i) => goalOn(v, i)).map((i) => {
      const p = `g${i}`;
      const costBasis: CostBasis = v[`${p}basis`] === "current" ? "current" : "future";
      const input = {
        costBasis,
        cost: nn(costBasis === "current" ? v[`${p}costC`] : v[`${p}costF`]),
        inflationPct: nn(v[`${p}infl`]),
        periodYears: nn(v[`${p}period`]),
        alloc: { debt: nn(v[`${p}debtAlloc`]), hybrid: nn(v[`${p}hybridAlloc`]), equity: nn(v[`${p}equityAlloc`]) },
        rates: { debt: nn(v[`${p}debtRate`]), hybrid: nn(v[`${p}hybridRate`]), equity: nn(v[`${p}equityRate`]) },
        limitedYears: nn(v[`${p}limited`]),
        comboLumpsum: nn(v[`${p}combo`]),
      };
      return { i, purpose: String(v[`${p}purpose`] ?? ""), input, res: computeGoal(input) };
    });
    const totalLumpsum = goals.reduce((s, g) => s + g.res.lumpsum, 0);
    const totalMonthlySip = goals.reduce((s, g) => s + g.res.monthlySip, 0);

    const out: ResultBlock[] = [];
    if (goals.length > 1) {
      out.push(
        stat("All goals — total lumpsum", inr(totalLumpsum), "brand"),
        stat("All goals — total monthly SIP", inr(totalMonthlySip), "brand"),
        stat("Goals", `${goals.length}`, "brand"),
      );
    }
    for (const { i, purpose, input: g, res } of goals) {
      const allocTotal = g.alloc.debt + g.alloc.hybrid + g.alloc.equity;
      const allocBad = Math.abs(allocTotal - 100) > 0.01;
      const ret = fmtPct(Number(res.returnPct.toFixed(2)));
      out.push(
        section(purpose.trim() || `Goal ${i}`),
        stat("Allocation total / return", `${allocTotal.toFixed(0)}% · ${ret}`, allocBad ? "danger" : undefined),
      );
      if (allocBad) out.push(insight(`Allocation should total 100% (currently ${allocTotal.toFixed(0)}%).`, "danger"));
      out.push(
        table(["Investment option", "Amount needed"], [
          ["Lumpsum (one-time, today)", inr(res.lumpsum)],
          [`Monthly SIP (for ${g.periodYears} yrs)`, res.dueNow ? "Due now — lumpsum" : `${inr(res.monthlySip)} / mo`],
          [`Limited-period SIP (${res.limitedYears} yrs, then grows)`, res.dueNow ? "—" : `${inr(res.limitedSip)} / mo`],
          [`Lumpsum ${inr(res.comboLumpsum)} + Monthly SIP`, res.dueNow ? "—" : `${inr(res.comboSip)} / mo`],
        ]),
        note(`Future cost: ${inr(res.futureCost)} in ${g.periodYears} years${g.costBasis === "current" ? ` (from ${inr(g.cost)} today at ${fmtPct(g.inflationPct)} inflation)` : ""} · assumed return ${ret}`),
      );
    }
    out.push(insight("Starting early and using SIPs spreads a large goal into affordable monthly amounts — a limited-period SIP can finish investing sooner while the corpus keeps compounding to the target.", "brand"));
    return out;
  },
};

/* ───────────────────────── Cashflow & Corpus ───────────────────────── */

/** CashflowCorpusPlanner.tsx — Cashflow & Corpus Planner (computeMultipurpose).
 *  The amount is one input per calculation type (the web relabels one field),
 *  both at the web's ₹1 cr default. */
const isSipType = (v: Values) => v.calcType === "sip" || v.calcType === "stepup";
const showSwp = (v: Values) => v.withdrawal !== "periodic";
const multipurpose: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (yrs)", type: "years", default: 40 },
    { key: "reportTillAge", label: "Report period till age (yrs)", type: "years", default: 90 },
    { key: "calcType", label: "Calculation type", type: "segmented", default: "lumpsum", options: opts([["lumpsum", "Lumpsum"], ["sip", "SIP"], ["stepup", "Step-up SIP"]]) },
    { key: "lumpsum", label: "One-time investment (₹)", type: "money", default: 10000000, visibleIf: (v) => !isSipType(v) },
    { key: "monthly", label: "Monthly SIP (₹)", type: "money", default: 10000000, visibleIf: isSipType },
    { key: "stepUpPct", label: "Annual step-up (%)", type: "percent", default: 10, visibleIf: (v) => v.calcType === "stepup" },
    { key: "ratePct", label: "Assumed return (% p.a.)", type: "percent", default: 12 },
    { key: "withdrawal", label: "Withdrawal option", type: "select", default: "both", options: opts([["periodic", "Periodic (fund value)"], ["swp", "Monthly SWP"], ["both", "Periodic + SWP"]]) },
    { key: "reportType", label: "SWP report type", type: "segmented", default: "fund_value", options: opts([["fund_value", "Max sustainable SWP"], ["custom_withdrawal", "Custom withdrawal"]]), visibleIf: showSwp },
    { key: "customMonthly", label: "Custom monthly withdrawal (₹)", type: "money", default: 100000, visibleIf: (v) => showSwp(v) && v.reportType === "custom_withdrawal" },
    { key: "reportHeader", label: "Report header (optional)", type: "text", default: "", placeholder: "e.g. My Financial Plan" },
  ],
  compute: (v) => {
    const calcType = pick<CalcType>(v.calcType, ["lumpsum", "sip", "stepup"], "lumpsum");
    const withdrawal = pick<WithdrawalOption>(v.withdrawal, ["periodic", "swp", "both"], "both");
    const reportType = pick<ReportType>(v.reportType, ["fund_value", "custom_withdrawal"], "fund_value");
    const reportTillAge = nn(v.reportTillAge);
    const customMonthly = nn(v.customMonthly);
    const result = computeMultipurpose({
      currentAge: nn(v.currentAge),
      reportTillAge,
      ratePct: nn(v.ratePct),
      calcType,
      amount: nn(calcType === "lumpsum" ? v.lumpsum : v.monthly),
      stepUpPct: nn(v.stepUpPct),
      withdrawal,
      reportType,
      customMonthly,
    });
    const startLabel = (r: { deferYears: number; startAge: number }) =>
      r.deferYears === 0 ? `Now (age ${r.startAge})` : `Age ${r.startAge} (+${r.deferYears}y)`;

    const out: ResultBlock[] = [];
    const header = String(v.reportHeader ?? "");
    if (header) out.push(section(header));
    out.push(
      stat("Total invested", inr(result.finalInvested)),
      stat(`Fund value at age ${reportTillAge} (no withdrawal)`, inr(result.finalFundValue), "success"),
      stat("Horizon", `${result.totalYears} yrs`),
    );
    if (result.fundProjection && result.fundProjection.length > 0) {
      out.push(
        section("1. Fund value projection (no withdrawals)"),
        table(["Age", "Years", "Invested", "Fund value"], result.fundProjection.map((r) => [`${r.age}`, `${r.years}`, inr(r.invested), inr(r.fundValue)])),
        insight("With no withdrawals, the corpus compounds uninterrupted — ideal for legacy and long-term wealth creation.", "success"),
      );
    }
    if (result.swpTable && result.swpTable.length > 0) {
      out.push(
        section(`2. Maximum monthly SWP (sustained till age ${reportTillAge})`),
        table(
          ["Start withdrawals", "Corpus at start", "Max monthly SWP", "Total withdrawn"],
          result.swpTable.map((r) => [startLabel(r), inr(r.corpus), inr(r.maxSwpShown), inr(r.totalWithdrawn)]),
        ),
        insight("Delaying withdrawals lets the corpus grow first, so a later start sustains a much higher monthly income.", "brand"),
      );
    }
    if (result.customTable && result.customTable.length > 0) {
      const ct = result.customTable;
      out.push(
        section(`2. Custom withdrawal of ${inr(customMonthly)}/mo (till age ${reportTillAge})`),
        table(
          ["Start withdrawals", "Corpus at start", "Outcome", "Balance at end"],
          ct.map((r) => [
            startLabel(r),
            inr(r.corpus),
            r.sustained ? `Sustains till ${reportTillAge}` : `Runs out at age ${r.lastsTillAge}`,
            r.sustained ? inr(r.endBalance) : "—",
          ]),
        ),
        insight(
          ct.every((r) => r.sustained)
            ? `${inr(customMonthly)}/month is sustainable for every start age shown.`
            : `At ${inr(customMonthly)}/month, earlier start ages may exhaust the corpus before age ${reportTillAge} — a later start or lower withdrawal keeps it sustainable.`,
          ct.some((r) => !r.sustained) ? "danger" : "success",
        ),
      );
    }
    return out;
  },
};

/* ───────────────────────── Vacation Planner ───────────────────────── */

/** CalculatorsApp.tsx VacationPlannerCalc — Advanced Vacation Planner
 *  (vacationPlan). The drawdown chart is not drawn; the "First vacation" /
 *  "Final vacation" boxes are stats under their headings. */
const vacation: CalcBody = {
  inputs: [
    { key: "initial", label: "Initial investment (₹)", type: "money", default: 2000000 },
    { key: "vacationCost", label: "Current cost / vacation (₹)", type: "money", default: 400000 },
    { key: "numVacations", label: "No. of vacations", type: "int", default: 50 },
    { key: "returnPct", label: "Equity return (% p.a.)", type: "percent", default: 12 },
    { key: "inflationPct", label: "Vacation inflation (% p.a.)", type: "percent", default: 4 },
    { key: "growthPct", label: "SIP grows / yr (%)", type: "percent", default: 15 },
    { key: "sipYears", label: "No. of years of SIP", type: "years", default: 12 },
  ],
  compute: (v) => {
    const vacationCost = nn(v.vacationCost);
    const returnPct = nn(v.returnPct);
    const growthPct = nn(v.growthPct);
    const inflationPct = nn(v.inflationPct);
    const numVacations = nn(v.numVacations);
    const sipYears = nn(v.sipYears);
    const res = vacationPlan({
      initialInvestment: nn(v.initial),
      equityReturnPct: returnPct,
      sipGrowthPct: growthPct,
      sipYears,
      currentVacationCost: vacationCost,
      vacationInflationPct: inflationPct,
      numVacations,
    });
    const fullyFunded = res.amountStillNeeded <= 0;
    const last = res.drawdown[res.drawdown.length - 1];
    return [
      stat("Corpus needed (1 yr out)", inr(res.corpusNeeded), "success"),
      stat("Initial grows to (1 yr)", inr(res.initialAfterOneYear)),
      stat(
        fullyFunded ? "Surplus — fully funded" : "Gap to fund via SIP",
        inr(fullyFunded ? res.initialAfterOneYear - res.corpusNeeded : res.amountStillNeeded),
        fullyFunded ? "success" : "warning",
      ),
      stat("Growing SIP — monthly (mo 1)", fullyFunded ? "—" : inr(res.monthlySip), "success"),
      stat("Growing SIP — annual (yr 1)", fullyFunded ? "—" : inr(res.annualSip), "success"),
      stat("Or one-time lumpsum today", fullyFunded ? "—" : inr(res.lumpsumToday), "success"),
      stat("Total vacation spend (nominal)", inrCompact(res.totalNominalSpend)),
      section("First vacation"),
      stat("Year 1 cost", inr(res.drawdown[0]?.cost ?? vacationCost)),
      stat("Growth-adjusted rate", `${res.realRatePct.toFixed(2)}%`),
      section(`Final vacation (#${numVacations})`),
      stat(`Year ${numVacations} cost`, inr(last?.cost ?? 0)),
      stat("Corpus left at end", inr(Math.max(0, last?.balanceAfter ?? 0))),
      note(`The corpus is the present value (one year out) of ${numVacations} annual vacations — each escalating ${inflationPct}% and withdrawn at the start of the year, with the remaining balance earning ${returnPct}%. The growing SIP steps up ${growthPct}% every year for ${sipYears} years. The SIP figures grow the actual initial investment by one year (the workbook’s monthly path does the same), so the monthly value matches the source sheet to the rupee. Instead of the SIP, a one-time lumpsum today (on top of the initial investment) closes the gap: the gap discounted one year at ${returnPct}%.`),
    ];
  },
};

/* ───────────────────────── Child Education ───────────────────────── */

/** ChildEducationProjector.tsx — Child Education & Marriage Planner
 *  (computeChildEducation). The web's milestone list is three slots: its
 *  pre-filled "Education" row, then two "Next milestone" rows (the web's
 *  "+ Add another milestone" defaults). */
type Purpose = "education" | "marriage" | "investment";
const PURPOSE_LABEL: Record<Purpose, string> = { education: "Education", marriage: "Marriage", investment: "Investment" };
const EDU_SLOTS = [
  { name: "Education", age: 21, cost: 10000000 },
  { name: "Next milestone", age: 24, cost: 1000000 },
  { name: "Next milestone", age: 24, cost: 1000000 },
];
const eduOn = slotOn("m");
const childedu: CalcBody = {
  inputs: [
    { key: "childName", label: "Child's name", type: "text", default: "" },
    { key: "childCurrentAge", label: "Child's current age (yrs)", type: "years", default: 4 },
    { key: "purpose", label: "Money needed for", type: "segmented", default: "education", options: opts(Object.entries(PURPOSE_LABEL)) },
    ...EDU_SLOTS.flatMap((d, idx): InputSpec[] => {
      const i = idx + 1;
      const on = (v: Values) => eduOn(v, i);
      return [
        ...(i > 1 ? [includeToggle(`m${i}on`, `Milestone ${i}`, "Include this milestone", false)] : []),
        { key: `m${i}name`, label: "Need", type: "text", default: d.name, visibleIf: on, ...(i === 1 ? { section: "When and how much (today's cost)" } : {}) },
        { key: `m${i}age`, label: "Needed at child's age", type: "years", default: d.age, visibleIf: on },
        { key: `m${i}cost`, label: "Cost today (₹)", type: "money", default: d.cost, visibleIf: on },
      ];
    }),
    { key: "inflationPct", label: "Expected inflation (%)", type: "percent", default: 6 },
    { key: "existingSavings", label: "Savings already set aside (₹)", type: "money", default: 500000 },
    { key: "savingsReturnPct", label: "Return on those savings (%)", type: "percent", default: 12 },
    { key: "scenario1Pct", label: "Return on new investment — scenario 1 (%)", type: "percent", default: 12 },
    { key: "useScenario2", label: "Compare scenario 2", type: "toggle", default: true },
    { key: "scenario2Pct", label: "Scenario 2 return (%)", type: "percent", default: 15, visibleIf: (v) => !!v.useScenario2 },
  ],
  compute: (v) => {
    const purpose = pick<Purpose>(v.purpose, ["education", "marriage", "investment"], "education");
    const childCurrentAge = nn(v.childCurrentAge);
    const inflationPct = nn(v.inflationPct);
    const scenario1Pct = nn(v.scenario1Pct);
    const rows: EduMilestone[] = range(EDU_SLOTS.length).filter((i) => eduOn(v, i)).map((i) => ({
      name: String(v[`m${i}name`] ?? ""),
      childAgeAtStart: nn(v[`m${i}age`]),
      currentCost: nn(v[`m${i}cost`]),
    }));
    const result = computeChildEducation({
      childCurrentAge,
      eduInflationPct: inflationPct,
      expectedReturnPct: scenario1Pct,
      existingSavings: nn(v.existingSavings),
      currentInvestmentReturnPct: nn(v.savingsReturnPct),
      scenario2Pct: v.useScenario2 ? nn(v.scenario2Pct) : null,
      milestones: rows,
    });
    const single = result.milestones.length === 1;
    const who = String(v.childName ?? "").trim() || "the child";
    const rateHead = (ratePct: number) => `@ ${fmtPct(ratePct)}`;
    const opt = (x: number | null) => (x == null ? "—" : inr(x));

    const out: ResultBlock[] = [];
    result.milestones.forEach((m, i) => {
      out.push(
        section(`${i + 1}. ${m.name || PURPOSE_LABEL[purpose]} for ${who} — in ${m.yearsAway} years`),
        stat("Cost when needed", inr(m.futureCost), "brand"),
        stat("Savings will cover", inr(m.savingsApplied)),
        stat("Balance to fund", inr(m.balance), m.balance > 0 ? "warning" : "success"),
      );
      if (m.balance <= 0) {
        out.push(insight("The savings already set aside cover this need — nothing more to invest.", "success"));
      } else if (isDueNow(m.yearsAway)) {
        out.push(insight(`This need is due now — only a lumpsum (${inr(m.balance)}) can meet it.`, "warning"));
      } else {
        out.push(table(
          ["Way to fund the balance", ...m.options.map((o) => rateHead(o.ratePct))],
          [
            [`Monthly SIP till age ${childCurrentAge + m.yearsAway}`, ...m.options.map((o) => inr(o.sipTillGoal))],
            ["Monthly SIP for 5 years, then hold", ...m.options.map((o) => opt(o.sip5y))],
            ["Monthly SIP for 10 years, then hold", ...m.options.map((o) => opt(o.sip10y))],
            ["Lumpsum today", ...m.options.map((o) => inr(o.lumpsum))],
          ],
        ));
      }
    });
    if (!single) {
      out.push(
        stat("All needs — future cost", inr(result.totalFutureCost), "brand"),
        stat(`All needs — monthly SIP ${rateHead(scenario1Pct)}`, inr(result.totalMonthlySip), "success"),
        stat(`All needs — lumpsum ${rateHead(scenario1Pct)}`, inr(result.totalLumpsum)),
      );
    }
    const m0 = result.milestones[0];
    if (m0 && m0.balance > 0 && !isDueNow(m0.yearsAway)) {
      // The web quotes the FIRST row's cost today beside the NEAREST milestone's figures.
      out.push(insight(`At ${fmtPct(inflationPct)} inflation, today's ${inr(rows[0]?.currentCost ?? 0)} becomes ${inr(m0.futureCost)} in ${m0.yearsAway} years. Starting now, ${inr(m0.options[0].sipTillGoal)}/month ${rateHead(scenario1Pct)} closes the gap — a shorter SIP needs more each month, and waiting raises every figure.`, "brand"));
    }
    out.push(note("* Illustration only. SIPs are invested at the start of each month at the effective monthly equivalent of the yearly return; a 5- or 10-year SIP stays invested until the money is needed. Savings already set aside grow yearly at their own return. Returns are neither indicative nor guaranteed. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── Early-Start Child SIP ───────────────────────── */

/** EarlyStartChildSip.tsx — Early-Start Child SIP (computeChildSip). The web's
 *  section 3 is a growth chart only, which the app does not draw. */
const childsip: CalcBody = {
  inputs: [
    { key: "startAge", label: "Child's current age", type: "years", default: 0 },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 25000 },
    { key: "investTillAge", label: "Invest till age", type: "years", default: 20 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "projectToAge", label: "Project to age", type: "years", default: 50 },
  ],
  compute: (v) => {
    const startAge = nn(v.startAge);
    const monthlySip = nn(v.monthlySip);
    const investTillAge = nn(v.investTillAge);
    const returnPct = nn(v.returnPct);
    const res = computeChildSip({ startAge, monthlySip, investTillAge, returnPct, projectToAge: nn(v.projectToAge) });
    return [
      section("1. The headline"),
      stat(`Invested (${res.investYears}y of SIP)`, inr(res.totalInvested)),
      stat(`Corpus at age ${investTillAge}`, inr(res.corpusAtTill), "brand"),
      stat(`Value at age ${res.finalAge}`, inr(res.finalValue), "success"),
      stat("Multiple on invested", `${res.finalMultiple.toFixed(1)}×`, "success"),
      insight(`A ${inr(monthlySip)}/month SIP from age ${startAge} to ${investTillAge} (${inr(res.totalInvested)} invested over ${res.investYears} years), left to compound at ${returnPct}%, grows to ${inr(res.finalValue)} by age ${res.finalAge} — about ${res.finalMultiple.toFixed(1)}× the amount invested, without adding a rupee after age ${investTillAge}.`, "success"),
      section("2. Value at each milestone age"),
      table(
        ["Age", "Corpus value", "× of invested"],
        res.milestones.map((m) => [`Age ${m.age}${m.age === investTillAge ? " (SIP ends)" : ""}`, inr(m.value), `${m.multiple.toFixed(1)}×`]),
        true,
      ),
      note("* Illustration only. The assumed return is an annual rate throughout: the SIP (contributions at month start) and the corpus after the investing period both grow at it. Returns are not guaranteed and vary with markets. Not investment advice — mutual fund investments are subject to market risks."),
    ];
  },
};

/* ───────────────────────── Goal-Collision Timeline ───────────────────────── */

/** GoalCollisionTimeline.tsx — Goal-Collision Timeline (computeGoalCollision).
 *  Six goal slots: the web's four pre-filled goals, then two "New goal" rows
 *  (the web's "+ Add goal" defaults). The per-goal list and the yearly bars
 *  are tables. */
const COLLISION_SLOTS: Array<CollisionGoal & { on: boolean }> = [
  { name: "Car upgrade", yearsAway: 3, futureCost: 1500000, returnPct: 9, on: true },
  { name: "Child education", yearsAway: 12, futureCost: 8000000, returnPct: 12, on: true },
  { name: "Home down-payment", yearsAway: 6, futureCost: 4000000, returnPct: 11, on: true },
  { name: "Retirement", yearsAway: 25, futureCost: 50000000, returnPct: 12, on: true },
  { name: "New goal", yearsAway: 5, futureCost: 1000000, returnPct: 11, on: false },
  { name: "New goal", yearsAway: 5, futureCost: 1000000, returnPct: 11, on: false },
];
const collisionOn = slotOn("c");
const collision: CalcBody = {
  inputs: COLLISION_SLOTS.flatMap((d, idx): InputSpec[] => {
    const i = idx + 1;
    const on = (v: Values) => collisionOn(v, i);
    return [
      ...(i > 1 ? [includeToggle(`c${i}on`, `Goal ${i}`, "Include this goal", d.on)] : []),
      { key: `c${i}name`, label: "Goal", type: "text", default: d.name, visibleIf: on, ...(i === 1 ? { section: "Goals" } : {}) },
      { key: `c${i}years`, label: "Years away", type: "years", default: d.yearsAway, visibleIf: on },
      { key: `c${i}cost`, label: "Future cost (₹)", type: "money", default: d.futureCost, visibleIf: on },
      { key: `c${i}ret`, label: "Return %", type: "percent", default: d.returnPct, visibleIf: on },
    ];
  }),
  compute: (v) => {
    const goals: CollisionGoal[] = range(COLLISION_SLOTS.length).filter((i) => collisionOn(v, i)).map((i) => ({
      name: String(v[`c${i}name`] ?? ""),
      yearsAway: nn(v[`c${i}years`]),
      futureCost: nn(v[`c${i}cost`]),
      returnPct: nn(v[`c${i}ret`]),
    }));
    const result = computeGoalCollision(goals);
    const running = result.timeline[0]?.activeGoals.length ?? 0;
    return [
      stat("Highest monthly commitment (now)", inr(result.peakMonthly), "danger"),
      stat("Or one-time lumpsum today (all goals)", inr(result.totalLumpsumToday)),
      stat("Goals running now", `${running}`, "warning"),
      stat("Goals", `${result.goals.length}`),
      section("1. Required monthly SIP — or one-time lumpsum today — per goal"),
      table(
        ["Goal", "Years away · future cost", "Monthly SIP or lumpsum today"],
        result.goals.map((g) => [
          g.name,
          `${g.yearsAway}y · ${inr(g.futureCost)}`,
          isDueNow(g.yearsAway) ? `Due now — lumpsum ${inr(g.lumpsumToday)}` : `${inr(g.monthlySip)}/mo or ${inr(g.lumpsumToday)} today`,
        ]),
      ),
      section("2. Total monthly outflow by year"),
      table(["Year", "Total monthly outflow"], result.timeline.map((y) => [`Y${y.year}`, `${inr(y.totalMonthly)}/mo`])),
      insight(`The household's monthly investment commitment is highest now — ${inr(result.peakMonthly)}/month while ${running} goals run together — and eases as each goal is reached. Funding every goal with a one-time lumpsum instead would take ${inr(result.totalLumpsumToday)} invested today.`, "warning"),
    ];
  },
};

/* ───────────────────────── Goal-Feasibility Score ───────────────────────── */

/** GoalFeasibilityScore.tsx — Goal-Feasibility Score (computeGoalFeasibility).
 *  Five goal slots: the web's three pre-filled goals, then two "New goal" rows
 *  (the web's "+ Add goal" defaults). The score dial is one stat: the verdict,
 *  the score, and the dial's caption under it. */
const FEAS_SLOTS: Array<FeasGoal & { on: boolean }> = [
  { name: "Child education", futureCost: 8000000, yearsAway: 12, returnPct: 12, on: true },
  { name: "Retirement", futureCost: 50000000, yearsAway: 25, returnPct: 12, on: true },
  { name: "Home", futureCost: 4000000, yearsAway: 6, returnPct: 10, on: true },
  { name: "New goal", futureCost: 1000000, yearsAway: 5, returnPct: 11, on: false },
  { name: "New goal", futureCost: 1000000, yearsAway: 5, returnPct: 11, on: false },
];
const feasOn = slotOn("f");
const feasibility: CalcBody = {
  inputs: [
    { key: "monthlyIncome", label: "Monthly income (₹)", type: "money", default: 200000 },
    { key: "currentMonthlySip", label: "Current monthly SIP (₹)", type: "money", default: 40000 },
    { key: "existingCorpus", label: "Existing corpus (₹)", type: "money", default: 2500000 },
    { key: "corpusReturnPct", label: "Corpus return (%)", type: "percent", default: 11 },
    ...FEAS_SLOTS.flatMap((d, idx): InputSpec[] => {
      const i = idx + 1;
      const on = (v: Values) => feasOn(v, i);
      return [
        ...(i > 1 ? [includeToggle(`f${i}on`, `Goal ${i}`, "Include this goal", d.on)] : []),
        { key: `f${i}name`, label: "Goal", type: "text", default: d.name, visibleIf: on, ...(i === 1 ? { section: "Goals (future cost)" } : {}) },
        { key: `f${i}cost`, label: "Future cost (₹)", type: "money", default: d.futureCost, visibleIf: on },
        { key: `f${i}years`, label: "Years away", type: "years", default: d.yearsAway, visibleIf: on },
        { key: `f${i}ret`, label: "Return %", type: "percent", default: d.returnPct, visibleIf: on },
      ];
    }),
  ],
  compute: (v) => {
    const goals: FeasGoal[] = range(FEAS_SLOTS.length).filter((i) => feasOn(v, i)).map((i) => ({
      name: String(v[`f${i}name`] ?? ""),
      futureCost: nn(v[`f${i}cost`]),
      yearsAway: nn(v[`f${i}years`]),
      returnPct: nn(v[`f${i}ret`]),
    }));
    const result = computeGoalFeasibility({
      monthlyIncome: nn(v.monthlyIncome),
      currentMonthlySip: nn(v.currentMonthlySip),
      existingCorpus: nn(v.existingCorpus),
      corpusReturnPct: nn(v.corpusReturnPct),
      goals,
    });
    const s = result.score;
    const tone = TONE[s >= 80 ? "emerald" : s >= 55 ? "amber" : "rose"];
    const verdict = s >= 80 ? "On track" : s >= 55 ? "Needs attention" : "Off track";
    const text = result.gapMonthly > 0
      ? `To fully fund every goal, the plan needs about ${inr(result.netRequiredMonthly)}/month (or a one-time ${inr(result.netLumpsumToday)} invested today) but only ${inr(result.availableMonthly)} is being invested — a ${inr(result.gapMonthly)}/month gap. Closing it (or extending timelines / trimming goals) lifts the score.`
      : result.dueNowUncovered > 0
        ? `The monthly plan covers the future goals, but ${inr(result.dueNowUncovered)} due now is not covered by the corpus.`
        : `The current ${inr(result.availableMonthly)}/month plan fully covers all goals — the household is comfortably on track.`;
    return [
      stat(verdict, `${s}`, tone, `Feasibility score out of 100 · savings rate ${result.savingsRatePct.toFixed(0)}%`),
      stat("Required monthly (all goals)", inr(result.requiredMonthlyTotal)),
      stat("Covered by existing corpus", inr(result.corpusCoversMonthlyEquivalent)),
      stat("Net required / available", `${inr(result.netRequiredMonthly)} / ${inr(result.availableMonthly)}`),
      stat("Monthly gap", inr(result.gapMonthly), result.gapMonthly > 0 ? "danger" : "success"),
      stat("Or one-time lumpsum today (after corpus)", inr(result.netLumpsumToday)),
      insight(text, tone),
    ];
  },
};

/* ───────────────────────── Inflation ───────────────────────── */

/** CalculatorsApp.tsx InflationCalc — Inflation Calculator (inflatedTarget).
 *  The rate defaults to the assumption the web falls back on (6%). */
const inflation: CalcBody = {
  inputs: [
    { key: "expenseType", label: "Type of expense", type: "text", default: "", placeholder: "e.g. College fees, home cost" },
    { key: "amount", label: "Current amount (₹)", type: "money", default: 100000 },
    { key: "years", label: "Years", type: "years", default: 15 },
    { key: "ratePct", label: "Inflation rate (% p.a.)", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const amount = nn(v.amount);
    const fv = inflatedTarget(amount, nn(v.ratePct), nn(v.years));
    return [
      stat("Today's value", inr(amount)),
      stat("Future value", inr(fv), "warning"),
      stat("Inflation impact", inr(fv - amount), "danger"),
    ];
  },
};

/* ───────────────────────── SIP for a Target & Cost of Delay ───────────────────────── */

/** SipForTargetCalculator.tsx — SIP for a Target & Cost of Delay (sipForTarget).
 *  The year-wise chart is not drawn. */
const delay: CalcBody = {
  inputs: [
    { key: "target", label: "Target amount (₹)", type: "money", default: 5000000 },
    { key: "years", label: "SIP period (yrs)", type: "years", default: 15 },
    ...scenarioInputs(12, 15, true),
    { key: "withStepUp", label: "Compare a step-up SIP", type: "toggle", default: true },
    { key: "stepUpPct", label: "Step-up every year (%)", type: "percent", default: 10, visibleIf: (v) => !!v.withStepUp },
    { key: "withDelay", label: "Show cost of delay", type: "toggle", default: true },
    reportInput(),
  ],
  compute: (v) => {
    const target = nn(v.target);
    const stepUpPct = nn(v.stepUpPct);
    const rates = ratesOf(v).map(nn);
    const res = sipForTarget({ target, years: nn(v.years), ratesPct: rates, stepUpPct: v.withStepUp ? stepUpPct : null, costOfDelay: !!v.withDelay });
    const s1 = res[0];
    const n = s1?.rows.length ?? 0;
    if (n === 0) return [insight("Enter a SIP period of at least one year.", "warning")];

    const hasStep = !!s1.stepUp;
    const delay1 = s1.delay?.[0];
    const scenarioHead = (label: string) => res.map((sc) => `${label} @ ${fmtPct(sc.ratePct)}`);
    const stepLabel = `+${fmtPct(stepUpPct)}/yr`;
    const out: ResultBlock[] = [
      ...res.map((sc, i) => stat(`Monthly SIP @ ${fmtPct(sc.ratePct)}`, inr(sc.sip), i === 0 ? "brand" : undefined)),
      ...res.map((sc) => stat(`One-time lumpsum today @ ${fmtPct(sc.ratePct)}`, inr(sc.lumpsumToday))),
      ...(hasStep ? res.map((sc) => stat(`Starting step-up SIP @ ${fmtPct(sc.ratePct)}`, inr(sc.stepUp?.startSip ?? NaN), "success")) : []),
      table(
        ["", ...scenarioHead("Monthly SIP"), ...scenarioHead("Total invested")],
        [
          ["SIP", ...res.map((sc) => inr(sc.sip)), ...res.map((sc) => inr(sc.total))],
          ...(hasStep
            ? [[`Step-up SIP (${stepLabel})`, ...res.map((sc) => inr(sc.stepUp?.startSip ?? NaN)), ...res.map((sc) => inr(sc.stepUp?.total ?? NaN))]]
            : []),
        ],
      ),
      insight(`To reach ${inr(target)} in ${n} years at ${fmtPct(s1.ratePct)}: a SIP of ${inr(s1.sip)}/month — or a one-time lumpsum of ${inr(s1.lumpsumToday)} invested today${res[1] ? ` (${inr(res[1].sip)}/month or ${inr(res[1].lumpsumToday)} today at ${fmtPct(res[1].ratePct)})` : ""}.`, "brand"),
    ];
    if (delay1) {
      out.push(insight(`Waiting just one year lifts the SIP needed at ${fmtPct(s1.ratePct)} from ${inr(s1.sip)} to ${inr(delay1.sip)} a month — and the total put in from ${inr(s1.total)} to ${inr(delay1.total)}.`, "warning"));
    }
    if (v.view === "detailed") {
      const yearHead = ["Year", ...res.flatMap((sc) => [`Invested @ ${fmtPct(sc.ratePct)}`, `Year-end value @ ${fmtPct(sc.ratePct)}`])];
      out.push(
        section("1. SIP — year-wise value"),
        table(yearHead, s1.rows.map((r, i) => [`${r.year}`, ...res.flatMap((sc) => [inr(sc.rows[i]?.annual ?? NaN), inr(sc.rows[i]?.value ?? NaN)])]), true),
      );
      if (hasStep) {
        out.push(
          section(`2. Step-up SIP (${stepLabel}) — year-wise value`),
          table(
            yearHead,
            (s1.stepUp?.rows ?? []).map((r, i) => [`${r.year}`, ...res.flatMap((sc) => [inr(sc.stepUp?.rows[i]?.annual ?? NaN), inr(sc.stepUp?.rows[i]?.value ?? NaN)])]),
            true,
          ),
        );
      }
      if (s1.delay && s1.delay.length > 0) {
        out.push(
          section(`${hasStep ? 3 : 2}. Cost of delaying the SIP`),
          table(
            ["Start delayed by", ...scenarioHead("Monthly SIP"), ...scenarioHead("Total invested")],
            [
              ["No delay", ...res.map((sc) => inr(sc.sip)), ...res.map((sc) => inr(sc.total))],
              ...s1.delay.map((d, i) => [
                `${d.delayYears} yr${d.delayYears === 1 ? "" : "s"}`,
                ...res.map((sc) => inr(sc.delay?.[i]?.sip ?? NaN)),
                ...res.map((sc) => inr(sc.delay?.[i]?.total ?? NaN)),
              ]),
            ],
          ),
        );
      }
    }
    return out;
  },
};

/* ───────────────────────── Retirement Need Based ───────────────────────── */

/** RetirementNeedCalculator.tsx — Retirement Need Based Calculator
 *  (retirementNeed). The drawdown chart is not drawn. */
const retirement: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (yrs)", type: "years", default: 32 },
    { key: "retirementAge", label: "Retirement age (yrs)", type: "years", default: 55 },
    { key: "monthlyExpense", label: "Monthly expense today (₹)", type: "money", default: 40000 },
    { key: "inflPrePct", label: "Inflation till retirement (%)", type: "percent", default: 6 },
    { key: "inflPostPct", label: "Inflation after retirement (%)", type: "percent", default: 5 },
    { key: "acc1", label: "Return before retirement (%)", type: "percent", default: 12 },
    { key: "dist1", label: "Return after retirement (%)", type: "percent", default: 8 },
    { key: "annuityEndAge", label: "Income needed until age", type: "years", default: 85 },
    { key: "endBalance", label: "Balance to leave at that age (₹)", type: "money", default: 10000000 },
    { key: "currentInvestment", label: "Existing investments today (₹)", type: "money", default: 200000 },
    { key: "currentInvestmentPct", label: "Return on existing investments (%)", type: "percent", default: 7.5 },
    { key: "receivable", label: "Other money due at retirement (₹)", type: "money", default: 5000000 },
    { key: "useScenario2", label: "Compare a second scenario", type: "toggle", default: false },
    { key: "acc2", label: "Scenario 2 — before retirement (%)", type: "percent", default: 10, visibleIf: (v) => !!v.useScenario2 },
    { key: "dist2", label: "Scenario 2 — after retirement (%)", type: "percent", default: 7, visibleIf: (v) => !!v.useScenario2 },
  ],
  compute: (v) => {
    const retirementAge = nn(v.retirementAge);
    const annuityEndAge = nn(v.annuityEndAge);
    const monthlyExpense = nn(v.monthlyExpense);
    const currentInvestment = nn(v.currentInvestment);
    const currentInvestmentPct = nn(v.currentInvestmentPct);
    const receivable = nn(v.receivable);
    const s1in = { accPct: nn(v.acc1), distPct: nn(v.dist1) };
    const result = retirementNeed({
      currentAge: nn(v.currentAge),
      retirementAge,
      monthlyExpense,
      inflPrePct: nn(v.inflPrePct),
      inflPostPct: nn(v.inflPostPct),
      scenarios: v.useScenario2 ? [s1in, { accPct: nn(v.acc2), distPct: nn(v.dist2) }] : [s1in],
      currentInvestment,
      currentInvestmentPct,
      receivable,
      annuityEndAge,
      endBalance: nn(v.endBalance),
    });
    const sc = result.scenarios;
    const s1 = sc[0];
    const label = (i: number) => `Scenario ${i + 1} (${fmtPct(sc[i].accPct)} / ${fmtPct(sc[i].distPct)})`;
    const opt = (x: number | null) => (x == null ? "—" : inr(x));
    const funded = s1.gap <= 0;

    const out: ResultBlock[] = [
      stat(`Monthly expense at ${retirementAge}`, inr(result.expenseAtRetirement)),
      stat("Corpus needed", inr(s1.corpus), "brand"),
      stat("Existing investments grow to", inr(result.fvCurrent)),
      stat("Still to build", inr(Math.max(0, s1.gap)), funded ? "success" : "warning"),
      section("1. The retirement need"),
      table(
        ["", ...sc.map((_, i) => label(i))],
        [
          ["Monthly expense at retirement", ...sc.map(() => inr(result.expenseAtRetirement))],
          ["Total corpus required", ...sc.map((s) => inr(s.corpus))],
          [`Existing ${inr(currentInvestment)} @ ${fmtPct(currentInvestmentPct)} grows to`, ...sc.map(() => inr(result.fvCurrent))],
          ["Other money due at retirement", ...sc.map(() => inr(receivable))],
          ["Balance corpus required", ...sc.map((s) => inr(Math.max(0, s.gap)))],
        ],
        true,
      ),
      section("2. Ways to build the balance"),
      table(
        ["Option", ...sc.map((_, i) => label(i))],
        [
          [`Monthly SIP till age ${retirementAge}`, ...sc.map((s) => inr(s.sipTillRetirement))],
          ["Monthly SIP for 5 years, then stay invested", ...sc.map((s) => opt(s.sip5y))],
          ["Monthly SIP for 10 years, then stay invested", ...sc.map((s) => opt(s.sip10y))],
          ["Lumpsum today", ...sc.map((s) => inr(s.lumpsum))],
        ],
      ),
      funded
        ? insight("The existing investments and the money due at retirement already cover the corpus — no further investment is needed.", "success")
        : insight(`To retire at ${retirementAge} on today's ${inr(monthlyExpense)}/month lifestyle (about ${inr(result.expenseAtRetirement)}/month by then), invest ${inr(s1.sipTillRetirement)}/month until retirement, or ${inr(s1.lumpsum)} once today.`, "brand"),
    ];
    if (s1.rows.length > 0) {
      out.push(
        section(`3. Monthly income and corpus left, age ${retirementAge + 1} to ${annuityEndAge}`),
        table(
          ["Age", ...sc.flatMap((_, i) => [`Avg monthly income · S${i + 1}`, `Corpus at year end · S${i + 1}`])],
          s1.rows.map((r, ri) => [
            `${r.age}`,
            ...sc.flatMap((s) => [inr(s.rows[ri]?.avgMonthlyAnnuity ?? NaN), inr(s.rows[ri]?.balanceEoy ?? NaN)]),
          ]),
          true,
        ),
      );
    }
    out.push(note("* Illustration only. The income is paid on the 1st of every month and rises monthly in line with post-retirement inflation; the monthly figure in the table is the average of that year's twelve payments. SIPs are invested at the start of each month; returns compound at the effective monthly equivalent of the yearly rate. Existing investments compound yearly at their own rate. Returns are neither indicative nor guaranteed. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── Limited-Period SIP for a Target ───────────────────────── */

/** LimitedSipNeedCalculator.tsx — Limited-Period SIP for a Target
 *  (limitedSipNeed). The year-wise chart is not drawn. */
const limitedneed: CalcBody = {
  inputs: [
    { key: "target", label: "Target amount (₹)", type: "money", default: 2500000 },
    { key: "sipYears", label: "SIP period (yrs)", type: "years", default: 5 },
    { key: "deferYears", label: "Stay invested after the SIP (yrs)", type: "years", default: 10 },
    ...scenarioInputs(12, 15, false),
    reportInput(),
  ],
  compute: (v) => {
    const target = nn(v.target);
    const sipYears = nn(v.sipYears);
    const deferYears = nn(v.deferYears);
    const res = limitedSipNeed({ target, sipYears, deferYears, ratesPct: ratesOf(v).map(nn) });
    const s1 = res[0];
    const s = Math.max(0, Math.round(sipYears));
    const total = s + Math.max(0, Math.round(deferYears));
    const out: ResultBlock[] = [
      ...res.map((sc, i) => stat(`Monthly SIP needed @ ${fmtPct(sc.ratePct)}`, inr(sc.monthlySip), i === 0 ? "brand" : "success")),
      ...res.map((sc) => stat(`One-time lumpsum today @ ${fmtPct(sc.ratePct)}`, inr(sc.lumpsumToday))),
      ...res.map((sc) => stat(`Total invested @ ${fmtPct(sc.ratePct)}`, inr(sc.totalInvestment))),
      s1 && Number.isFinite(s1.monthlySip)
        ? insight(`A SIP of ${inr(s1.monthlySip)}/month for ${s} years — ${inr(s1.totalInvestment)} in all — then left invested for ${total - s} more years reaches ${inr(target)} at ${fmtPct(s1.ratePct)} — as would a one-time lumpsum of ${inr(s1.lumpsumToday)} invested today and left for all ${total} years.`, "brand")
        : insight("Enter a SIP period of at least one year.", "warning"),
    ];
    if (v.view === "detailed") {
      res.forEach((sc, i) => {
        if (sc.rows.length === 0) return;
        out.push(
          section(`${i + 1}. Year-wise value @ ${fmtPct(sc.ratePct)}`),
          table(
            ["Year", "Monthly SIP", "Invested in year", "Year-end value"],
            sc.rows.map((r) => [`${r.year}`, r.monthly > 0 ? inr(r.monthly) : "—", r.annual > 0 ? inr(r.annual) : "—", inr(r.value)]),
            true,
          ),
        );
      });
    }
    return out;
  },
};

/* ───────────────────────── Step-Up SIP for a Target ───────────────────────── */

/** StepUpSipForTargetCalculator.tsx — Step-Up SIP for a Target
 *  (stepUpSipForTarget). The year-wise chart is not drawn. */
const stepuptarget: CalcBody = {
  inputs: [
    { key: "target", label: "Target amount (₹)", type: "money", default: 5000000 },
    { key: "years", label: "SIP period (yrs)", type: "years", default: 15 },
    { key: "stepUpPct", label: "Step-up every year (%)", type: "percent", default: 5 },
    ...scenarioInputs(10, 13, true),
    reportInput(),
  ],
  compute: (v) => {
    const target = nn(v.target);
    const stepUpPct = nn(v.stepUpPct);
    const res = stepUpSipForTarget({ target, years: nn(v.years), stepUpPct, ratesPct: ratesOf(v).map(nn) });
    const s1 = res[0];
    const out: ResultBlock[] = [
      ...res.map((sc, i) => stat(`Starting SIP @ ${fmtPct(sc.ratePct)}`, inr(sc.startSip), i === 0 ? "brand" : "success")),
      ...res.map((sc) => stat(`One-time lumpsum today @ ${fmtPct(sc.ratePct)}`, inr(sc.lumpsumToday))),
      ...res.map((sc) => stat(`Total invested @ ${fmtPct(sc.ratePct)}`, inr(sc.total))),
      s1 && Number.isFinite(s1.startSip)
        ? insight(`Start at ${inr(s1.startSip)}/month and raise it ${fmtPct(stepUpPct)} every year to reach ${inr(target)} at ${fmtPct(s1.ratePct)}${res[1] ? ` — or start at ${inr(res[1].startSip)}/month at ${fmtPct(res[1].ratePct)}` : ""}. Or invest a one-time lumpsum of ${inr(s1.lumpsumToday)} today at ${fmtPct(s1.ratePct)}${res[1] ? ` (${inr(res[1].lumpsumToday)} at ${fmtPct(res[1].ratePct)})` : ""} and leave it to grow.`, "brand")
        : insight("Enter a SIP period of at least one year.", "warning"),
    ];
    if (v.view === "detailed" && s1 && s1.rows.length > 0) {
      res.forEach((sc, i) => {
        out.push(
          section(`${i + 1}. Year-wise plan @ ${fmtPct(sc.ratePct)}`),
          table(["Year", "Monthly SIP", "Invested in year", "Year-end value"], sc.rows.map((r) => [`${r.year}`, inr(r.monthly), inr(r.annual), inr(r.value)]), true),
        );
      });
    }
    return out;
  },
};

/* ───────────────────────── SIP or Lumpsum for a Target ───────────────────────── */

/** SipLumpsumForTargetCalculator.tsx — SIP or Lumpsum for a Target
 *  (sipLumpsumForTarget). The year-wise chart is not drawn. */
const siplstarget: CalcBody = {
  inputs: [
    { key: "target", label: "Target amount (₹)", type: "money", default: 10000000 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 15 },
    { key: "solve", label: "Work out", type: "segmented", default: "sip", options: opts([["sip", "SIP needed"], ["lumpsum", "Lumpsum needed"]]) },
    { key: "lumpsum", label: "Lumpsum invested today (₹)", type: "money", default: 1000000, visibleIf: (v) => v.solve !== "lumpsum" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 10000, visibleIf: (v) => v.solve === "lumpsum" },
    { key: "sipPct", label: "SIP return (%)", type: "percent", default: 12 },
    { key: "lumpsumPct", label: "Lumpsum return (%)", type: "percent", default: 12 },
    reportInput(),
  ],
  compute: (v) => {
    const target = nn(v.target);
    const solve = pick<"sip" | "lumpsum">(v.solve, ["sip", "lumpsum"], "sip");
    const sipPct = nn(v.sipPct);
    const lumpsumPct = nn(v.lumpsumPct);
    const res = sipLumpsumForTarget({ target, years: nn(v.years), solve, lumpsum: nn(v.lumpsum), monthlySip: nn(v.monthlySip), sipPct, lumpsumPct });
    const solved = solve === "sip" ? res.sip : res.lumpsum;
    const n = res.rows.length;
    const out: ResultBlock[] = [
      stat(solve === "sip" ? "Monthly SIP needed" : "Lumpsum needed today", inr(solved), "brand"),
      stat(solve === "sip" ? "Lumpsum today" : "Monthly SIP", inr(solve === "sip" ? res.lumpsum : res.sip)),
      stat("Total invested", n > 0 ? inr(res.rows[n - 1].cumulative) : "—"),
      stat("Target", inr(target)),
    ];
    if (res.covered) {
      out.push(insight(`The ${solve === "sip" ? `lumpsum of ${inr(res.lumpsum)}` : `SIP of ${inr(res.sip)}/month`} alone already reaches ${inr(target)} — nothing more is needed.`, "success"));
    } else if (Number.isFinite(solved) && n > 0) {
      out.push(insight(solve === "sip"
        ? `With ${inr(res.lumpsum)} invested today at ${fmtPct(lumpsumPct)}, a SIP of ${inr(res.sip)}/month at ${fmtPct(sipPct)} closes the gap to ${inr(target)}.`
        : `Alongside ${inr(res.sip)}/month at ${fmtPct(sipPct)}, a lumpsum of ${inr(res.lumpsum)} today at ${fmtPct(lumpsumPct)} closes the gap to ${inr(target)}.`, "brand"));
    } else {
      out.push(insight("Enter an investment period of at least one year.", "warning"));
    }
    if (v.view === "detailed" && n > 0) {
      out.push(
        section("1. Year-wise investment and value"),
        table(
          ["Year", "Invested in year", "Invested to date", "SIP value", "Lumpsum value", "Total value"],
          res.rows.map((r) => [`${r.year}`, inr(r.annual), inr(r.cumulative), inr(r.sipValue), inr(r.lumpsumValue), inr(r.total)]),
          true,
        ),
      );
    }
    return out;
  },
};

/* ───────────────────────── Lumpsum for a Target ───────────────────────── */

/** LumpsumForTargetCalculator.tsx — Lumpsum for a Target (lumpsumForTarget).
 *  The year-wise chart is not drawn. */
const lstarget: CalcBody = {
  inputs: [
    { key: "target", label: "Target amount (₹)", type: "money", default: 30000000 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 25 },
    ...scenarioInputs(12, 15, true),
    reportInput(),
  ],
  compute: (v) => {
    const target = nn(v.target);
    const res = lumpsumForTarget({ target, years: nn(v.years), ratesPct: ratesOf(v).map(nn) });
    const s1 = res[0];
    const n = s1?.rows.length ?? 0;
    const out: ResultBlock[] = [
      stat("Target", inr(target)),
      stat("Period", `${n} yrs`),
      ...res.map((sc, i) => stat(`Invest today @ ${fmtPct(sc.ratePct)}`, inr(sc.lumpsum), i === 0 ? "brand" : "success")),
    ];
    if (s1 && target > 0) {
      out.push(insight(`Investing ${inr(s1.lumpsum)} today at ${fmtPct(s1.ratePct)} grows to ${inr(target)} in ${n} years${res[1] ? `; at ${fmtPct(res[1].ratePct)} only ${inr(res[1].lumpsum)} is needed` : ""}.`, "brand"));
    }
    if (v.view === "detailed" && n > 0) {
      out.push(
        section("1. Value at the end of each year"),
        table(
          ["Year", ...res.flatMap((sc) => [`Invested @ ${fmtPct(sc.ratePct)}`, `Year-end value @ ${fmtPct(sc.ratePct)}`])],
          s1.rows.map((r, i) => [
            `${r.year}`,
            ...res.flatMap((sc) => {
              const row = sc.rows[i];
              return [row && row.investment > 0 ? inr(row.investment) : "—", inr(row?.value ?? NaN)];
            }),
          ]),
          true,
        ),
      );
    }
    return out;
  },
};

/* ───────────────────────── SIP / STP for Target ───────────────────────── */

/** SipStpTargetCalculator.tsx — SIP / STP Required for Target Future Value
 *  (computeSipStpForTarget); the year-wise table is StpParts.tsx SipStpYearTable
 *  (its chart is not drawn). The web's transfer-rule line under the inputs
 *  leads the results. */
const sipstpgoal: CalcBody = {
  inputs: [
    { key: "target", label: "Target amount (₹)", type: "money", default: 2500000 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 10 },
    { key: "solve", label: "Calculate", type: "segmented", default: "sip", options: opts([["sip", "Monthly SIP"], ["stp", "STP lumpsum"]]) },
    { key: "stpLumpsum", label: "STP lumpsum in debt fund (₹)", type: "money", default: 500000, visibleIf: (v) => v.solve !== "stp" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 5000, visibleIf: (v) => v.solve === "stp" },
    { key: "debtPct", label: "Debt fund return (% p.a.)", type: "percent", default: 6 },
    { key: "equityPct", label: "Equity fund return (% p.a.)", type: "percent", default: 12 },
    { key: "sipRatePct", label: "SIP fund return (% p.a.)", type: "percent", default: 12 },
    { key: "detailed", label: "Show year-wise table", type: "toggle", default: true },
  ],
  compute: (v) => {
    const target = nn(v.target);
    const years = nn(v.years);
    const solve = pick<"sip" | "stp">(v.solve, ["sip", "stp"], "sip");
    const stpLumpsum = nn(v.stpLumpsum);
    const monthlySip = nn(v.monthlySip);
    const r = computeSipStpForTarget({
      target, years, solve, stpLumpsum, monthlySip, debtPct: nn(v.debtPct), equityPct: nn(v.equityPct), sipRatePct: nn(v.sipRatePct),
    });
    const p = r.projection;
    const solved = solve === "sip" ? r.monthlySip : r.stpLumpsum;
    const out: ResultBlock[] = [
      note("Monthly transfer: capital appreciation — only the debt fund's gain moves to equity; the lumpsum stays in debt."),
      stat(solve === "sip" ? "Monthly SIP required" : "STP lumpsum required", inr(solved), "brand"),
      stat("SIP fund value", inr(p.sipValue)),
      stat("STP fund value", inr(p.stpValue)),
      stat("Total value", inr(p.total), "success"),
    ];
    if (r.overshoots) {
      out.push(insight(solve === "sip"
        ? `The STP lumpsum alone grows past ${inr(target)} in ${years} years — no SIP is needed.`
        : `The SIP alone grows past ${inr(target)} in ${years} years — no STP lumpsum is needed.`, "warning"));
    } else if (Number.isFinite(solved) && years > 0) {
      out.push(insight(solve === "sip"
        ? `With ${inr(stpLumpsum)} in the STP, a SIP of ${inr(solved)} a month reaches ${inr(target)} in ${years} years.`
        : `With a SIP of ${inr(monthlySip)} a month, placing ${inr(solved)} in the STP reaches ${inr(target)} in ${years} years.`, "brand"));
    }
    if (v.detailed && p.rows.length > 0) {
      out.push(
        section("1. Year-wise investment and value"),
        table(
          ["Year", "Invested in the year", "Invested to date", "SIP fund", "STP fund", "Total"],
          p.rows.map((x) => [`${x.year}`, inr(x.annualInvestment), inr(x.cumulativeInvestment), inr(x.sipValue), inr(x.stpValue), inr(x.total)]),
          true,
        ),
      );
    }
    out.push(note("* Illustration only. The SIP is paid at the start of each month; the STP transfer is made at month end. Effective monthly rates. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── STP for Target ───────────────────────── */

/** StpParts.tsx describeMonthlyMode, copied verbatim (presentation text). */
function describeMonthlyMode(mode: MonthlyStpMode, amount: number, pct: number): string {
  if (mode === "appreciation") return "Capital appreciation (the debt fund's monthly gain)";
  if (mode === "fixedPct") return `${pct}% of the initial investment every month`;
  return `${inr(amount)} every month`;
}

/** StpTargetCalculator.tsx — STP Required for Target Future Value
 *  (stpRequiredForTarget); the transfer picker and year-wise table are
 *  StpParts.tsx MonthlyModeFields / StpYearTable (its chart is not drawn). The
 *  picker is two switches — "Monthly transfer", then "Fixed by" — each keeping
 *  its own choice. */
const stpgoal: CalcBody = {
  inputs: [
    { key: "target", label: "Target future value (₹)", type: "money", default: 10000000 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 12 },
    { key: "debtPct", label: "Debt fund return (% p.a.)", type: "percent", default: 6 },
    { key: "equityPct", label: "Equity fund return (% p.a.)", type: "percent", default: 12 },
    { key: "transfer", label: "Monthly transfer", type: "segmented", default: "fixed", options: opts([["appreciation", "Capital appreciation"], ["fixed", "Fixed transfer"]]) },
    { key: "fixedBy", label: "Fixed by", type: "segmented", default: "fixedPct", options: opts([["fixedAmount", "₹ amount"], ["fixedPct", "% of initial"]]), visibleIf: (v) => v.transfer !== "appreciation" },
    { key: "amount", label: "Transfer / month (₹)", type: "money", default: 30000, visibleIf: (v) => v.transfer !== "appreciation" && v.fixedBy === "fixedAmount" },
    { key: "pct", label: "Transfer / month (% of initial)", type: "percent", default: 1, visibleIf: (v) => v.transfer !== "appreciation" && v.fixedBy !== "fixedAmount" },
    { key: "detailed", label: "Show year-wise table", type: "toggle", default: true },
  ],
  compute: (v) => {
    const target = nn(v.target);
    const years = nn(v.years);
    const debtPct = nn(v.debtPct);
    const equityPct = nn(v.equityPct);
    const amount = nn(v.amount);
    const pct = nn(v.pct);
    const mode: MonthlyStpMode = v.transfer === "appreciation" ? "appreciation" : v.fixedBy === "fixedAmount" ? "fixedAmount" : "fixedPct";
    const { initialRequired, projection } = stpRequiredForTarget({ target, years, debtPct, equityPct, mode, fixedAmount: amount, fixedPct: pct });
    const out: ResultBlock[] = [];
    if (!Number.isFinite(initialRequired)) out.push(insight("No lumpsum reaches this target with these returns.", "warning"));
    if (projection && Number.isFinite(initialRequired)) {
      const stops = mode !== "appreciation" && projection.exhaustedAtPeriod != null
        ? ` Transfers stop after ${projection.transfersMade} months, when the debt fund holds less than one.`
        : "";
      out.push(
        stat("Initial investment required", inr(initialRequired), "brand"),
        stat("Debt fund value", inr(projection.debtFinalValue)),
        stat("Equity fund value", inr(projection.equityFinalValue)),
        stat("Total value", inr(projection.totalFinalValue)),
        stat("Annualised return", `${projection.annualisedReturnPct.toFixed(2)}%`, "success"),
        insight(`Place ${inr(initialRequired)} in a ${debtPct}% debt fund and move ${describeMonthlyMode(mode, amount, pct).toLowerCase()}${mode === "fixedPct" ? ` (${inr(projection.transferAmount)})` : ""} into a ${equityPct}% equity fund to reach ${inr(target)} in ${years} years.${stops}`, "brand"),
      );
      if (v.detailed && projection.schedule.length > 0) {
        out.push(
          section("1. Year-wise value of the plan"),
          table(
            ["Year", "Debt at start", "Moved to equity", "Equity at start", "Equity at end", "Total at end", "Annualised"],
            projection.schedule.map((r) => [
              `${r.year}`,
              inr(r.debtBeginning),
              r.transferredToEquity > 0 ? inr(r.transferredToEquity) : "—",
              inr(r.equityBeginning),
              inr(r.equityEnd),
              inr(r.totalEnd),
              `${r.annualisedReturnPct.toFixed(2)}%`,
            ]),
            true,
          ),
        );
      }
    }
    out.push(note("* Illustration only. Each month both funds earn their return (effective monthly rate), then the transfer is made at month end. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── PPF Maturity ───────────────────────── */

/** PpfCalculator.tsx — PPF Maturity (ppfCalc). Year-by-year deposits are one
 *  input per contributing year, as the web's grid; the balance chart is not
 *  drawn. */
const PPF_MAX_EXTENSIONS = 4;
const PPF_MAX_YEARS = PPF_TERM_YEARS + PPF_EXTENSION_YEARS * PPF_MAX_EXTENSIONS;
const ppfExtCount = (v: Values) => Math.min(PPF_MAX_EXTENSIONS, Math.max(0, Math.round(Number(v.extCount) || 0)));
const ppfContributing = (v: Values, year: number) => {
  if (year <= PPF_TERM_YEARS) return true;
  const block = Math.ceil((year - PPF_TERM_YEARS) / PPF_EXTENSION_YEARS);
  return block <= ppfExtCount(v) && !!v[`ext${block}`];
};
const ppf: CalcBody = {
  inputs: [
    { key: "mode", label: "Deposits", type: "segmented", default: "fixed", options: opts([["fixed", "Same every year"], ["variable", "Year by year"]]) },
    { key: "yearly", label: "Yearly deposit (₹)", type: "money", default: PPF_MAX_DEPOSIT, visibleIf: (v) => v.mode !== "variable" },
    { key: "rate", label: "Interest rate (% a year)", type: "percent", default: PPF_DEFAULT_RATE_PCT },
    { key: "extCount", label: "5-year extensions", type: "segmented", default: "0", options: [0, ...range(PPF_MAX_EXTENSIONS)].map((n) => ({ value: String(n), label: n === 0 ? "None" : `${n}` })) },
    ...range(PPF_MAX_EXTENSIONS).map((i): InputSpec => {
      const from = PPF_TERM_YEARS + (i - 1) * PPF_EXTENSION_YEARS + 1;
      return {
        key: `ext${i}`,
        label: `Extension ${i} (years ${from}–${from + PPF_EXTENSION_YEARS - 1}): keep depositing`,
        type: "toggle",
        default: true,
        visibleIf: (v) => ppfExtCount(v) >= i,
      };
    }),
    ...range(PPF_MAX_YEARS).map((y): InputSpec => ({
      key: `y${y}`,
      label: `Year ${y}`,
      type: "money",
      default: 100000,
      visibleIf: (v) => v.mode === "variable" && ppfContributing(v, y),
      ...(y === 1 ? { section: "Deposit for each year (₹)" } : {}),
    })),
  ],
  compute: (v) => {
    const mode: "fixed" | "variable" = v.mode === "variable" ? "variable" : "fixed";
    const rate = nn(v.rate);
    const extensions: PpfExtension[] = range(ppfExtCount(v)).map((i) => ({ withContributions: !!v[`ext${i}`] }));
    const res = ppfCalc({ mode, yearlyAmount: nn(v.yearly), amounts: range(PPF_MAX_YEARS).map((y) => nn(v[`y${y}`])), ratePct: rate, extensions });
    const out: ResultBlock[] = [];
    if (res.issues.length > 0) {
      const lines = res.issues.slice(0, 6).map((x) => `• ${x.message}`);
      if (res.issues.length > 6) lines.push(`• …and ${res.issues.length - 6} more years.`);
      out.push(insight(lines.join("\n"), "warning"));
    }
    out.push(
      stat("Total deposited", inr(res.totalDeposited)),
      stat("Interest earned", inr(res.totalInterest), "success"),
      stat(`Maturity value (${res.years} yrs)`, inr(res.maturity), "brand"),
      extensions.length > 0
        ? stat(`At the end of the ${PPF_TERM_YEARS}-year term`, inr(res.termMaturity))
        : stat("Interest rate", fmtPct(rate)),
    );
    if (res.totalDeposited > 0) {
      out.push(insight(`Deposits of ${inr(res.totalDeposited)} grow to ${inr(res.maturity)} at ${fmtPct(rate)} — interest of ${inr(res.totalInterest)}, all of it tax-free (PPF is exempt at deposit, on interest and at maturity; deposits qualify under Section 80C in the old regime).`, "brand"));
    }
    if (res.rows.length > 0) {
      out.push(
        section("1. Balance year by year"),
        table(
          ["Year", "Phase", "Opening balance", "Deposit", "Interest", "Closing balance"],
          res.rows.map((r) => [
            `${r.year}`,
            r.phase === "term" ? "Term" : `Extension ${r.block}${r.contributing ? "" : " (no deposits)"}`,
            inr(r.opening),
            r.deposit > 0 ? inr(r.deposit) : "—",
            inr(r.interest),
            inr(r.closing),
          ]),
          true,
        ),
        note("Each deposit is assumed made by 5 April, so it earns the full year's interest; interest is credited every 31 March. Deposits are limited to ₹500–₹1,50,000 a financial year. The government resets the rate every quarter — one rate is applied throughout."),
      );
    }
    return out;
  },
};

/* ───────────────────────── EPF Corpus ───────────────────────── */

/** EpfCalculator.tsx — EPF Corpus at Retirement (epfCalc). The balance chart
 *  is not drawn. */
const epf: CalcBody = {
  inputs: [
    { key: "age", label: "Current age", type: "years", default: 30 },
    { key: "retireAge", label: "Retirement age", type: "years", default: EPF_RETIREMENT_AGE },
    { key: "wage", label: "Monthly basic + DA (₹)", type: "money", default: 40000 },
    { key: "increase", label: "Yearly salary increase (%)", type: "percent", default: 6 },
    { key: "balance", label: "Current EPF balance (₹)", type: "money", default: 300000 },
    { key: "employeePct", label: "Your contribution (% of basic + DA)", type: "percent", default: EPF_EMPLOYEE_PCT },
    { key: "employerMode", label: "Employer's share to EPF", type: "segmented", default: "fixed_share", options: opts([["fixed_share", "A fixed %"], ["full_wage", "12% of full pay less pension"]]) },
    { key: "employerPct", label: "Employer's EPF share (%)", type: "percent", default: EPF_EMPLOYER_SHARE_PCT, visibleIf: (v) => v.employerMode !== "full_wage" },
    { key: "rate", label: "EPF interest rate (% a year)", type: "percent", default: EPF_DEFAULT_RATE_PCT },
  ],
  compute: (v) => {
    const retireAge = nn(v.retireAge);
    const balance = nn(v.balance);
    const rate = nn(v.rate);
    const employerMode: EpfEmployerMode = v.employerMode === "full_wage" ? "full_wage" : "fixed_share";
    const res = epfCalc({
      currentAge: nn(v.age),
      retirementAge: retireAge,
      monthlyWage: nn(v.wage),
      salaryIncreasePct: nn(v.increase),
      employeePct: nn(v.employeePct),
      employerPct: nn(v.employerPct),
      employerMode,
      currentBalance: balance,
      ratePct: rate,
    });
    if (res.years <= 0) return [insight("Retirement age must be later than the current age.", "warning")];
    const first = res.rows[0];
    const out: ResultBlock[] = [
      stat(`Corpus at ${retireAge}`, inr(res.corpus), "brand"),
      stat("Your contributions", inr(res.totalEmployee)),
      stat("Employer's EPF share", inr(res.totalEmployer)),
      stat("Interest earned", inr(res.totalInterest), "success"),
    ];
    if (first) {
      out.push(insight(`In the first year ${inr(first.employee / 12)} a month comes from salary and ${inr(first.employer / 12)} from the employer. Over ${res.years} years these, the ${inr(balance)} already in the account and ${inr(res.totalInterest)} of interest at ${fmtPct(rate)} build a corpus of ${inr(res.corpus)} at ${retireAge}.`, "brand"));
    }
    out.push(
      insight(`The employer's 12% is split: 8.33% goes to the Employees' Pension Scheme (EPS), worked out on pay up to ${inr(EPS_WAGE_CEILING)} — at most ${inr(1250)} a month — and only the rest reaches EPF. The pension (${inr(res.totalEps)} over these years) pays a monthly pension, not part of this corpus.${employerMode === "full_wage" ? ` With an employer paying 12% on the full salary, everything above the ${inr(1250)} EPS share goes to EPF.` : ""}`, "warning"),
      section("1. EPF balance year by year"),
      table(
        ["Year", "Age", "Monthly basic + DA", "Opening balance", "Your share", "Employer's share", "Interest", "Closing balance"],
        res.rows.map((r) => [`${r.year}`, `${r.age}`, inr(r.monthlyWage), inr(r.opening), inr(r.employee), inr(r.employer), inr(r.interest), inr(r.closing)]),
        true,
      ),
      note(`Contributions are credited monthly; each month's interest is ${fmtPct(rate)} ÷ 12 of the balance after that month's contribution, and the year's interest is added at the year end. Salary rises once a year. EPFO declares the rate each year — one rate is applied throughout.`),
    );
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  goalplan, multipurpose, vacation, childedu, childsip, collision, feasibility, inflation, delay, retirement,
  limitedneed, stepuptarget, siplstarget, lstarget, sipstpgoal, stpgoal, ppf, epf,
};
