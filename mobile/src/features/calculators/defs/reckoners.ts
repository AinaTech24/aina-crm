/**
 * Ready Reckoners — mirrors the web group of the same name
 * (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def.
 */

import type { CalcBody, InputSpec, ResultBlock, SchemePick } from "../types";
import { inr, fmtPct, groupIndian } from "../fmt";
import { computeReadyReckoner, displayCell, MAX_PERIODS, MAX_RATES, type ReckonerMode } from "../web/ready-reckoner";
import { stpReckonerGrid, type MonthlyStpMode, type StpScenario } from "../web/stp-comprehensive";
import { computeIncomeBridge, type CalcType, type InvestMode, type PlanningType } from "../web/income-bridge";
import { stat, section, table, insight, note, opts } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * A reckoner box (ReadyReckoner.tsx parseBox). The web skips an EMPTY box; the
 * app's number field shows 0 as empty, so 0 (or blank) is the skipped box here.
 */
const box = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The web's "Suggested schemes" picker: up to three Scheme Master picks. */
const schemeInputs = (): InputSpec[] => [
  { key: "scheme1", label: "Suggested schemes (optional)", type: "scheme", default: null },
  { key: "scheme2", label: "Suggested scheme 2 (optional)", type: "scheme", default: null, visibleIf: (v) => !!v.scheme1 || !!v.scheme2 },
  { key: "scheme3", label: "Suggested scheme 3 (optional)", type: "scheme", default: null, visibleIf: (v) => !!v.scheme2 || !!v.scheme3 },
];
/** The web joins the picked schemes with ", " and prints them under the results. */
const schemeBlocks = (v: Record<string, any>): ResultBlock[] => {
  const schemes = [v.scheme1, v.scheme2, v.scheme3]
    .map((s: SchemePick) => s?.name ?? "")
    .filter(Boolean)
    .join(", ");
  return schemes ? [section("Suggested schemes"), note(schemes)] : [];
};

/* ───────────── ReadyReckoner.tsx — the four grid reckoners ───────────── */

type ModeCopy = {
  amountLabel: string;
  gridTitle: string;
  defaults: { amount: number; rates: number[]; years: number[] };
};

/** ReadyReckoner.tsx COPY (the titles and blurbs are the catalog's). */
const COPY: Record<ReckonerMode, ModeCopy> = {
  lumpsum_fv: {
    amountLabel: "One-time investment (₹)",
    gridTitle: "Projected value of the investment",
    defaults: { amount: 500000, rates: [10, 12, 15], years: [5, 10, 15, 20, 25] },
  },
  lumpsum_need: {
    amountLabel: "Target amount (₹)",
    gridTitle: "One-time investment needed today",
    defaults: { amount: 10000000, rates: [10, 12, 15], years: [5, 10, 15, 20, 25] },
  },
  sip_fv: {
    amountLabel: "Monthly SIP (₹)",
    gridTitle: "Projected value of the SIP",
    defaults: { amount: 10000, rates: [10, 12, 15], years: [5, 10, 15, 20, 25] },
  },
  sip_need: {
    amountLabel: "Target amount (₹)",
    gridTitle: "Monthly SIP needed",
    defaults: { amount: 10000000, rates: [10, 12, 15], years: [10, 15, 20, 25, 30] },
  },
};

/**
 * ReadyReckoner.tsx `lakh`: displayCell(v, "lakh").toLocaleString("en-IN",
 * { minimumFractionDigits: 2, maximumFractionDigits: 2 }) — by hand, Indian
 * grouping, as fmt.ts does for rupees (Hermes' Intl differs by platform).
 */
export function lakh(v: number): string {
  const x = displayCell(v, "lakh");
  if (!Number.isFinite(x)) return "—";
  const [int, dec] = Math.abs(x).toFixed(2).split(".");
  return `${x < 0 ? "-" : ""}${groupIndian(int)}.${dec}`;
}

