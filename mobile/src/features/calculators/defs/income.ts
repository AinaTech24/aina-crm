/**
 * Income & Withdrawal (SWP/STP) — mirrors the web group of the same name
 * (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def.
 *
 * Where the web relabels one field as another input changes (e.g. "Monthly SIP
 * (₹)" vs "Initial investment (₹)" on one state), the def lists one spec per
 * label under the SAME key with complementary `visibleIf`s — so the value is
 * shared exactly as the web's single state is. Text the web prints beside an
 * input from a live figure (a hint that carries a number) is given as a note
 * at the top of the results, since an input hint here is static.
 */

import type { CalcBody, InputSpec, ResultBlock, Tone } from "../types";
import { inr, fmtPct } from "../fmt";
import {
  computeIncomeBridge, type CalcType as BridgeCalcType, type InvestMode as BridgeInvestMode,
  type PlanningType as BridgePlanningType,
} from "../web/income-bridge";
import { computeSwpPeriodic, type SwpInvestMode } from "../web/swp-periodic";
import { computeSwpEndPeriod, type InvestmentType as SwpEndInvestType, type SwpMode as SwpEndMode } from "../web/swp-end-period";
import {
  computeSwpComprehensive, weightedAvg, FREQ_LABEL as SWPC_FREQ_LABEL,
  type InvestMode as SwpcInvestMode, type Frequency as SwpcFrequency, type IncrementMode,
} from "../web/swp-comprehensive";
import {
  computeStpComprehensive, computeMonthlyStp, STP_FREQUENCIES,
  type StpComprehensiveResult, type StpFixedBasis, type StpFrequency, type StpTransferMode, type MonthlyStpMode,
} from "../web/stp-comprehensive";
import { opmHouseStrategy } from "../web/goal-planning-calc";
import { swpFromLumpsum, lumpsumForSwp, sipForSwp, type SwpTax, type SwpYearRow } from "../web/swp-target";
import { computeProsperityMultiplier } from "../web/prosperity-multiplier";
import { computeSwpRebalance, type RebalanceFrequency } from "../web/swp-rebalance";
import { stat, section, table, insight, note, opts, TONE } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const own = (o: object, k: unknown): boolean => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
/** `k` when it is one of `o`'s keys, else `dflt` (a select / segmented value). */
const pick = <O extends Record<string, unknown>>(o: O, k: unknown, dflt: keyof O & string): keyof O & string =>
  own(o, k) ? (k as keyof O & string) : dflt;

/* ───────────────────────── bridge ───────────────────────── */

const BRIDGE_MODES: Record<BridgeInvestMode, string> = {
  sip: "SIP", lumpsum: "Lumpsum", lumpsum_sip: "Lumpsum + SIP", salary: "Salary %",
};

/** IncomeBridgePlanner.tsx — Income Bridge Planner · SIP → SWP (computeIncomeBridge).
 *  The "Objective" field is skipped with the client name: the web prints it
 *  only on the "Prepared for" line. */