/** ReadyReckoner.tsx (computeReadyReckoner), one def per mode. */
function readyReckoner(mode: ReckonerMode): CalcBody {
  const copy = COPY[mode];
  const rateKeys = Array.from({ length: MAX_RATES }, (_, i) => `rate${i + 1}`);
  const yearKeys = Array.from({ length: MAX_PERIODS }, (_, i) => `period${i + 1}`);
  return {
    inputs: [
      { key: "amount", label: copy.amountLabel, type: "money", default: copy.defaults.amount },
      ...rateKeys.map((key, i): InputSpec => ({
        key,
        label: `Return rate ${i + 1}`,
        type: "percent",
        default: copy.defaults.rates[i] ?? 0,
        ...(i === 0 ? { section: `Return rates (up to ${MAX_RATES})` } : {}),
      })),
      ...yearKeys.map((key, i): InputSpec => ({
        key,
        label: `Period ${i + 1}`,
        type: "years",
        default: copy.defaults.years[i] ?? 0,
        ...(i === 0 ? { section: `Periods (up to ${MAX_PERIODS})` } : {}),
        ...(i === MAX_PERIODS - 1 ? { hint: "Leave a box empty to drop it. Rows and columns follow the order you type them in." } : {}),
      })),
      ...schemeInputs(),
      { key: "exact", label: "Show exact rupees", type: "toggle", default: false },
    ],
    compute: (v) => {
      const amount = nn(v.amount);
      const exact = !!v.exact;
      const result = computeReadyReckoner({
        mode,
        amount,
        ratesPct: rateKeys.map((k) => box(v[k])),
        years: yearKeys.map((k) => box(v[k])),
      });

      const isLakh = result.unit === "lakh";
      const fmt = (x: number) => (isLakh && !exact ? lakh(x) : inr(displayCell(x, "rupee")));
      const isNeed = mode === "lumpsum_need" || mode === "sip_need";
      // SIP Needed: the one-time lumpsum today for the same target, beside the
      // SIP grid — in ₹ lakh like the Lumpsum Needed reckoner, unless "exact rupees".
      const lumpsumCells = result.lumpsumCells;
      const fmtLumpsum = (x: number) => (exact ? inr(displayCell(x, "rupee")) : lakh(x));
      const lumpsumRows = lumpsumCells
        ? result.rates.map((r, ri) => [`${r.toFixed(2)}%`, ...lumpsumCells[ri].map((x) => fmtLumpsum(x))])
        : null;
      const sampleLumpsum = lumpsumCells && result.valid ? lumpsumCells[0][result.years.length - 1] : NaN;

      const head = ["Return (p.a.)", ...result.years.map((y) => `${y} yrs`)];
      // The web maps result.cells[ri] even when the input is invalid (cells = [])
      // and throws on a zero amount with rates filled in; the app guards it.
      const rows = result.valid ? result.rates.map((r, ri) => [`${r.toFixed(2)}%`, ...result.cells[ri].map((x) => fmt(x))]) : [];

      // One worked reading of the grid for the insight line: first rate, longest period.
      const firstRate = result.rates[0];
      const lastYi = result.years.length - 1;
      const lastYear = result.years[lastYi];
      const sample = result.valid ? result.cells[0][lastYi] : NaN;

      const out: ResultBlock[] = [];
      if (!result.valid) {
        out.push(insight("Enter an amount above zero, at least one return rate and at least one period.", "warning"));
      } else {
        out.push(
          section(`1. ${copy.gridTitle} — ${isNeed ? "target" : mode === "sip_fv" ? "monthly SIP" : "invested"} ${inr(amount)}`),
          table(head, rows),
          note(
            (isLakh && !exact ? "Figures in ₹ lakh (1 lakh = ₹1,00,000), rounded to 2 decimals." : "Figures in ₹, rounded to the rupee.") +
              (mode === "sip_fv" || mode === "sip_need"
                ? " SIP paid at the start of every month; the annual return is converted to an equivalent monthly rate."
                : " Returns compound once a year."),
          ),
        );
        if (Number.isFinite(sample)) {
          const text =
            mode === "lumpsum_fv"
              ? `At ${fmtPct(firstRate)} a year, ${inr(amount)} invested once could become about ${inr(sample)} in ${lastYear} years.`
              : mode === "sip_fv"
                ? `At ${fmtPct(firstRate)} a year, a ${inr(amount)} monthly SIP for ${lastYear} years could grow to about ${inr(sample)}, against ${inr(amount * Math.round(lastYear * 12))} paid in.`
                : mode === "lumpsum_need"
                  ? `To have ${inr(amount)} in ${lastYear} years at ${fmtPct(firstRate)} a year, about ${inr(sample)} invested today is enough — the longer the runway, the smaller the cheque.`
                  : `To build ${inr(amount)} in ${lastYear} years at ${fmtPct(firstRate)} a year, a monthly SIP of about ${inr(sample)} is needed — starting earlier lowers it sharply.` +
                    (Number.isFinite(sampleLumpsum) ? ` Or invest a one-time lumpsum of about ${inr(sampleLumpsum)} today and leave it to grow.` : "");
          out.push(insight(text, "brand"));
        }
        if (lumpsumRows) {
          out.push(
            section(`2. Or a one-time lumpsum needed today — target ${inr(amount)}`),
            table(head, lumpsumRows),
            note(
              `${exact ? "Figures in ₹, rounded to the rupee." : "Figures in ₹ lakh (1 lakh = ₹1,00,000), rounded to 2 decimals."} Invested once today at the same return and left for the same period; returns compound once a year.`,
            ),
          );
        }
        // The web's last section ("How the value builds with time") is a chart only.
      }
      out.push(...schemeBlocks(v));
      return out;
    },
  };
}

/* ───────────── StpParts.tsx StpReckoner — the two STP reckoners ───────────── */

/** StpParts.tsx describeMonthlyMode, copied verbatim (presentation only). */
function describeMonthlyMode(mode: MonthlyStpMode, amount: number, pct: number): string {
  if (mode === "appreciation") return "Capital appreciation (the debt fund's monthly gain)";
  if (mode === "fixedPct") return `${pct}% of the initial investment every month`;
  return `${inr(amount)} every month`;
}

/** StpParts.tsx `lakh` — plain toFixed, no grouping (unlike ReadyReckoner's). */
const stpLakh = (n: number) => (Number.isFinite(n) ? (n / 1e5).toFixed(2) : "—");

const STP_SCENARIOS: StpScenario[] = [
  { debtPct: 5, equityPct: 10 },
  { debtPct: 6, equityPct: 12 },
  { debtPct: 7, equityPct: 15 },
];
const STP_YEARS = [5, 10, 15, 20, 25];

/** StpFvReckoner.tsx / StpNeedReckoner.tsx → StpParts.tsx StpReckoner (stpReckonerGrid). */
function stpReckoner(kind: "fv" | "need"): CalcBody {
  return {
    inputs: [
      { key: "amount", label: kind === "fv" ? "Initial investment in the debt fund (₹)" : "Target amount (₹)", type: "money", default: 5_000_000 },
      // MonthlyModeFields with allowAmount={false}: a fixed transfer is "% of initial".
      { key: "transfer", label: "Monthly transfer", type: "segmented", default: "appreciation", options: opts([["appreciation", "Capital appreciation"], ["fixed", "Fixed transfer"]]) },
      { key: "pct", label: "Transfer / month (% of initial)", type: "percent", default: 1, visibleIf: (v) => v.transfer === "fixed" },
      ...STP_SCENARIOS.flatMap((s, i): InputSpec[] => [
        { key: `debt${i + 1}`, label: `Debt ${i + 1}`, type: "percent", default: s.debtPct, ...(i === 0 ? { section: "Return scenarios (debt fund | equity fund, % p.a.)" } : {}) },
        { key: `equity${i + 1}`, label: `Equity ${i + 1}`, type: "percent", default: s.equityPct },
      ]),
      ...STP_YEARS.map((y, i): InputSpec => ({
        key: `period${i + 1}`, label: `Period ${i + 1}`, type: "years", default: y, ...(i === 0 ? { section: "STP periods (years)" } : {}),
      })),
    ],
    compute: (v) => {
      const amount = nn(v.amount);
      const mode: MonthlyStpMode = v.transfer === "fixed" ? "fixedPct" : "appreciation";
      const pct = nn(v.pct);
      const scenarios: StpScenario[] = STP_SCENARIOS.map((_, i) => ({ debtPct: nn(v[`debt${i + 1}`]), equityPct: nn(v[`equity${i + 1}`]) }));
      const years = STP_YEARS.map((_, i) => Math.round(nn(v[`period${i + 1}`])));
      const grid = stpReckonerGrid({
        kind, amount, scenarios, years, mode: mode === "fixedPct" ? "fixedPct" : "appreciation", fixedPct: pct,
      });
      const best = grid.length > 0 && grid[0].length > 0 ? grid[grid.length - 1][grid[0].length - 1] : NaN;
      const last = scenarios[scenarios.length - 1];
      const lastYear = years[years.length - 1];

      const out: ResultBlock[] = [
        section(kind === "fv" ? "1. Future value of the initial investment (₹ lakh)" : "1. Initial investment required (₹ lakh)"),
        table(
          ["Debt | equity return", ...years.map((y) => `${y} yrs`)],
          scenarios.map((s, i) => [`${s.debtPct}% | ${s.equityPct}%`, ...grid[i].map((x) => stpLakh(x))]),
        ),
      ];
      if (Number.isFinite(best)) {
        out.push(insight(
          kind === "fv"
            ? `${inr(amount)} parked in a ${last.debtPct}% debt fund and moved into a ${last.equityPct}% equity fund (${describeMonthlyMode(mode, 0, pct).toLowerCase()}) could grow to ${inr(best)} in ${lastYear} years.`
            : `At ${last.debtPct}% | ${last.equityPct}% over ${lastYear} years, about ${inr(best)} placed today reaches ${inr(amount)}.`,
          "brand",
        ));
      }
      out.push(note("* Illustration only. Transfers are made at each month end after both funds earn that month's return (effective monthly rate); a fixed transfer stops once the debt fund holds less than one transfer. Not investment advice."));
      return out;
    },
  };
}