const bridge: CalcBody = {
  inputs: [
    { key: "calcType", label: "I want to find", type: "segmented", default: "monthly_swp", options: opts([["monthly_swp", "How much monthly income?"], ["investment_need", "How much to invest?"]]) },
    { key: "investMode", label: "Build my corpus with", type: "select", default: "sip", options: opts(Object.entries(BRIDGE_MODES)) },
    { key: "planningType", label: "Planning type", type: "segmented", default: "retirement", options: opts([["retirement", "Retirement Planning"], ["invest_now_withdraw_later", "Invest Now, Withdraw Later"]]) },
    { key: "startAge", label: "Current age (investment start)", type: "years", default: 35, section: "① Accumulation — build the corpus" },
    { key: "sipTillAge", label: "SIP till age", type: "years", default: 60, visibleIf: (v) => v.investMode !== "lumpsum" },
    { key: "retirementAge", label: "SWP starts at age", type: "years", default: 60 },
    { key: "accumReturnPct", label: "Return — accumulation (% p.a.)", type: "percent", default: 12 },
    { key: "monthlySalary", label: "Monthly salary (₹)", type: "money", default: 150000, visibleIf: (v) => v.investMode === "salary" },
    { key: "savingsPct", label: "Save / invest (% of salary)", type: "percent", default: 20, visibleIf: (v) => v.investMode === "salary" },
    { key: "salaryGrowthPct", label: "Annual salary growth (%)", type: "percent", default: 8, visibleIf: (v) => v.investMode === "salary" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 10000, visibleIf: (v) => (v.investMode === "sip" || v.investMode === "lumpsum_sip") && v.calcType !== "investment_need" },
    { key: "topUpPct", label: "SIP top-up every year (%)", type: "percent", default: 0, visibleIf: (v) => v.investMode === "sip" || v.investMode === "lumpsum_sip" },
    { key: "lumpsum", label: "Lumpsum today (₹)", type: "money", default: 1000000, visibleIf: (v) => v.investMode === "lumpsum" || v.investMode === "lumpsum_sip" },
    { key: "swpTillAge", label: "SWP till age", type: "years", default: 85, section: "② Distribution — draw the income" },
    { key: "distReturnPct", label: "Return — distribution (% p.a.)", type: "percent", default: 9 },
    { key: "distInflationPct", label: "Inflation — distribution (%)", type: "percent", default: 0 },
    { key: "desiredMonthlySwp", label: "Desired monthly SWP (₹)", type: "money", default: 50000, visibleIf: (v) => v.calcType === "investment_need" },
    { key: "endBalance", label: "Balance to leave at end of SWP (₹)", type: "money", default: 10000000 },
    { key: "useS2", label: "Compare scenario 2", type: "toggle", default: false },
    { key: "accum2", label: "Scenario 2 — accumulation (%)", type: "percent", default: 10, visibleIf: (v) => !!v.useS2 },
    { key: "dist2", label: "Scenario 2 — distribution (%)", type: "percent", default: 8, visibleIf: (v) => !!v.useS2 },
  ],
  compute: (v) => {
    const calcType: BridgeCalcType = v.calcType === "investment_need" ? "investment_need" : "monthly_swp";
    const investMode = pick(BRIDGE_MODES, v.investMode, "sip");
    const planningType: BridgePlanningType = v.planningType === "invest_now_withdraw_later" ? "invest_now_withdraw_later" : "retirement";
    const startAge = nn(v.startAge);
    const sipTillAge = nn(v.sipTillAge);
    const retirementAge = nn(v.retirementAge);
    const accumReturnPct = nn(v.accumReturnPct);
    const distInflationPct = nn(v.distInflationPct);
    const lumpsum = nn(v.lumpsum);
    const common = {
      calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge: nn(v.swpTillAge),
      monthlySip: nn(v.monthlySip), topUpPct: nn(v.topUpPct), lumpsum, monthlySalary: nn(v.monthlySalary),
      savingsPct: nn(v.savingsPct), salaryGrowthPct: nn(v.salaryGrowthPct), distInflationPct,
      endBalance: nn(v.endBalance), desiredMonthlySwp: nn(v.desiredMonthlySwp),
    };
    const runS = (accum: number, dist: number) => ({ accum, dist, result: computeIncomeBridge({ ...common, accumReturnPct: accum, distReturnPct: dist }) });
    const scenarios = [runS(accumReturnPct, nn(v.distReturnPct)), ...(v.useS2 ? [runS(nn(v.accum2), nn(v.dist2))] : [])];
    const result = scenarios[0].result;
    const tag = (s: (typeof scenarios)[number]) => (scenarios.length > 1 ? ` @ ${fmtPct(s.accum)} / ${fmtPct(s.dist)}` : "");

    const usesSip = investMode === "sip" || investMode === "lumpsum_sip";
    const isSalary = investMode === "salary";
    const isReverse = calcType === "investment_need";
    const showLumpsumAlt = isReverse && investMode !== "lumpsum";
    const lumpsumAltLabel = investMode === "lumpsum_sip" ? "Or extra lumpsum today, no SIP" : "Or one-time lumpsum today";

    // The two hints the web prints under the inputs.
    const out: ResultBlock[] = [
      note(`Deferment: the corpus stays invested from the SIP's last month until the SWP starts (${Math.max(0, retirementAge - (usesSip || isSalary ? sipTillAge : startAge))} yrs now).${isReverse ? ` In “How much to invest?” mode the ${investMode === "lumpsum" ? "lumpsum" : "monthly SIP"} is calculated for you.` : ""}`),
    ];
    if (!isReverse) out.push(note(`Balance to leave at end of SWP: Max — ${inr(result.maxEndBalance)} (if you withdraw nothing). Leave ₹0 to spend it all down.`));

    for (const s of scenarios) if (s.result.warning) out.push(insight(`${s.result.warning}${tag(s)}`, TONE.rose));

    for (const s of scenarios) {
      const r = s.result;
      if (isReverse) {
        out.push(stat(`Corpus needed at SWP start${tag(s)}`, inr(r.requiredCorpus ?? r.corpus), TONE.amber));
        if (investMode === "lumpsum") out.push(stat(`Lumpsum to invest today${tag(s)}`, inr(r.requiredLumpsum ?? 0), TONE.emerald));
        else out.push(stat(`${isSalary ? "Monthly investment needed" : "Monthly SIP needed"}${tag(s)}`, inr(r.requiredMonthlySip ?? 0), TONE.emerald));
        if (showLumpsumAlt) out.push(stat(`${lumpsumAltLabel}${tag(s)}`, inr(r.lumpsumInsteadOfSip ?? 0)));
        out.push(
          stat("Monthly SWP (first month)", inr(r.monthlySwp)),
          stat(`Total withdrawal${tag(s)}`, inr(r.totalWithdrawn), TONE.emerald),
        );
      } else {
        out.push(
          stat(`Accumulated corpus${tag(s)}`, inr(r.corpus), TONE.amber),
          stat(`${distInflationPct > 0 ? "Monthly SWP (first month)" : "Monthly SWP"}${tag(s)}`, inr(r.monthlySwp), TONE.emerald),
          stat(`Total withdrawal${tag(s)}`, inr(r.totalWithdrawn), TONE.emerald),
          stat("Balance left at end", inr(r.endBalanceActual)),
        );
      }
    }

    if (showLumpsumAlt) {
      out.push(insight(
        `A corpus of ${inr(result.requiredCorpus ?? result.corpus)} at age ${retirementAge} needs ${isSalary ? "a monthly investment" : "a SIP"} of ${inr(result.requiredMonthlySip ?? 0)}/month to start${investMode === "lumpsum_sip" ? ` beside the ${inr(lumpsum)} lumpsum — or, instead of the SIP, one more lumpsum of` : " — or a one-time lumpsum of"} ${inr(result.lumpsumInsteadOfSip ?? 0)} invested today at ${fmtPct(accumReturnPct)} and left to grow.`,
        TONE.cyan,
      ));
    }

    out.push(
      stat("Total invested", inr(result.totalInvested)),
      stat("Wealth gained (accumulation)", inr(result.wealthGain)),
      stat("First → last monthly SWP", `${inr(result.monthlySwp)} → ${inr(result.lastMonthlySwp)}`),
      isSalary && isReverse && result.requiredSavingsPct != null
        ? stat("Required savings rate", `${result.requiredSavingsPct.toFixed(1)}% of salary`)
        : stat("Phases", `${result.sipYears + result.holdYears}y build · ${result.distYears}y draw`),
    );

    if (result.accSchedule.length > 0) {
      out.push(
        section("1. Accumulation — annual investment and year-end value"),
        table(
          ["Age", "Annual investment", ...scenarios.map((s) => `Year-end value${tag(s)}`)],
          result.accSchedule.map((r, i) => [
            `${r.age}`,
            r.invested > 0 ? inr(r.invested) : "—",
            ...scenarios.map((s) => inr(s.result.accSchedule[i]?.value ?? NaN)),
          ]),
          true,
        ),
      );
    }
    if (result.schedule.length > 0) {
      out.push(
        section("2. Distribution — monthly withdrawal and year-end value"),
        table(
          ["Age", ...scenarios.flatMap((s) => [`Monthly SWP (avg)${tag(s)}`, `Year-end value${tag(s)}`]), `Withdrawn that year${tag(scenarios[0])}`],
          result.schedule.map((row, i) => [
            `${row.age}`,
            ...scenarios.flatMap((s) => {
              const r = s.result.schedule[i];
              return [inr(r?.avgMonthlyWithdrawal ?? NaN), inr(r?.endCorpus ?? NaN)];
            }),
            inr(row.withdrawnThisYear),
          ]),
          true,
        ),
      );
    }
    out.push(note("Illustration only. Figures assume constant returns and inflation; actual results vary with market performance. SIP paid at the start of each month; withdrawals taken at month end and raised every month with inflation · effective monthly rate · the distribution table shows each year's average monthly withdrawal. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── swpperiodic ───────────────────────── */

const PERIODIC_MODES: Record<SwpInvestMode, string> = {
  lumpsum: "Lumpsum", annual_lumpsum: "Annual Lumpsum", sip: "SIP", lumpsum_sip: "Lumpsum + SIP",
};

/** SwpPeriodicPlanner.tsx — SWP Periodic Withdrawal Planner (computeSwpPeriodic).
 *  The "Custom calculator header" option (it only retitles the card) is not offered. */
const swpperiodic: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 40 },
    { key: "investMode", label: "Investment mode", type: "select", default: "sip", options: opts(Object.entries(PERIODIC_MODES)) },
    { key: "initialInvestment", label: "Initial investment (₹)", type: "money", default: 1000000, visibleIf: (v) => v.investMode === "lumpsum" || v.investMode === "lumpsum_sip" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 10000, visibleIf: (v) => v.investMode === "sip" || v.investMode === "lumpsum_sip" },
    { key: "sipYears", label: "SIP period (years)", type: "years", default: 20, visibleIf: (v) => v.investMode === "sip" || v.investMode === "lumpsum_sip" },
    { key: "annualAmount", label: "Annual investment (₹)", type: "money", default: 120000, visibleIf: (v) => v.investMode === "annual_lumpsum" },
    { key: "annualYears", label: "Invest for (years)", type: "years", default: 20, visibleIf: (v) => v.investMode === "annual_lumpsum" },
    { key: "allocDebt", label: "Debt %", type: "percent", default: 0, section: "Asset allocation" },
    { key: "allocHybrid", label: "Hybrid %", type: "percent", default: 0 },
    { key: "allocEquity", label: "Equity %", type: "percent", default: 100 },
    { key: "retDebt", label: "Debt %", type: "percent", default: 7, section: "Assumed return per class" },
    { key: "retHybrid", label: "Hybrid %", type: "percent", default: 9 },
    { key: "retEquity", label: "Equity %", type: "percent", default: 12 },
    { key: "defermentRequired", label: "Deferment required?", type: "toggle", default: false },
    { key: "defermentPeriodYears", label: "Deferment period (years)", type: "years", default: 5, visibleIf: (v) => !!v.defermentRequired },
    { key: "distributionReturnPct", label: "Return during distribution (%)", type: "percent", default: 8, visibleIf: (v) => !!v.defermentRequired },
    { key: "withdrawalIntervalYears", label: "Every N years", type: "years", default: 2, section: "Periodic withdrawals" },
    { key: "numInstallments", label: "No. of installments", type: "int", default: 10 },
    { key: "eachWithdrawalAmount", label: "Each withdrawal (₹)", type: "money", default: 100000 },
  ],
  compute: (v) => {
    const currentAge = nn(v.currentAge);
    const withdrawalIntervalYears = nn(v.withdrawalIntervalYears);
    const eachWithdrawalAmount = nn(v.eachWithdrawalAmount);
    const alloc = { debt: nn(v.allocDebt), hybrid: nn(v.allocHybrid), equity: nn(v.allocEquity) };
    const result = computeSwpPeriodic({
      currentAge,
      investMode: pick(PERIODIC_MODES, v.investMode, "sip"),
      initialInvestment: nn(v.initialInvestment),
      monthlySip: nn(v.monthlySip),
      sipYears: nn(v.sipYears),
      annualAmount: nn(v.annualAmount),
      annualYears: nn(v.annualYears),
      allocation: alloc,
      returns: { debt: nn(v.retDebt), hybrid: nn(v.retHybrid), equity: nn(v.retEquity) },
      defermentRequired: !!v.defermentRequired,
      distributionReturnPct: nn(v.distributionReturnPct),
      defermentPeriodYears: nn(v.defermentPeriodYears),
      withdrawalIntervalYears,
      numInstallments: nn(v.numInstallments),
      eachWithdrawalAmount,
    });
    const allocTotal = alloc.debt + alloc.hybrid + alloc.equity;
    const depleted = result.corpusDepleted;

    const out: ResultBlock[] = [
      // The web prints these two figures in the headers of the allocation boxes.
      note(`Asset allocation: Total ${allocTotal}% · Assumed return per class: Avg ${result.averageReturnPct.toFixed(2)}%`),
      stat(`Each withdrawal (every ${withdrawalIntervalYears}y)`, inr(eachWithdrawalAmount), TONE.amber),
      stat(depleted ? `Total withdrawn (of ${inr(result.plannedPeriodicWithdrawal)})` : "Total periodic withdrawal", inr(result.totalPeriodicWithdrawal), depleted ? TONE.rose : TONE.amber),
      stat("Total invested", inr(result.totalInvested)),
      stat("End value", inr(result.endValue), depleted ? TONE.rose : TONE.emerald),
    ];
    if (depleted) {
      out.push(insight(`⚠️ The corpus runs out in year ${result.depletedYear}, before all withdrawals are made. Reduce the withdrawal amount, lower the number of installments, or invest more.`, TONE.rose));
    }
    if (result.schedule.length > 0) {
      out.push(
        section(`Projected periodic withdrawal & fund value (${result.schedule.length} years)`),
        table(
          [currentAge > 0 ? "Age" : "Year", "Annual investment", "Withdrawal", "Fund value (year end)"],
          result.schedule.map((row) => [
            `${row.age ?? row.year}`,
            row.annualInvestment > 0 ? inr(row.annualInvestment) : "—",
            row.withdrawalAmount > 0 ? inr(row.withdrawalAmount) : inr(0),
            inr(row.fundValueEndOfYear),
          ]),
        ),
      );
    }
    out.push(note("* Illustration only, on the assumptions you enter. The year's SIP earns its year-end value at the assumed return; withdrawals are taken at year end. Actual results vary with market performance. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── swpend ───────────────────────── */

/** SwpEndPeriodCalculator.tsx — SWP End Period Calculator (computeSwpEndPeriod). */
const swpend: CalcBody = {
  inputs: [
    { key: "investmentType", label: "Investment type", type: "segmented", default: "sip", options: opts([["lumpsum", "Lumpsum"], ["sip", "Monthly SIP"]]) },
    // One web field, relabelled by the investment type.
    { key: "initialInvestment", label: "Monthly SIP (₹)", type: "money", default: 25000, visibleIf: (v) => v.investmentType !== "lumpsum" },
    { key: "initialInvestment", label: "Initial investment (₹)", type: "money", default: 25000, visibleIf: (v) => v.investmentType === "lumpsum" },
    { key: "defermentRequired", label: "Deferment before SWP?", type: "toggle", default: true, visibleIf: (v) => v.investmentType === "lumpsum" },
    { key: "defermentYears", label: "SIP period (yrs)", type: "years", default: 20, visibleIf: (v) => v.investmentType !== "lumpsum" },
    { key: "defermentYears", label: "Deferment period (yrs)", type: "years", default: 20, visibleIf: (v) => v.investmentType === "lumpsum" && !!v.defermentRequired },
    { key: "accumulationRatePct", label: "Return during SIP/deferment (%)", type: "percent", default: 12, visibleIf: (v) => v.investmentType !== "lumpsum" || !!v.defermentRequired },
    { key: "swpRatePct", label: "Return during SWP (%)", type: "percent", default: 9 },
    { key: "swpMode", label: "Monthly SWP required", type: "segmented", default: "amount", options: opts([["amount", "In amount"], ["percentage", "In percentage"]]) },
    { key: "swpAmount", label: "Monthly SWP (₹)", type: "money", default: 200000, visibleIf: (v) => v.swpMode !== "percentage" },
    { key: "swpPercentage", label: "Annual withdrawal (% of corpus)", type: "percent", default: 6, visibleIf: (v) => v.swpMode === "percentage" },
    { key: "includeInflation", label: "Inflation-adjusted withdrawal", type: "toggle", default: false },
    { key: "inflationPct", label: "Expected inflation (%)", type: "percent", default: 6, visibleIf: (v) => !!v.includeInflation },
  ],
  compute: (v) => {
    const investmentType: SwpEndInvestType = v.investmentType === "lumpsum" ? "lumpsum" : "sip";
    const isSip = investmentType === "sip";
    const swpMode: SwpEndMode = v.swpMode === "percentage" ? "percentage" : "amount";
    const swpRatePct = nn(v.swpRatePct);
    const includeInflation = !!v.includeInflation;
    const result = computeSwpEndPeriod({
      investmentType,
      initialInvestment: nn(v.initialInvestment),
      defermentRequired: isSip ? true : !!v.defermentRequired,
      defermentYears: nn(v.defermentYears),
      accumulationRatePct: nn(v.accumulationRatePct),
      swpRatePct,
      includeInflation,
      inflationPct: nn(v.inflationPct),
      swpMode,
      swpAmount: nn(v.swpAmount),
      swpPercentage: nn(v.swpPercentage),
    });

    const durationLabel = result.perpetual
      ? `${result.capYears}+ years (sustains indefinitely)`
      : result.monthsLasted != null
        ? `${Math.floor(result.monthsLasted / 12)} years ${result.monthsLasted % 12} months`
        : "—";
    const tone: Tone = result.perpetual || (result.monthsLasted ?? 0) >= 360 ? TONE.emerald : (result.monthsLasted ?? 0) >= 180 ? TONE.amber : TONE.rose;
    const lastRow = result.yearRows[result.yearRows.length - 1];
    const extraMonths = result.monthsLasted != null ? result.monthsLasted % 12 : 0;

    const out: ResultBlock[] = [
      stat("Accumulated value (SWP start)", inr(result.accumulatedValue), TONE.cyan),
      stat(swpMode === "amount" ? "Monthly withdrawal" : "Monthly withdrawal (derived)", inr(result.baseMonthlyWithdrawal)),
      stat("SWP period", durationLabel, tone),
      stat("Total withdrawn", inr(result.totalWithdrawn)),
      insight(
        result.perpetual
          ? `At ${inr(result.baseMonthlyWithdrawal)}/month, withdrawals stay below the ${fmtPct(swpRatePct)} growth — the corpus is effectively never exhausted (sustains ${result.capYears}+ years).`
          : `The ${inr(result.accumulatedValue)} corpus sustains ${inr(result.baseMonthlyWithdrawal)}/month${includeInflation ? " (rising with inflation)" : ""} for ${durationLabel} at a ${fmtPct(swpRatePct)} SWP-period return${result.leftover > 0 ? `, leaving ${inr(result.leftover)} — not enough for one more withdrawal` : ""}.`,
        tone,
      ),
    ];
    if (result.accRows.length > 0) {
      out.push(
        section("1. Accumulation — annual investment and year-end value"),
        table(
          ["Year", "Annual investment", "Year-end value"],
          result.accRows.map((r) => [`${r.year}`, r.annualInvestment > 0 ? inr(r.annualInvestment) : "—", inr(r.yearEndValue)]),
          true,
        ),
      );
    }
    if (result.yearRows.length > 0) {
      out.push(
        section(`${result.accRows.length > 0 ? 2 : 1}. Distribution — monthly SWP and year-end balance`),
        table(
          ["Year", "Monthly SWP", "Withdrawn that year", "Balance at year-end"],
          result.yearRows.map((r) => [`${r.planYear}`, inr(r.monthlyWithdrawal), inr(r.withdrawnThisYear), inr(r.endBalance)]),
        ),
      );
      if (lastRow && extraMonths > 0) {
        out.push(note(`The ${inr(lastRow.endBalance)} left after year ${lastRow.planYear} pays ${extraMonths} more monthly withdrawal${extraMonths === 1 ? "" : "s"}, not a full year.`));
      }
    }
    out.push(note("SIP paid at the start of each month; the corpus is rounded to the rupee when the SWP starts; withdrawals are taken on the last day of each month and only full withdrawals are counted · effective monthly rate."));
    return out;
  },
};

/* ───────────────────────── swpcomp ───────────────────────── */

const SWPC_MODES: Record<SwpcInvestMode, string> = {
  lumpsum: "Lumpsum", annual_lumpsum: "Annual Lumpsum", sip: "SIP", lumpsum_sip: "Lumpsum + SIP",
};
const SWPC_FREQS: Record<SwpcFrequency, string> = {
  monthly: "Monthly", quarterly: "Quarterly", halfyearly: "Half-yearly", annually: "Annually",
};
const SWPC_FREQ_KEYS = Object.keys(SWPC_FREQS) as SwpcFrequency[];

/**
 * SwpComprehensivePlanner.tsx — SWP Comprehensive Planner (computeSwpComprehensive).
 * The allocation grid's columns become a list, so each label names its row
 * ("Allocation % — Hybrid %"), as the web's first column does; the grid's
 * Total / Average cells are the Portfolio row of section 1.
 */
const swpcomp: CalcBody = {
  inputs: [
    { key: "investMode", label: "Investment mode", type: "select", default: "lumpsum", options: opts(Object.entries(SWPC_MODES)) },
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 60 },
    // One web field, relabelled for an annual lumpsum.
    { key: "lumpsum", label: "Lumpsum (₹)", type: "money", default: 5000000, visibleIf: (v) => v.investMode !== "annual_lumpsum" && v.investMode !== "sip" },
    { key: "lumpsum", label: "Annual lumpsum (₹)", type: "money", default: 5000000, visibleIf: (v) => v.investMode === "annual_lumpsum" },
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 25000, visibleIf: (v) => v.investMode === "sip" || v.investMode === "lumpsum_sip" },
    { key: "accumulationYears", label: "Accumulation period (yrs)", type: "years", default: 15, visibleIf: (v) => own(SWPC_MODES, v.investMode) && v.investMode !== "lumpsum" },
    { key: "accumulationReturnPct", label: "Return during accumulation (%)", type: "percent", default: 12, visibleIf: (v) => own(SWPC_MODES, v.investMode) && v.investMode !== "lumpsum" },
    { key: "deferment", label: "Deferment before SWP?", type: "toggle", default: false },
    { key: "defermentYears", label: "Deferment period (yrs)", type: "years", default: 5, visibleIf: (v) => !!v.deferment },
    { key: "allocDebt", label: "Allocation % — Debt %", type: "percent", default: 0, section: "Distribution phase — asset allocation & returns" },
    { key: "allocHybrid", label: "Allocation % — Hybrid %", type: "percent", default: 100 },
    { key: "allocEquity", label: "Allocation % — Equity %", type: "percent", default: 0 },
    { key: "rateDebt", label: "Assumed return % — Debt %", type: "percent", default: 7 },
    { key: "rateHybrid", label: "Assumed return % — Hybrid %", type: "percent", default: 9 },
    { key: "rateEquity", label: "Assumed return % — Equity %", type: "percent", default: 12 },
    { key: "swpYears", label: "SWP period (yrs)", type: "years", default: 15 },
    { key: "frequency", label: "Withdrawal frequency", type: "select", default: "monthly", options: opts(Object.entries(SWPC_FREQS)) },
    { key: "withdrawalMode", label: "Withdrawal option", type: "segmented", default: "percentage", options: opts([["amount", "In amount"], ["percentage", "In % of corpus"]]) },
    // One web field, relabelled by the frequency ("Withdrawal per month (₹)" …).
    ...SWPC_FREQ_KEYS.map((f): InputSpec => ({
      key: "withdrawalAmount", label: `Withdrawal per ${SWPC_FREQ_LABEL[f]} (₹)`, type: "money", default: 29167,
      visibleIf: (v) => v.withdrawalMode === "amount" && pick(SWPC_FREQS, v.frequency, "monthly") === f,
    })),
    { key: "withdrawalAnnualPct", label: "Total annual withdrawal (%)", type: "percent", default: 7, visibleIf: (v) => v.withdrawalMode !== "amount" },
    { key: "increment", label: "Annual increment", type: "segmented", default: "none", options: opts([["none", "None"], ["percentage", "In %"], ["amount", "In amount"]]) },
    { key: "incrementPct", label: "Increment per year (%)", type: "percent", default: 6, visibleIf: (v) => v.increment === "percentage" },
    ...SWPC_FREQ_KEYS.map((f): InputSpec => ({
      key: "incrementAmount", label: `Increment per ${SWPC_FREQ_LABEL[f]} per year (₹)`, type: "money", default: 1000,
      visibleIf: (v) => v.increment === "amount" && pick(SWPC_FREQS, v.frequency, "monthly") === f,
    })),
  ],
  compute: (v) => {
    const investMode = pick(SWPC_MODES, v.investMode, "lumpsum");
    const frequency = pick(SWPC_FREQS, v.frequency, "monthly");
    const increment: IncrementMode = v.increment === "percentage" || v.increment === "amount" ? v.increment : "none";
    const deferment = !!v.deferment;
    const currentAge = nn(v.currentAge);
    const accumulationYears = nn(v.accumulationYears);
    const defermentYears = nn(v.defermentYears);
    const swpYears = nn(v.swpYears);
    const alloc = { debtPct: nn(v.allocDebt), hybridPct: nn(v.allocHybrid), equityPct: nn(v.allocEquity) };
    const rates = { debtPct: nn(v.rateDebt), hybridPct: nn(v.rateHybrid), equityPct: nn(v.rateEquity) };
    const distReturnPct = weightedAvg(alloc, rates);
    const result = computeSwpComprehensive({
      investMode,
      lumpsum: nn(v.lumpsum),
      monthlySip: nn(v.monthlySip),
      accumulationYears,
      accumulationReturnPct: nn(v.accumulationReturnPct),
      defermentYears: deferment ? defermentYears : 0,
      distReturnPct,
      swpYears,
      frequency,
      withdrawalMode: v.withdrawalMode === "amount" ? "amount" : "percentage",
      withdrawalAmount: nn(v.withdrawalAmount),
      withdrawalAnnualPct: nn(v.withdrawalAnnualPct),
      increment,
      incrementPct: nn(v.incrementPct),
      incrementAmount: nn(v.incrementAmount),
    });

    const per = SWPC_FREQ_LABEL[frequency];
    const needsAccum = investMode !== "lumpsum";
    const allocTotal = alloc.debtPct + alloc.hybridPct + alloc.equityPct;
    const depleted = result.depletedAtPeriod != null;
    const tone: Tone = depleted ? TONE.rose : result.finalValue >= result.accumulatedCorpus ? TONE.emerald : TONE.amber;
    const useAge = currentAge > 0;
    const swpStartAge = currentAge + (needsAccum ? Math.round(accumulationYears) : 0) + (deferment ? Math.round(defermentYears) : 0);
    const allocRows = ([
      ["Debt", alloc.debtPct, rates.debtPct],
      ["Hybrid", alloc.hybridPct, rates.hybridPct],
      ["Equity", alloc.equityPct, rates.equityPct],
    ] as const).filter(([, a]) => a > 0);

    const out: ResultBlock[] = [];
    // The web's warning under the allocation grid.
    if (Math.abs(allocTotal - 100) > 0.01) out.push(insight(`Allocation should total 100% (currently ${allocTotal.toFixed(0)}%).`, TONE.rose));
    out.push(
      stat("Corpus at SWP start", inr(result.accumulatedCorpus), TONE.cyan),
      stat(`Withdrawal / ${per}`, inr(result.basePerPeriodWithdrawal)),
      stat("Total withdrawal", inr(result.totalWithdrawn), TONE.emerald),
      stat(depleted ? "End value (depleted)" : "End value", depleted ? "₹0" : inr(result.finalValue), tone),
      stat(`Max sustainable / ${per}`, `${inr(result.maxPerPeriodWithdrawal)}`),
    );
    if (allocRows.length > 0) {
      out.push(
        section("1. Suggested asset allocation"),
        table(
          ["Asset class", "Allocation", "Assumed return"],
          [...allocRows.map(([name, a, r]) => [name, fmtPct(a), fmtPct(r)]), ["Portfolio", fmtPct(allocTotal), `${distReturnPct.toFixed(2)}%`]],
          true,
        ),
      );
    }
    out.push(insight(
      depleted
        ? `At ${inr(result.basePerPeriodWithdrawal)}/${per}, the corpus runs out before ${swpYears} years. The max sustainable withdrawal is about ${inr(result.maxPerPeriodWithdrawal)}/${per} (${result.maxAnnualPct.toFixed(1)}%/yr).`
        : result.exceedsMax
          ? `This withdrawal exceeds the sustainable maximum — reduce it to about ${inr(result.maxPerPeriodWithdrawal)}/${per} to last the full ${swpYears} years.`
          : `Withdrawing ${inr(result.basePerPeriodWithdrawal)}/${per} for ${swpYears} years leaves ${inr(result.finalValue)} at the end. The maximum sustainable withdrawal is about ${inr(result.maxPerPeriodWithdrawal)}/${per} (${result.maxAnnualPct.toFixed(1)}%/yr).`,
      tone,
    ));
    if (result.yearRows.length > 0) {
      out.push(
        section(`${allocRows.length > 0 ? 2 : 1}. Year-by-year distribution`),
        table(
          [useAge ? "Age" : "Year", `Withdrawal / ${per}`, "Withdrawn that year", "Fund value at year-end"],
          result.yearRows.map((r) => [
            useAge ? `${swpStartAge + r.year}` : `${r.year}`,
            inr(r.withdrawalPerPeriod),
            inr(r.withdrawnThisYear),
            r.endBalance > 0 ? inr(r.endBalance) : "Exhausted",
          ]),
        ),
      );
    }
    out.push(note("Withdrawal at period end · effective per-period rate."));
    return out;
  },
};

/* ───────────────────────── STP shared pieces (StpParts.tsx) ───────────────────────── */

/** StpParts.tsx describeMonthlyMode, verbatim. */
function describeMonthlyMode(mode: MonthlyStpMode, amount: number, pct: number): string {
  if (mode === "appreciation") return "Capital appreciation (the debt fund's monthly gain)";
  if (mode === "fixedPct") return `${pct}% of the initial investment every month`;
  return `${inr(amount)} every month`;
}

/** StpParts.tsx StpYearTable: the year-wise debt → equity table (nothing when empty). */
function stpYearTable(result: StpComprehensiveResult, title = "Year-wise value of the plan", n = 1): ResultBlock[] {
  if (result.schedule.length === 0) return [];
  return [
    section(`${n}. ${title}`),
    table(
      ["Year", "Debt at start", "Moved to equity", "Equity at start", "Equity at end", "Total at end", "Annualised"],
      result.schedule.map((r) => [
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
  ];
}

/* ───────────────────────── stpcomp ───────────────────────── */

const STP_FREQ_VALUES: string[] = STP_FREQUENCIES.map((f) => f.value);

/** StpComprehensivePlanner.tsx — STP Comprehensive Planner (computeStpComprehensive).
 *  "Add suggested schemes" is three Scheme Master slots; as on the web they are
 *  listed with the inputs only. The web's "Add client name" is not offered. */
const stpcomp: CalcBody = {
  inputs: [
    { key: "initialInvestment", label: "Initial investment (₹)", type: "money", default: 2500000 },
    { key: "debtReturnPct", label: "Debt fund return (% p.a.)", type: "percent", default: 5 },
    { key: "equityReturnPct", label: "Equity fund return (% p.a.)", type: "percent", default: 12 },
    { key: "transferMode", label: "Transfer mode", type: "segmented", default: "fixed", options: opts([["appreciation", "Capital appreciation"], ["fixed", "Fixed transfer"]]) },
    { key: "fixedBasis", label: "Fixed by", type: "segmented", default: "amount", options: opts([["amount", "₹ amount"], ["pctOfInitial", "% of initial"]]), visibleIf: (v) => v.transferMode !== "appreciation" },
    { key: "frequency", label: "Transfer frequency", type: "select", default: "weekly", options: STP_FREQUENCIES.map((f) => ({ value: f.value, label: f.label })) },
    { key: "numInstallments", label: "No. of instalments", type: "int", default: 50 },
    { key: "fixedTransferAmount", label: "Each transfer amount (₹)", type: "money", default: 50000, visibleIf: (v) => v.transferMode !== "appreciation" && v.fixedBasis !== "pctOfInitial" },
    { key: "fixedTransferPct", label: "Each transfer (% of initial)", type: "percent", default: 2, visibleIf: (v) => v.transferMode !== "appreciation" && v.fixedBasis === "pctOfInitial" },
    { key: "periodValue", label: "Total investment period", type: "number", default: 10 },
    { key: "periodUnit", label: "Period in", type: "segmented", default: "years", options: opts([["years", "Years"], ["months", "Months"]]) },
    { key: "report", label: "Report", type: "segmented", default: "detail", options: opts([["summary", "Summary"], ["detail", "Detail (year-by-year)"]]) },
    { key: "addSchemes", label: "Add suggested schemes", type: "toggle", default: false },
    { key: "scheme1", label: "Suggested scheme 1", type: "scheme", default: null, visibleIf: (v) => !!v.addSchemes },
    { key: "scheme2", label: "Suggested scheme 2", type: "scheme", default: null, visibleIf: (v) => !!v.addSchemes && (!!v.scheme1 || !!v.scheme2) },
    { key: "scheme3", label: "Suggested scheme 3", type: "scheme", default: null, visibleIf: (v) => !!v.addSchemes && (!!v.scheme2 || !!v.scheme3) },
  ],
  compute: (v) => {
    const transferMode: StpTransferMode = v.transferMode === "appreciation" ? "appreciation" : "fixed";
    const fixedBasis: StpFixedBasis = v.fixedBasis === "pctOfInitial" ? "pctOfInitial" : "amount";
    const frequency: StpFrequency = STP_FREQ_VALUES.includes(v.frequency) ? v.frequency : "weekly";
    const numInstallments = nn(v.numInstallments);
    const periodValue = nn(v.periodValue);
    const totalMonths = v.periodUnit === "months" ? periodValue : periodValue * 12;
    const result = computeStpComprehensive({
      initialInvestment: nn(v.initialInvestment),
      debtReturnPct: nn(v.debtReturnPct),
      equityReturnPct: nn(v.equityReturnPct),
      transferMode,
      frequency,
      numInstallments,
      fixedBasis,
      fixedTransferAmount: nn(v.fixedTransferAmount),
      fixedTransferPct: nn(v.fixedTransferPct),
      totalMonths,
    });
    const freqLabel = STP_FREQUENCIES.find((f) => f.value === frequency)?.label.toLowerCase();
    const short = transferMode === "fixed" && result.exhaustedAtPeriod != null;

    const out: ResultBlock[] = [
      // The web's caption under the transfer-mode picker.
      note(transferMode === "appreciation"
        ? "Only the debt fund's gains move to equity — the principal stays in debt."
        : "A fixed transfer moves to equity each period, for the chosen number of instalments, while the debt fund can cover it."),
      stat("Debt fund value", inr(result.debtFinalValue)),
      stat("Equity fund value", inr(result.equityFinalValue), TONE.emerald),
      stat("Total fund value", inr(result.totalFinalValue), TONE.emerald),
      stat("Annualised return", `${result.annualisedReturnPct.toFixed(2)}%`, TONE.emerald),
      note(`${transferMode === "fixed" ? `Each transfer: ${inr(result.transferAmount)}. ` : ""}Total transferred to equity: ${inr(result.totalTransferred)} in ${result.transfersMade} ${freqLabel} transfer(s) over ${result.totalPeriods} period(s).`),
    ];
    if (short) {
      out.push(insight(`The debt fund covers only ${result.transfersMade} of the ${numInstallments} instalments; the remaining ${inr(result.debtFinalValue)} is left in debt rather than moved as a part transfer.`, TONE.amber));
    }
    if (v.report !== "summary") out.push(...stpYearTable(result, "Projected annual investment value"));
    out.push(note("* Illustration only, on the assumptions you enter. The plan is simulated at the transfer frequency (effective rate); actual results vary with market performance. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── opm ───────────────────────── */

/** OpmHousePlanner.tsx — Unconventional SWP · OPM to Buy a House (opmHouseStrategy). */
const opm: CalcBody = {
  inputs: [
    { key: "loanAmount", label: "Loan amount = amount invested (₹)", type: "money", default: 10000000 },
    { key: "loanRate", label: "Loan interest rate (% p.a.)", type: "percent", default: 8.8 },
    { key: "tenureYears", label: "Tenure (years)", type: "years", default: 20 },
    { key: "mfReturn", label: "Expected MF return (% p.a.)", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const loanAmount = nn(v.loanAmount);
    const loanRate = nn(v.loanRate);
    const tenureYears = nn(v.tenureYears);
    const mfReturn = nn(v.mfReturn);
    const res = opmHouseStrategy({ loanAmount, loanRatePct: loanRate, tenureYears, mfReturnPct: mfReturn });
    const spread = mfReturn - loanRate;
    return [
      section("1. The numbers"),
      stat("Monthly EMI", inr(res.emi), TONE.cyan),
      stat("Total paid (all EMIs)", inr(res.totalPaid)),
      stat("Total interest", inr(res.totalInterest), TONE.amber),
      res.corpusSurvived
        ? stat(`Corpus left after ${tenureYears} yrs`, inr(res.corpusLeft), TONE.emerald)
        : stat("Corpus runs out", `Year ${res.depletedYear}`, TONE.rose),
      section("2. Year-by-year"),
      table(
        ["Year", "Loan outstanding", "MF corpus", "Cumulative interest", "EMIs paid by SWP"],
        res.yearly.map((y) => [`${y.year}`, inr(y.loanBalance), inr(y.mfCorpus), inr(y.cumInterest), inr(y.cumWithdrawal)]),
        true,
      ),
      res.corpusSurvived
        ? insight(`With a ${fmtPct(spread)} spread (fund ${fmtPct(mfReturn)} vs loan ${fmtPct(loanRate)}), the SWP funds every EMI and the loan clears in ${tenureYears} years — yet ${inr(res.corpusLeft)} of corpus remains. The house is effectively paid for by the bank’s money while your capital kept compounding.`, TONE.emerald)
        : insight(`At fund ${fmtPct(mfReturn)} vs loan ${fmtPct(loanRate)} the corpus is drawn down faster than it grows and runs out in year ${res.depletedYear}, before the loan is repaid — the SWP funds ${inr(res.swpPaid)} of the ${inr(res.totalPaid)} in EMIs. The strategy only holds while the expected return comfortably exceeds the loan rate.`, TONE.rose),
      insight("Illustration only. Mutual-fund returns are market-linked and not guaranteed; a poor sequence of returns early in the plan can exhaust the corpus even if the long-run average looks fine. SWP withdrawals may attract capital-gains tax. Use a conservative return assumption and keep a buffer before recommending a leverage strategy.", TONE.amber),
    ];
  },
};

/* ───────────────────────── target-SWP shared pieces (swp-target-parts.tsx) ───────────────────────── */

/** swp-target-parts.tsx DEFAULT_TAX. */
const DEFAULT_TAX: SwpTax = { stPct: 20, stUptoYears: 1, ltPct: 12.5, ltFromYear: 2, indexationPct: 0 };

/** swp-target-parts.tsx TaxInputs. */
function taxInputs(on: boolean): InputSpec[] {
  const shown = (v: Record<string, any>) => !!v.useTax;
  return [
    { key: "useTax", label: "Include capital-gains tax", type: "toggle", default: on },
    { key: "stPct", label: "Short-term tax (%)", type: "percent", default: DEFAULT_TAX.stPct, visibleIf: shown },
    { key: "stUptoYears", label: "Short term up to (yrs)", type: "years", default: DEFAULT_TAX.stUptoYears, visibleIf: shown },
    { key: "ltPct", label: "Long-term tax (%)", type: "percent", default: DEFAULT_TAX.ltPct, visibleIf: shown },
    { key: "ltFromYear", label: "Long term from year", type: "int", default: DEFAULT_TAX.ltFromYear, visibleIf: shown },
    {
      key: "indexationPct", label: "Indexation inflation (%)", type: "percent", default: DEFAULT_TAX.indexationPct, visibleIf: shown,
      hint: "Gains are worked out first-in-first-out from the investment date. No exemption, cess or surcharge is applied. Indexation raises the cost of long-term units only; leave it at 0 for equity-style taxation.",
    },
  ];
}
const taxOf = (v: Record<string, any>): SwpTax => ({
  stPct: nn(v.stPct), stUptoYears: nn(v.stUptoYears), ltPct: nn(v.ltPct), ltFromYear: nn(v.ltFromYear), indexationPct: nn(v.indexationPct),
});

/** swp-target-parts.tsx optionalAge: 0 or blank means "not given". */
const optionalAge = (age: number): number | null => (age > 0 ? age : null);

type ScenarioRows = { ratePct: number; rows: SwpYearRow[] };

/** swp-target-parts.tsx SwpYearTable: one column pair per scenario (nothing when empty). */
function swpYearTable(scenarios: ScenarioRows[], firstLabel: "age" | "year"): ResultBlock[] {
  const base = scenarios[0];
  if (!base || base.rows.length === 0) return [];
  const head = [firstLabel === "age" ? "Age" : "Year"];
  for (const s of scenarios) {
    const tag = scenarios.length > 1 ? ` @ ${fmtPct(s.ratePct)}` : "";
    head.push(`Monthly SWP (avg)${tag}`, `Year-end value${tag}`);
  }
  const rows = base.rows.map((row, i) => {
    const cells: string[] = [firstLabel === "age" && row.age != null ? `${row.age}` : `${row.year}`];
    for (const s of scenarios) {
      const r = s.rows[i];
      cells.push(r && r.annualWithdrawal !== 0 ? inr(r.avgMonthlySwp) : "—", r ? inr(r.yearEndBalance) : "—");
    }
    return cells;
  });
  return [table(head, rows, true)];
}

/** swp-target-parts.tsx SwpTaxTable (nothing when no year has a withdrawal). */
function swpTaxTable(rows: SwpYearRow[], firstLabel: "age" | "year"): ResultBlock[] {
  const shown = rows.filter((r) => r.annualWithdrawal !== 0);
  if (shown.length === 0) return [];
  return [table(
    [firstLabel === "age" ? "Age" : "Year", "Annual withdrawal", "Tax payable", "Post-tax withdrawal"],
    shown.map((r) => [firstLabel === "age" && r.age != null ? `${r.age}` : `${r.year}`, inr(r.annualWithdrawal), inr(r.tax), inr(r.postTax)]),
  )];
}

/** The scenario / deferment / inflation inputs the two lumpsum ↔ SWP calculators share. */
const swpScenarioInputs = (): InputSpec[] => [
  { key: "rate1", label: "Scenario 1 return (%)", type: "percent", default: 9 },
  { key: "useRate2", label: "Compare scenario 2", type: "toggle", default: false },
  { key: "rate2", label: "Scenario 2 return (%)", type: "percent", default: 10, visibleIf: (v) => !!v.useRate2 },
  { key: "defer", label: "Defer the first withdrawal", type: "toggle", default: false },
  { key: "deferYears", label: "Deferment (yrs)", type: "years", default: 5, visibleIf: (v) => !!v.defer },
  { key: "useInflation", label: "Raise the SWP with inflation", type: "toggle", default: true },
  { key: "inflationPct", label: "Expected inflation (%)", type: "percent", default: 5, visibleIf: (v) => !!v.useInflation },
];

const SWP_TARGET_NOTE = "Withdrawals are taken on the last day of each month, starting with month 1 of the SWP · effective monthly rate · the table shows each year's average monthly withdrawal. Illustration only; returns are not guaranteed.";

/* ───────────────────────── swp ───────────────────────── */

/** SwpFromLumpsumCalculator.tsx — Monthly SWP from a Lumpsum (swpFromLumpsum). */
const swp: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 60 },
    { key: "lumpsum", label: "Initial investment (₹)", type: "money", default: 10000000 },
    { key: "swpYears", label: "SWP period (yrs)", type: "years", default: 25 },
    { key: "endBalance", label: "Balance required at the end (₹)", type: "money", default: 10000000 },
    ...swpScenarioInputs(),
    ...taxInputs(true),
  ],
  compute: (v) => {
    const age = optionalAge(nn(v.currentAge));
    const label = age != null ? "age" : "year";
    const lumpsum = nn(v.lumpsum);
    const swpYears = nn(v.swpYears);
    const endBalance = nn(v.endBalance);
    const useInflation = !!v.useInflation;
    const inflationPct = nn(v.inflationPct);
    const useTax = !!v.useTax;
    const tax = taxOf(v);
    const runS = (ratePct: number) => swpFromLumpsum({
      lumpsum, deferYears: v.defer ? nn(v.deferYears) : 0, swpYears, ratePct,
      inflationPct: useInflation ? inflationPct : 0, endBalance, currentAge: age, tax: useTax ? tax : null,
    });
    const scenarios = v.useRate2 ? [runS(nn(v.rate1)), runS(nn(v.rate2))] : [runS(nn(v.rate1))];
    const s1 = scenarios[0];
    const infeasible = scenarios.filter((s) => !s.feasible);

    const out: ResultBlock[] = [
      ...scenarios.map((s, i) => stat(`${useInflation ? "First-year average SWP" : "Monthly SWP"} @ ${fmtPct(s.ratePct)}`, inr(s.firstYearAvgSwp), i === 0 ? TONE.cyan : TONE.emerald)),
      ...scenarios.map((s) => stat(`Total withdrawal @ ${fmtPct(s.ratePct)}`, inr(s.totalWithdrawal))),
      ...(scenarios.length === 1 && useInflation ? [stat("First → last monthly SWP", `${inr(s1.firstMonthSwp)} → ${inr(s1.lastMonthSwp)}`)] : []),
      infeasible.length > 0
        ? insight(`The balance asked for is more than ${inr(lumpsum)} grows to with no withdrawals at ${infeasible.map((s) => fmtPct(s.ratePct)).join(" / ")} (at most ${inr(infeasible[0].maxEndBalance)}), so the SWP works out negative. Lower the balance required or assume a higher return.`, TONE.rose)
        : insight(`${inr(lumpsum)} at ${fmtPct(s1.ratePct)} pays ${inr(s1.firstMonthSwp)} in the first month${useInflation ? `, rising every month with ${fmtPct(inflationPct)} inflation to ${inr(s1.lastMonthSwp)} in the last,` : ""} for ${swpYears} years and still leaves ${inr(endBalance)}.${useTax ? ` Tax over the period comes to about ${inr(s1.totalTax)}.` : ""}`, TONE.cyan),
      section("1. Monthly withdrawal and investment value"),
      ...swpYearTable(scenarios.map((s) => ({ ratePct: s.ratePct, rows: s.rows })), label),
    ];
    if (useTax) {
      scenarios.forEach((s, i) => out.push(section(`${2 + i}. Annual tax and post-tax withdrawal @ ${fmtPct(s.ratePct)}`), ...swpTaxTable(s.rows, label)));
    }
    out.push(note(SWP_TARGET_NOTE));
    return out;
  },
};

/* ───────────────────────── swpneed ───────────────────────── */

/** LumpsumForSwpCalculator.tsx — Lumpsum Needed for a Monthly SWP (lumpsumForSwp). */
const swpneed: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 60 },
    { key: "monthlySwp", label: "Monthly SWP wanted (₹, first month)", type: "money", default: 200000 },
    { key: "swpYears", label: "SWP period (yrs)", type: "years", default: 25 },
    { key: "endBalance", label: "Balance required at the end (₹)", type: "money", default: 10000000 },
    ...swpScenarioInputs(),
    ...taxInputs(false),
  ],
  compute: (v) => {
    const age = optionalAge(nn(v.currentAge));
    const label = age != null ? "age" : "year";
    const monthlySwp = nn(v.monthlySwp);
    const swpYears = nn(v.swpYears);
    const endBalance = nn(v.endBalance);
    const defer = !!v.defer;
    const deferYears = nn(v.deferYears);
    const useInflation = !!v.useInflation;
    const inflationPct = nn(v.inflationPct);
    const useTax = !!v.useTax;
    const tax = taxOf(v);
    const runS = (ratePct: number) => lumpsumForSwp({
      firstMonthlySwp: monthlySwp, deferYears: defer ? deferYears : 0, swpYears, ratePct,
      inflationPct: useInflation ? inflationPct : 0, endBalance, currentAge: age, tax: useTax ? tax : null,
    });
    const scenarios = v.useRate2 ? [runS(nn(v.rate1)), runS(nn(v.rate2))] : [runS(nn(v.rate1))];
    const s1 = scenarios[0];
    const s2 = scenarios[1];

    const out: ResultBlock[] = [
      ...scenarios.map((s, i) => stat(`Lumpsum needed today @ ${fmtPct(s.ratePct)}`, inr(s.lumpsumToday), i === 0 ? TONE.cyan : TONE.emerald)),
      ...scenarios.map((s) => stat(`Total withdrawal @ ${fmtPct(s.ratePct)}`, inr(s.totalWithdrawal))),
      ...(scenarios.length === 1 && useInflation ? [stat("First → last monthly SWP", `${inr(s1.firstMonthSwp)} → ${inr(s1.lastMonthSwp)}`)] : []),
      insight(`To draw ${inr(monthlySwp)} a month${useInflation ? ` (rising with ${fmtPct(inflationPct)} inflation)` : ""} for ${swpYears} years${defer ? ` starting in ${deferYears} years` : ""} and keep ${inr(endBalance)} at the end, invest ${inr(s1.lumpsumToday)} today at ${fmtPct(s1.ratePct)}.${s2 ? ` At ${fmtPct(s2.ratePct)} it would be ${inr(s2.lumpsumToday)}.` : ""}`, TONE.cyan),
      section("1. Monthly withdrawal and investment value"),
      ...swpYearTable(scenarios.map((s) => ({ ratePct: s.ratePct, rows: s.rows })), label),
    ];
    if (useTax) {
      scenarios.forEach((s, i) => out.push(section(`${2 + i}. Annual tax and post-tax withdrawal @ ${fmtPct(s.ratePct)}`), ...swpTaxTable(s.rows, label)));
    }
    out.push(note(SWP_TARGET_NOTE));
    return out;
  },
};

/* ───────────────────────── sipforswp ───────────────────────── */

/** SipForSwpCalculator.tsx — SIP Needed for a Monthly SWP (sipForSwp); the
 *  one-time lumpsum today sits beside the SIP, as on the web. */
const sipforswp: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 40 },
    { key: "monthlySwp", label: "Monthly SWP wanted (₹, first month)", type: "money", default: 100000 },
    { key: "sipYears", label: "SIP period (yrs)", type: "years", default: 20 },
    { key: "swpYears", label: "SWP period (yrs)", type: "years", default: 30 },
    { key: "endBalance", label: "Balance required at the end (₹)", type: "money", default: 5000000 },
    { key: "acc1", label: "Scenario 1 — SIP-phase return (%)", type: "percent", default: 12 },
    { key: "dist1", label: "Scenario 1 — SWP-phase return (%)", type: "percent", default: 7 },
    { key: "useS2", label: "Compare scenario 2", type: "toggle", default: false },
    { key: "acc2", label: "Scenario 2 — SIP phase (%)", type: "percent", default: 10, visibleIf: (v) => !!v.useS2 },
    { key: "dist2", label: "Scenario 2 — SWP phase (%)", type: "percent", default: 6, visibleIf: (v) => !!v.useS2 },
    { key: "defer", label: "Wait after the SIP ends", type: "toggle", default: false },
    { key: "deferYears", label: "Years before the first SWP", type: "years", default: 5, visibleIf: (v) => !!v.defer },
    { key: "useInflation", label: "Raise the SWP with inflation", type: "toggle", default: false },
    { key: "inflationPct", label: "Expected inflation (%)", type: "percent", default: 5, visibleIf: (v) => !!v.useInflation },
  ],
  compute: (v) => {
    const age = optionalAge(nn(v.currentAge));
    const label = age != null ? "age" : "year";
    const monthlySwp = nn(v.monthlySwp);
    const sipYears = nn(v.sipYears);
    const swpYears = nn(v.swpYears);
    const endBalance = nn(v.endBalance);
    const defer = !!v.defer;
    const deferYears = nn(v.deferYears);
    const useInflation = !!v.useInflation;
    const inflationPct = nn(v.inflationPct);
    const runS = (accPct: number, distPct: number) => sipForSwp({
      firstMonthlySwp: monthlySwp, sipYears, deferYears: defer ? deferYears : 0, swpYears,
      accPct, distPct, inflationPct: useInflation ? inflationPct : 0, endBalance, currentAge: age,
    });
    const scenarios = v.useS2 ? [runS(nn(v.acc1), nn(v.dist1)), runS(nn(v.acc2), nn(v.dist2))] : [runS(nn(v.acc1), nn(v.dist1))];
    const s1 = scenarios[0];
    const tag = (s: (typeof scenarios)[number]) => `${fmtPct(s.accPct)} / ${fmtPct(s.distPct)}`;
    const sameRate = useInflation && scenarios.some((s) => Math.abs(s.distPct - inflationPct) < 1e-9);

    const out: ResultBlock[] = scenarios.flatMap((s, i) => [
      stat(`Corpus needed @ ${tag(s)}`, inr(s.corpus)),
      stat(`Monthly SIP needed @ ${tag(s)}`, inr(s.monthlySip), i === 0 ? TONE.cyan : TONE.emerald),
      stat(`One-time lumpsum today @ ${tag(s)}`, inr(s.lumpsumToday)),
      stat(`Total withdrawal @ ${tag(s)}`, inr(s.totalWithdrawal)),
    ]);
    out.push(insight(`A SIP of ${inr(s1.monthlySip)} a month for ${sipYears} years at ${fmtPct(s1.accPct)} builds ${inr(s1.corpus)}${defer ? ` by the time withdrawals start ${deferYears} years later` : ""} — enough to draw ${inr(monthlySwp)} a month${useInflation ? ` (rising with ${fmtPct(inflationPct)} inflation)` : ""} for ${swpYears} years at ${fmtPct(s1.distPct)} and leave ${inr(endBalance)}. You invest ${inr(s1.totalInvested)} in all — or a one-time lumpsum of ${inr(s1.lumpsumToday)} invested today at ${fmtPct(s1.accPct)} grows to the same corpus by then.`, TONE.cyan));
    if (sameRate) out.push(insight("The SWP-phase return equals inflation, so the withdrawal grows as fast as the money it is drawn from.", TONE.amber));
    out.push(
      section(`1. Accumulation — annual investment and year-end value @ ${fmtPct(s1.accPct)}`),
      table(
        [label === "age" ? "Age" : "Year", "Annual investment", "Year-end value"],
        s1.accRows.map((r) => [
          label === "age" && r.age != null ? `${r.age}` : `${r.year}`,
          r.annualInvestment > 0 ? inr(r.annualInvestment) : "—",
          inr(r.yearEndValue),
        ]),
        true,
      ),
      section("2. Distribution — monthly withdrawal and year-end value"),
      ...swpYearTable(scenarios.map((s) => ({ ratePct: s.distPct, rows: s.swpRows })), label),
      note("SIP paid at the start of each month; withdrawals taken on the last day of each month · effective monthly rates · the distribution table shows each year's average monthly withdrawal. Illustration only; returns are not guaranteed."),
    );
    return out;
  },
};

/* ───────────────────────── stp ───────────────────────── */

/** StpFutureValueCalculator.tsx — Future Value of STP (computeMonthlyStp); the
 *  transfer rule is StpParts.tsx MonthlyModeFields. */
const stp: CalcBody = {
  inputs: [
    { key: "initial", label: "Initial investment (₹)", type: "money", default: 2500000 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 10 },
    { key: "debtPct", label: "Debt fund return (% p.a.)", type: "percent", default: 5 },
    { key: "equityPct", label: "Equity fund return (% p.a.)", type: "percent", default: 12 },
    { key: "transfer", label: "Monthly transfer", type: "segmented", default: "fixed", options: opts([["appreciation", "Capital appreciation"], ["fixed", "Fixed transfer"]]) },
    { key: "fixedBy", label: "Fixed by", type: "segmented", default: "fixedAmount", options: opts([["fixedAmount", "₹ amount"], ["fixedPct", "% of initial"]]), visibleIf: (v) => v.transfer !== "appreciation" },
    { key: "amount", label: "Transfer / month (₹)", type: "money", default: 50000, visibleIf: (v) => v.transfer !== "appreciation" && v.fixedBy !== "fixedPct" },
    { key: "pct", label: "Transfer / month (% of initial)", type: "percent", default: 2, visibleIf: (v) => v.transfer !== "appreciation" && v.fixedBy === "fixedPct" },
    { key: "detailed", label: "Show year-wise table", type: "toggle", default: true, visibleIf: (v) => Math.round(nn(v.years) * 12) > 0 },
  ],
  compute: (v) => {
    const initial = nn(v.initial);
    const years = nn(v.years);
    const debtPct = nn(v.debtPct);
    const equityPct = nn(v.equityPct);
    const amount = nn(v.amount);
    const pct = nn(v.pct);
    const mode: MonthlyStpMode = v.transfer === "appreciation" ? "appreciation" : v.fixedBy === "fixedPct" ? "fixedPct" : "fixedAmount";
    const result = computeMonthlyStp({ initial, years, debtPct, equityPct, mode, fixedAmount: amount, fixedPct: pct });
    const months = Math.round(years * 12);
    const stopped = result.exhaustedAtPeriod;
    const out: ResultBlock[] = [];
    if (months > 0) {
      const tail = mode === "appreciation"
        ? ""
        : stopped != null
          ? ` The debt fund covers ${result.transfersMade} transfers; from month ${stopped} it holds less than one, so the remaining ${inr(result.debtFinalValue)} stays in debt.`
          : ` All ${result.transfersMade} monthly transfers are covered by the debt fund.`;
      out.push(
        stat("Debt fund value", inr(result.debtFinalValue)),
        stat("Equity fund value", inr(result.equityFinalValue)),
        stat("Total value", inr(result.totalFinalValue), TONE.cyan),
        stat("Annualised return", `${result.annualisedReturnPct.toFixed(2)}%`, TONE.emerald),
        insight(`${inr(initial)} in a ${debtPct}% debt fund, moving ${describeMonthlyMode(mode, amount, pct).toLowerCase()} into a ${equityPct}% equity fund, could be worth ${inr(result.totalFinalValue)} after ${years} years.${tail}`, TONE.cyan),
      );
      if (v.detailed) out.push(...stpYearTable(result));
    }
    out.push(note("* Illustration only. Each month both funds earn their return (effective monthly rate), then the transfer is made at month end. Not investment advice."));
    return out;
  },
};

/* ───────────────────────── prosperity ───────────────────────── */

/** ProsperityMultiplier.tsx — Prosperity Multiplier (computeProsperityMultiplier).
 *  Sections 1–2 are the web's input panels; section 4 is its chart only, whose
 *  caption is kept as a note. */
const prosperity: CalcBody = {
  inputs: [
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 50000, section: "1. Accumulation — build the corpus" },
    { key: "investYears", label: "Investment period (yrs)", type: "years", default: 20 },
    { key: "accumRatePct", label: "Expected return (% p.a.)", type: "percent", default: 12 },
    { key: "sipStepUpPct", label: "Annual SIP step-up (%)", type: "percent", default: 0 },
    { key: "lumpsum", label: "Lumpsum at start (₹)", type: "money", default: 0 },
    { key: "monthlyWithdrawal", label: "Monthly withdrawal (₹)", type: "money", default: 200000, section: "2. Distribution — draw the income" },
    { key: "withdrawalYears", label: "Withdrawal period (yrs)", type: "years", default: 40 },
    { key: "withdrawRatePct", label: "Corpus return (% p.a.)", type: "percent", default: 12 },
    { key: "inflationPct", label: "Income inflation (% p.a.)", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const monthlySip = nn(v.monthlySip);
    const investYears = nn(v.investYears);
    const monthlyWithdrawal = nn(v.monthlyWithdrawal);
    const withdrawalYears = nn(v.withdrawalYears);
    const inflationPct = nn(v.inflationPct);
    const res = computeProsperityMultiplier({
      monthlySip, investYears, accumRatePct: nn(v.accumRatePct), sipStepUpPct: nn(v.sipStepUpPct), lumpsum: nn(v.lumpsum),
      monthlyWithdrawal, withdrawalYears, withdrawRatePct: nn(v.withdrawRatePct), inflationPct,
    });
    const grows = res.endingCorpus >= res.totalCorpus;
    return [
      section("3. The headline"),
      stat(`Invested (${investYears}y)`, inr(res.totalInvested)),
      stat(`Corpus at year ${investYears}`, inr(res.totalCorpus), TONE.cyan),
      stat(`Total income drawn (${withdrawalYears}y)`, inr(res.totalWithdrawn), TONE.emerald),
      stat(
        res.depletedYear ? "Corpus runs out" : `Corpus after ${withdrawalYears}y`,
        res.depletedYear ? `Year ${investYears + res.depletedYear}` : inr(res.endingCorpus),
        res.depletedYear ? TONE.rose : grows ? TONE.emerald : TONE.amber,
      ),
      res.depletedYear
        ? insight(`The corpus is exhausted in year ${investYears + res.depletedYear} (${res.depletedYear} years into withdrawals). Reduce the monthly withdrawal, lengthen the SIP, or add a step-up to make the income last.`, TONE.rose)
        : insight(`${inr(monthlySip)}/month for ${investYears} years (${inr(res.totalInvested)} invested) builds ${inr(res.totalCorpus)}. Then drawing ${inr(monthlyWithdrawal)}/month (rising ${inflationPct}%/yr) pays out ${inr(res.totalWithdrawn)} over ${withdrawalYears} years — and the corpus ${grows ? "still grows to" : "ends at"} ${inr(res.endingCorpus)}${grows ? " while paying you the whole time." : "."}`, grows ? TONE.emerald : TONE.amber),
      note(`Years 1–${investYears} are the SIP phase; from year ${investYears + 1} the corpus pays the monthly income.`),
      section("5. Accumulation ledger (year by year)"),
      table(
        ["Year", "Opening", "Investment", "Interest", "Closing"],
        res.accum.map((r) => [String(r.year), inr(r.openingBal), inr(r.investment), inr(r.interest), inr(r.closingBal)]),
        true,
      ),
      section("6. Withdrawal ledger (year by year)"),
      table(
        ["Year", "Corpus", "Withdrawal", "Interest", "Closing"],
        res.draw.map((r) => [String(investYears + r.year), inr(r.corpus), inr(r.withdrawal), inr(r.interest), inr(Math.max(0, r.closingBal))]),
        true,
      ),
      note("* Illustration only. Accumulation: opening balance compounds annually and each year's SIP is grown to year-end (monthly compounding), with the chosen annual step-up. Distribution: the corpus earns the chosen return each year, the year's income is withdrawn at year end and rises with inflation. Returns are not guaranteed and vary with markets; taxes and exit loads are not modelled. Not investment advice — mutual fund investments are subject to market risks."),
    ];
  },
};

/* ───────────────────────── swprebal ───────────────────────── */

const REBAL_FREQ_NAME: Record<RebalanceFrequency, string> = {
  monthly: "Monthly", quarterly: "Quarterly", halfyearly: "Half-yearly", yearly: "Yearly",
};

/** SwpRebalanceCalculator.tsx — SWP Rebalance Calculator (computeSwpRebalance).
 *  The web's frequency buttons carry each frequency's SWP ("Monthly · ₹42,406");
 *  an option label here is static, so those figures open the results. */
const swprebal: CalcBody = {
  inputs: [
    { key: "currentAge", label: "Current age (optional)", type: "years", default: 58 },
    { key: "initial", label: "Initial investment (₹)", type: "money", default: 7500000 },
    { key: "debtAllocPct", label: "Debt fund share (%)", type: "percent", default: 50 },
    { key: "debtReturnPct", label: "Debt fund return (%)", type: "percent", default: 6 },
    { key: "balancedReturnPct", label: "Balanced fund return (%)", type: "percent", default: 9 },
    { key: "annualWithdrawalPct", label: "Annual withdrawal (% of corpus)", type: "percent", default: 7 },
    { key: "years", label: "SWP period (yrs)", type: "years", default: 22 },
    { key: "rebalanceYears", label: "Rebalance every (yrs)", type: "years", default: 5 },
    { key: "frequency", label: "SWP frequency", type: "select", default: "monthly", options: opts(Object.entries(REBAL_FREQ_NAME)) },
  ],
  compute: (v) => {
    const currentAge = nn(v.currentAge);
    const initial = nn(v.initial);
    const debtAllocPct = nn(v.debtAllocPct);
    const debtReturnPct = nn(v.debtReturnPct);
    const balancedReturnPct = nn(v.balancedReturnPct);
    const annualWithdrawalPct = nn(v.annualWithdrawalPct);
    const years = nn(v.years);
    const rebalanceYears = nn(v.rebalanceYears);
    const frequency = pick(REBAL_FREQ_NAME, v.frequency, "monthly");
    const result = computeSwpRebalance({
      initial, debtAllocPct, debtReturnPct, balancedReturnPct, annualWithdrawalPct,
      frequency, years, rebalanceYears, currentAge: currentAge > 0 ? currentAge : null,
    });
    const limits: string[] = [];
    if (debtAllocPct < 50 || debtAllocPct > 100) limits.push("debt between 50% and 100% of the corpus (balanced fund at most 50%)");
    if (debtReturnPct > 8) limits.push("a debt return of at most 8%");
    if (balancedReturnPct > 10) limits.push("a balanced-fund return of at most 10%");
    if (annualWithdrawalPct > result.portfolioReturnPct) limits.push(`a withdrawal no higher than the ${fmtPct(result.portfolioReturnPct)} expected return`);
    const useAge = currentAge > 0;
    const per = REBAL_FREQ_NAME[frequency].toLowerCase();

    const out: ResultBlock[] = [
      note((Object.keys(REBAL_FREQ_NAME) as RebalanceFrequency[]).map((f) => `${REBAL_FREQ_NAME[f]} · ${inr(result.swpByFrequency[f])}`).join(", ")),
    ];
    if (limits.length > 0) out.push(insight(`Outside the usual limits for this plan — it expects ${limits.join(", ")}.`, TONE.amber));
    out.push(
      stat("Expected portfolio return", `${result.portfolioReturnPct.toFixed(2)}%`),
      stat(`${REBAL_FREQ_NAME[frequency]} SWP`, inr(result.perPeriodSwp), TONE.cyan),
      stat("Total withdrawal", inr(result.totalWithdrawal), TONE.emerald),
      stat("Closing value", inr(result.closingValue)),
      result.debtShortfallYear != null
        ? insight(`The debt fund cannot cover the withdrawals in year ${result.debtShortfallYear} before the next rebalance — lower the withdrawal, raise the debt share or rebalance more often.`, TONE.rose)
        : insight(`Taking ${inr(result.perPeriodSwp)} ${per} (${inr(result.annualWithdrawal)} a year) from the debt fund for ${years} years pays ${inr(result.totalWithdrawal)} and still leaves ${inr(result.closingValue)}, because the balanced fund's gains refill the debt fund every ${rebalanceYears} years.`, TONE.cyan),
      section("1. Year-wise fund values"),
      table(
        [useAge ? "Age" : "Year", "Debt — start", "Debt — end", "Balanced — start", "Balanced — end", "Withdrawn", "Total value", "Switched to debt"],
        result.rows.map((r) => [
          useAge && r.age != null ? `${r.age}` : `${r.year}`,
          inr(r.debtStart),
          inr(r.debtEnd),
          inr(r.balancedStart),
          inr(r.balancedEnd),
          inr(r.annualWithdrawal),
          inr(r.fundValue),
          r.transfer > 0 ? inr(r.transfer) : "—",
        ]),
        true,
      ),
      note("Withdrawals are taken from the debt fund on the last day of each period; the balanced fund compounds yearly and its gain is switched to debt at the end of each rebalancing year. Illustration only; returns are not guaranteed."),
    );
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  bridge, swpperiodic, swpend, swpcomp, stpcomp, opm, swp, stp, prosperity, swpneed, sipforswp, swprebal,
};