/* ───────────── SipSwpReckoner.tsx — SIP–SWP Ready Reckoner ───────────── */

const usesSipOf = (v: Record<string, any>) => v.investMode === "sip" || v.investMode === "lumpsum_sip" || v.investMode === "salary";
const isReverseOf = (v: Record<string, any>) => v.calcType === "investment_need";

/**
 * SipSwpReckoner.tsx (computeIncomeBridge). The web labels one age field
 * "Retirement age (SWP starts)" or "SWP start age" by the plan; a label here is
 * fixed, so each plan has its own field (both default 60).
 */
const sipswp: CalcBody = {
  inputs: [
    { key: "calcType", label: "Solve for", type: "segmented", default: "monthly_swp", options: opts([["monthly_swp", "Monthly SWP"], ["investment_need", "Investment needed"]]) },
    { key: "investMode", label: "Invest through", type: "select", default: "salary", options: opts([["sip", "SIP"], ["lumpsum", "Lumpsum"], ["lumpsum_sip", "Lumpsum + SIP"], ["salary", "Salary-linked SIP"]]) },
    { key: "planningType", label: "Plan", type: "segmented", default: "retirement", options: opts([["retirement", "Retirement"], ["invest_now_withdraw_later", "SIP now, SWP later"]]) },

    { key: "startAge", label: "Investment start age", type: "years", default: 35, section: "Building the corpus" },
    { key: "monthlySalary", label: "Monthly salary (₹)", type: "money", default: 100000, visibleIf: (v) => v.investMode === "salary" },
    { key: "savingsPct", label: "SIP as % of salary", type: "percent", default: 25, visibleIf: (v) => v.investMode === "salary" && !isReverseOf(v) },
    { key: "salaryGrowthPct", label: "Salary rise per year (%)", type: "percent", default: 8, visibleIf: (v) => v.investMode === "salary" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 25000, visibleIf: (v) => (v.investMode === "sip" || v.investMode === "lumpsum_sip") && !isReverseOf(v) },
    { key: "topUpPct", label: "SIP top-up every year (%)", type: "percent", default: 5, visibleIf: (v) => v.investMode === "sip" || v.investMode === "lumpsum_sip" },
    {
      key: "lumpsum", label: "Lumpsum today (₹)", type: "money", default: 1000000,
      visibleIf: (v) => (v.investMode === "lumpsum" || v.investMode === "lumpsum_sip") && (v.investMode === "lumpsum_sip" || !isReverseOf(v)),
    },
    { key: "sipTillAge", label: "SIP till age", type: "years", default: 50, visibleIf: usesSipOf },
    { key: "retirementAge", label: "Retirement age (SWP starts)", type: "years", default: 60, visibleIf: (v) => v.planningType !== "invest_now_withdraw_later" },
    { key: "swpStartAge", label: "SWP start age", type: "years", default: 60, visibleIf: (v) => v.planningType === "invest_now_withdraw_later" },
    { key: "accumReturnPct", label: "Return while building (%)", type: "percent", default: 12 },

    { key: "swpTillAge", label: "SWP till age", type: "years", default: 80, section: "Drawing the income" },
    { key: "distReturnPct", label: "Return while withdrawing (%)", type: "percent", default: 8 },
    { key: "distInflationPct", label: "Inflation while withdrawing (%)", type: "percent", default: 5 },
    { key: "desiredMonthlySwp", label: "Monthly SWP wanted (₹, first month)", type: "money", default: 300000, visibleIf: isReverseOf },
    { key: "endBalance", label: "Balance to leave at the end (₹)", type: "money", default: 10000000 },
  ],
  compute: (v) => {
    const calcType = (v.calcType === "investment_need" ? "investment_need" : "monthly_swp") as CalcType;
    const investMode = (["sip", "lumpsum", "lumpsum_sip", "salary"].includes(v.investMode) ? v.investMode : "salary") as InvestMode;
    const planningType = (v.planningType === "invest_now_withdraw_later" ? "invest_now_withdraw_later" : "retirement") as PlanningType;
    const startAge = nn(v.startAge);
    const sipTillAge = nn(v.sipTillAge);
    const retirementAge = nn(planningType === "retirement" ? v.retirementAge : v.swpStartAge);
    const swpTillAge = nn(v.swpTillAge);
    const monthlySalary = nn(v.monthlySalary);
    const savingsPct = nn(v.savingsPct);
    const salaryGrowthPct = nn(v.salaryGrowthPct);
    const accumReturnPct = nn(v.accumReturnPct);
    const distInflationPct = nn(v.distInflationPct);

    const result = computeIncomeBridge({
      calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge,
      monthlySip: nn(v.monthlySip), topUpPct: nn(v.topUpPct), lumpsum: nn(v.lumpsum), monthlySalary, savingsPct, salaryGrowthPct, accumReturnPct,
      distReturnPct: nn(v.distReturnPct), distInflationPct, endBalance: nn(v.endBalance), desiredMonthlySwp: nn(v.desiredMonthlySwp),
    });

    const isSalary = investMode === "salary";
    const usesSip = investMode === "sip" || investMode === "lumpsum_sip" || isSalary;
    const isReverse = calcType === "investment_need";

    const ageProblems: string[] = [];
    if (usesSip && sipTillAge <= startAge) ageProblems.push("the SIP must end after the start age");
    if (usesSip && retirementAge < sipTillAge) ageProblems.push("withdrawals cannot start before the SIP ends");
    if (swpTillAge <= retirementAge) ageProblems.push("the SWP must end after it starts");
    const waitYears = usesSip ? Math.max(0, retirementAge - sipTillAge) : Math.max(0, retirementAge - startAge);

    const out: ResultBlock[] = [];
    // The web prints this line under the end-balance field.
    if (!isReverse) out.push(note(`Max ${inr(result.maxEndBalance)} — what the corpus grows to if nothing is withdrawn.`));
    if (ageProblems.length > 0) out.push(insight(`Check the ages: ${ageProblems.join("; ")}.`, "danger"));
    if (result.warning) out.push(insight(result.warning, "danger"));

    out.push(stat(isReverse ? "Corpus needed at SWP start" : "Total accumulated", inr(result.corpus), "warning"));
    if (isReverse) {
      if (investMode === "lumpsum") {
        out.push(stat("Lumpsum needed today", inr(result.requiredLumpsum ?? NaN), "brand"));
      } else {
        out.push(
          stat(isSalary ? "Monthly SIP needed (first year)" : "Monthly SIP needed", inr(result.requiredMonthlySip ?? NaN), "brand"),
          stat(investMode === "lumpsum_sip" ? "Or extra lumpsum today, no SIP" : "Or one-time lumpsum today", inr(result.lumpsumInsteadOfSip ?? NaN)),
        );
      }
    } else {
      out.push(stat(distInflationPct > 0 ? "Monthly SWP (first month)" : "Monthly SWP", inr(result.monthlySwp), "brand"));
    }
    if (isReverse && isSalary && result.requiredSavingsPct != null) {
      out.push(stat("SIP as % of salary needed", `${result.requiredSavingsPct.toFixed(1)}%`));
    }
    out.push(
      stat("Total investment", inr(result.totalInvested)),
      stat("Total withdrawal", inr(result.totalWithdrawn), "success"),
      stat("Balance at the end", inr(result.endBalanceActual)),
    );

    let text =
      (isSalary
        ? `${fmtPct(isReverse ? result.requiredSavingsPct ?? 0 : savingsPct)} of a ${inr(monthlySalary)} salary rising ${fmtPct(salaryGrowthPct)} a year`
        : "The plan") +
      ` builds ${inr(result.corpus)} by age ${retirementAge}` +
      (waitYears > 0 ? ` (including ${waitYears} years of waiting with no new money)` : "") +
      `. That pays ${inr(result.monthlySwp)} in the first month` +
      (distInflationPct > 0 ? `, rising every month to ${inr(result.lastMonthlySwp)}` : "") +
      `, until age ${swpTillAge}, and leaves ${inr(result.endBalanceActual)}.`;
    if (isReverse && investMode !== "lumpsum") {
      text +=
        ` Instead of the ${inr(result.requiredMonthlySip ?? NaN)}/month ${isSalary ? "salary-linked SIP" : "SIP"}, ` +
        `${investMode === "lumpsum_sip" ? "one more lumpsum of" : "a one-time lumpsum of"} ` +
        `${inr(result.lumpsumInsteadOfSip ?? NaN)} invested today at ${fmtPct(accumReturnPct)} builds the same corpus.`;
    }
    out.push(insight(text, "brand"));

    if (result.accSchedule.length > 0) {
      out.push(
        section("1. Building the corpus — year by year"),
        table(
          ["Age", "Invested that year", "Year-end value"],
          result.accSchedule.map((r) => [`${r.age}`, r.invested > 0 ? inr(r.invested) : "—", inr(r.value)]),
          true,
        ),
      );
    }
    if (result.schedule.length > 0) {
      out.push(
        section("2. Drawing the income — year by year"),
        table(
          ["Age", "Monthly SWP (first month)", "Monthly SWP (average)", "Withdrawn that year", "Year-end balance"],
          result.schedule.map((r) => [
            `${r.age}`,
            inr(r.monthlyWithdrawalThatYear),
            inr(r.avgMonthlyWithdrawal),
            inr(r.withdrawnThisYear),
            inr(r.endCorpus),
          ]),
          true,
        ),
      );
    }
    out.push(note("SIP paid at the start of each month and raised once a year; withdrawals taken on the last day of each month and raised every month with inflation · effective monthly rates. Illustration only; returns are not guaranteed."));
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  lsreckoner: readyReckoner("lumpsum_fv"),
  lsneedreckoner: readyReckoner("lumpsum_need"),
  sipreckoner: readyReckoner("sip_fv"),
  sipneedreckoner: readyReckoner("sip_need"),
  stpreckoner: stpReckoner("fv"),
  stpneedreckoner: stpReckoner("need"),
  sipswp,
};
