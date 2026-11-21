/**
 * SIP & Wealth Building — mirrors the web group of the same name
 * (src/components/calculators/*, maths in ./web). Labels, figures and the
 * order of results follow the web component named on each def.
 */

import type { CalcBody, InputSpec, ResultBlock, SchemePick } from "../types";
import { inr, fmtPct, inrCompact } from "../fmt";
import {
  sipFv, lumpsumFv, lumpsumPlusSipFv, stepUpSipFv, limitedSipFv, type SipProjection, type StepUp,
} from "../web/sip-suite";
import { computeSip360, type Sip360Scenario } from "../web/sip360";
import { computeReckoner, roundToThousand } from "../web/stepup-reckoner";
import { growingSipSchedule, cagrCalculate } from "../web/goal-planning-calc";
import { computeSalaryWealth, type SalaryWealthMode } from "../web/salary-wealth";
import { computeFvAnnualLumpsum } from "../web/fv-annual-lumpsum";
import { computeAnnualLumpsumRequired } from "../web/annual-lumpsum-required";
import { computeSipStpFv } from "../web/stp-comprehensive";
import {
  compounding, effectiveAnnualRate, COMPOUND_PERIODS, type AdditionFrequency, type CompoundFrequency,
} from "../web/compounding";
import { scenarioInputs, ratesOf, reportInput, stat, section, table, insight, note, opts } from "./shared";

/** The web's clampNum: a non-negative finite number, 0 on garbage. */
const nn = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** SipFvCalculator.tsx — Future Value of a SIP (sipFv). */
const sipfv: CalcBody = {
  inputs: [
    { key: "monthly", label: "Monthly SIP (₹)", type: "money", default: 10000 },
    { key: "years", label: "SIP period (yrs)", type: "years", default: 15 },
    ...scenarioInputs(12, 15, true),
    { key: "withStepUp", label: "Compare a step-up SIP", type: "toggle", default: true },
    { key: "stepMode", label: "Step-up", type: "segmented", default: "amount", options: opts([["pct", "% every year"], ["amount", "₹ every year"]]), visibleIf: (v) => !!v.withStepUp },
    { key: "stepPct", label: "Step-up every year (%)", type: "percent", default: 10, visibleIf: (v) => !!v.withStepUp && v.stepMode === "pct" },
    { key: "stepAmount", label: "Step-up every year (₹)", type: "money", default: 2000, visibleIf: (v) => !!v.withStepUp && v.stepMode === "amount" },
    reportInput(),
  ],
  compute: (v) => {
    const rates = ratesOf(v);
    const stepUp: StepUp | null = !v.withStepUp ? null : v.stepMode === "pct" ? { mode: "pct", pct: v.stepPct } : { mode: "amount", amount: v.stepAmount };
    const res = sipFv({ monthly: v.monthly, years: v.years, ratesPct: rates, stepUp });
    const stepLabel = v.stepMode === "pct" ? `+${fmtPct(v.stepPct)} a year` : `+${inr(v.stepAmount)} a year`;
    const out: ResultBlock[] = [
      stat("Total invested — SIP", inr(res.normal.invested)),
      ...(res.stepUp ? [stat("Total invested — step-up SIP", inr(res.stepUp.invested))] : []),
      ...rates.map((r, i) => stat(`SIP value @ ${fmtPct(r)}`, inr(res.normal.fv[i]), i === 0 ? "brand" : undefined)),
      ...(res.stepUp ? rates.map((r, i) => stat(`Step-up SIP value @ ${fmtPct(r)}`, inr(res.stepUp!.fv[i]), "success")) : []),
    ];
    if (res.stepUp && res.years > 0 && v.monthly > 0) {
      out.push(insight(`Raising the SIP ${stepLabel} turns ${inr(res.normal.fv[0])} into ${inr(res.stepUp.fv[0])} at ${fmtPct(rates[0])} — for ${inr(res.stepUp.invested - res.normal.invested)} more invested over ${res.years} years.`, "brand"));
    }
    if (v.view === "detailed" && res.normal.rows.length > 0) {
      const projTable = (p: SipProjection) => table(
        ["Year", "Monthly SIP", "Invested in year", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)],
        p.rows.map((r) => [`${r.year}`, inr(r.monthly), inr(r.annual), ...r.values.map((x) => inr(x))]),
        true,
      );
      out.push(section("1. SIP — year-wise value"), projTable(res.normal));
      if (res.stepUp) out.push(section(`2. Step-up SIP (${stepLabel}) — year-wise value`), projTable(res.stepUp));
    }
    return out;
  },
};

/**
 * Sip360Planner.tsx — SIP 360° Planner (computeSip360). The web's fund-return
 * picker (it fills scenario 1 from a fund's history) is not offered here; the
 * suggested schemes are three Scheme Master slots instead of an add-as-you-go
 * list.
 */
const sip360: CalcBody = {
  inputs: [
    { key: "monthly", label: "Monthly SIP (₹)", type: "money", default: 10000 },
    { key: "years", label: "SIP period (years)", type: "years", default: 20 },
    { key: "rate1", label: "Return — Scenario 1 (%)", type: "percent", default: 12 },
    { key: "useRate2", label: "Return — Scenario 2", type: "toggle", default: true },
    { key: "rate2", label: "Return — Scenario 2 (%)", type: "percent", default: 15, visibleIf: (v) => !!v.useRate2 },
    { key: "stepEnabled", label: "Step-up SIP comparison", type: "toggle", default: true, section: "Optional comparisons" },
    { key: "stepPct", label: "Step-up every year (%)", type: "percent", default: 10, visibleIf: (v) => !!v.stepEnabled },
    { key: "inflationEnabled", label: "Inflation-adjusted value", type: "toggle", default: false },
    { key: "inflationPct", label: "Expected inflation (%)", type: "percent", default: 6, visibleIf: (v) => !!v.inflationEnabled },
    { key: "limitedEnabled", label: "Limited-period SIP", type: "toggle", default: false },
    { key: "limited1", label: "SIP 1 (yrs)", type: "years", default: 5, visibleIf: (v) => !!v.limitedEnabled },
    { key: "limited2", label: "SIP 2 (yrs)", type: "years", default: 10, visibleIf: (v) => !!v.limitedEnabled },
    { key: "limited3", label: "SIP 3 (yrs)", type: "years", default: 15, visibleIf: (v) => !!v.limitedEnabled, hint: "Each must be shorter than the SIP period." },
    { key: "delayEnabled", label: "Cost of delay", type: "toggle", default: false },
    { key: "delay1", label: "Delay 1 (yrs)", type: "years", default: 2, visibleIf: (v) => !!v.delayEnabled },
    { key: "delay2", label: "Delay 2 (yrs)", type: "years", default: 5, visibleIf: (v) => !!v.delayEnabled },
    { key: "delay3", label: "Delay 3 (yrs)", type: "years", default: 7, visibleIf: (v) => !!v.delayEnabled },
    { key: "scheme1", label: "Suggested schemes (optional)", type: "scheme", default: null, section: "Personalisation" },
    { key: "scheme2", label: "Suggested scheme 2 (optional)", type: "scheme", default: null, visibleIf: (v) => !!v.scheme1 || !!v.scheme2 },
    { key: "scheme3", label: "Suggested scheme 3 (optional)", type: "scheme", default: null, visibleIf: (v) => !!v.scheme2 || !!v.scheme3 },
    { key: "comments", label: "Comments (optional)", type: "text", default: "", placeholder: "Notes for the client" },
  ],
  compute: (v) => {
    const monthly = nn(v.monthly);
    const years = nn(v.years);
    const inflationPct = nn(v.inflationPct);
    const scenarios: Sip360Scenario[] = [{ key: "s1", ratePct: nn(v.rate1) }];
    if (v.useRate2) scenarios.push({ key: "s2", ratePct: nn(v.rate2) });
    const result = computeSip360({
      monthly,
      years,
      scenarios,
      stepUp: { enabled: !!v.stepEnabled, pct: nn(v.stepPct) },
      limited: { enabled: !!v.limitedEnabled, durations: [nn(v.limited1), nn(v.limited2), nn(v.limited3)] },
      inflation: { enabled: !!v.inflationEnabled, pct: inflationPct },
      delay: { enabled: !!v.delayEnabled, periods: [nn(v.delay1), nn(v.delay2), nn(v.delay3)] },
    });
    const rates = scenarios.map((s) => s.ratePct);
    const hasStep = result.stepUpInvested != null;

    const out: ResultBlock[] = [
      section("1. Total investment"),
      stat("Normal SIP", inr(result.normalInvested)),
      hasStep ? stat("Step-up SIP", inr(result.stepUpInvested!), "brand") : stat("Step-up SIP", "—"),
      section("2. Expected future value"),
      table(
        ["Mode", ...rates.map((r) => `@ ${fmtPct(r)} return`)],
        [
          ["Normal SIP", ...result.futureValue.map((f) => inr(f.normal))],
          ...(hasStep ? [["Step-up SIP", ...result.futureValue.map((f) => (f.stepUp != null ? inr(f.stepUp) : "—"))]] : []),
        ],
        hasStep,
      ),
    ];
    if (hasStep) out.push(insight("Step-up SIP has the potential to create significantly higher wealth.", "success"));

    if (result.limited && result.limited.length > 0) {
      out.push(
        section("3. Limited-period SIP impact"),
        table(
          ["SIP duration", "Investment", ...rates.map((r) => `Value @ ${fmtPct(r)}`)],
          result.limited.map((row) => [`${row.years} years`, inr(row.invested), ...row.values.map((x) => inr(x.value))]),
        ),
        insight(`Even shorter SIP periods grow through compounding, but end up well below the full ${years}-year tenure.`, "success"),
      );
    }
    if (result.inflationAdjusted && result.inflationAdjusted.length > 0) {
      out.push(
        section(`4. Inflation-adjusted value (@ ${fmtPct(inflationPct)} inflation)`),
        table(
          ["Scenario", "Nominal value", "Real value"],
          result.inflationAdjusted.map((r) => [`@ ${fmtPct(r.ratePct)} return`, inr(r.nominal), inr(r.real)]),
        ),
        insight("Real purchasing power is much lower once inflation is accounted for.", "warning"),
      );
    }
    if (result.costOfDelay && result.costOfDelay.length > 0) {
      out.push(
        section("5. Cost of delay"),
        table(
          ["If you delay", ...rates.map((r) => `SIP needed @ ${fmtPct(r)}`)],
          result.costOfDelay.map((row) => [`${row.delayYears} years`, ...row.required.map((q) => inr(q.sip))]),
        ),
        insight("Delaying drastically increases the SIP required to reach the same goal — starting early costs the least.", "danger"),
      );
    }

    // The web joins the picked schemes with ", " and prints them under the results.
    const schemes = [v.scheme1, v.scheme2, v.scheme3]
      .map((s: SchemePick) => s?.name ?? "")
      .filter(Boolean)
      .join(", ");
    const comments = String(v.comments ?? "");
    if (schemes) out.push(section("Suggested schemes"), note(schemes));
    if (comments) out.push(section("Comments"), note(comments));
    return out;
  },
};

/** StepUpReckoner.tsx — Step-Up SIP Reckoner (computeReckoner). The web's
 *  add / remove timeframe list is five fixed slots; 0 drops a slot. */
const RECKONER_PERIODS = [10, 15, 20, 25, 30];
const reckoner: CalcBody = {
  inputs: [
    { key: "monthly", label: "Monthly SIP (₹)", type: "money", default: 10000 },
    { key: "ratePct", label: "Assumed return (% p.a.)", type: "percent", default: 12 },
    { key: "stepUpPct", label: "Step-up % every year", type: "percent", default: 10 },
    { key: "stepUpAmount", label: "Step-up amount/yr (₹)", type: "money", default: 2000 },
    ...RECKONER_PERIODS.map((p, i): InputSpec => ({
      key: `period${i + 1}`,
      label: `#${i + 1}`,
      type: "years",
      default: p,
      ...(i === 0 ? { section: "Timeframes to compare (years)" } : {}),
      ...(i === RECKONER_PERIODS.length - 1
        ? { hint: "Set a timeframe to 0 to drop it. Set step-up % or step-up ₹ to 0 to hide that column." }
        : {}),
    })),
    { key: "precision", label: "Figures shown", type: "segmented", default: "thousand", options: opts([["thousand", "Nearest ₹1,000"], ["exact", "Exact rupees"]]) },
  ],
  compute: (v) => {
    const stepUpPct = nn(v.stepUpPct);
    const stepUpAmount = nn(v.stepUpAmount);
    const periods = RECKONER_PERIODS.map((_, i) => nn(v[`period${i + 1}`]));
    const result = computeReckoner({ monthly: nn(v.monthly), ratePct: nn(v.ratePct), periods, stepUpPct, stepUpAmount });

    const strategyCols: Array<{ key: "regular" | "stepPct" | "stepAmt"; label: string }> = [
      { key: "regular", label: "Regular SIP" },
      ...(result.hasStepPct ? [{ key: "stepPct" as const, label: `Step-up ${fmtPct(stepUpPct)}/yr` }] : []),
      ...(result.hasStepAmt ? [{ key: "stepAmt" as const, label: `Step-up ${inr(stepUpAmount)}/yr` }] : []),
    ];
    const show = (x: number) => inr(v.precision === "thousand" ? roundToThousand(x) : x);
    const head = ["Timeframe", ...strategyCols.map((c) => c.label)];
    const corpusRows = result.rows.map((r) => [`${r.years} yrs`, ...strategyCols.map((c) => (r[c.key] ? show(r[c.key]!.corpus) : "—"))]);
    const investedRows = result.rows.map((r) => [`${r.years} yrs`, ...strategyCols.map((c) => (r[c.key] ? show(r[c.key]!.invested) : "—"))]);

    const out: ResultBlock[] = [section("1. Projected corpus by strategy"), table(head, corpusRows)];
    if (v.precision === "thousand") out.push(note("Every figure is rounded to the nearest ₹1,000."));
    if (result.hasStepPct || result.hasStepAmt) {
      out.push(insight("Increasing your SIP every year — even modestly — compounds into far greater wealth than a flat SIP over long horizons.", "success"));
    }
    out.push(
      section("2. Total amount invested"),
      table(head, investedRows),
      insight("Step-up strategies invest more over time (rising with income), which is why their corpus pulls ahead.", "brand"),
    );
    return out;
  },
};

/** CalculatorsApp.tsx GrowingSipCalc — Step-up SIP vs Regular SIP (growingSipSchedule). */
const growing: CalcBody = {
  inputs: [
    { key: "sip", label: "Monthly SIP (₹)", type: "money", default: 100000 },
    { key: "returnPct", label: "Expected return (% p.a.)", type: "percent", default: 14 },
    { key: "growthPct", label: "Annual step-up (%)", type: "percent", default: 10 },
    { key: "years", label: "Years", type: "years", default: 20 },
  ],
  compute: (v) => {
    const years = nn(v.years);
    const { regular, growing: grow } = growingSipSchedule({
      monthlySip: nn(v.sip),
      annualReturnPct: nn(v.returnPct),
      annualGrowthPct: nn(v.growthPct),
      years: Math.min(40, Math.max(1, years)),
    });
    const rLast = regular[regular.length - 1];
    const gLast = grow[grow.length - 1];
    const span = rLast?.year ?? years;
    const advantage = (gLast?.fv ?? 0) - (rLast?.fv ?? 0);
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    return [
      stat(`Regular SIP corpus (${span}y)`, inr(rLast?.fv ?? 0)),
      stat(`Growing SIP corpus (${span}y)`, inr(gLast?.fv ?? 0), "success"),
      stat("Extra from step-up", inr(advantage), "success"),
      stat("Invested — regular", inr(rLast?.invested ?? 0)),
      stat("Invested — growing", inr(gLast?.invested ?? 0)),
      stat("Growing — profit % of cost", pct(gLast?.profitPctOfCorpus ?? 0), "success"),
      table(
        ["Year", "Regular SIP · Corpus", "Regular SIP · Invested", "Regular SIP · Profit %", "Growing SIP · Corpus", "Growing SIP · Invested", "Growing SIP · Profit %"],
        regular.map((rr, idx) => {
          const gg = grow[idx];
          return [`${rr.year}`, inrCompact(rr.fv), inrCompact(rr.invested), pct(rr.profitPctOfCorpus), inrCompact(gg.fv), inrCompact(gg.invested), pct(gg.profitPctOfCorpus)];
        }),
      ),
      note("Profit % = (corpus − amount invested) ÷ amount invested. The growing SIP invests more over time, so its corpus is far larger; a flat SIP can show a higher profit-% only because its cost base is smaller."),
    ];
  },
};

/** SalaryWealthBuilder.tsx — Salary-Linked Wealth Builder (computeSalaryWealth). */
const salary: CalcBody = {
  inputs: [
    { key: "mode", label: "I want to find", type: "segmented", default: "wealth", options: opts([["wealth", "Wealth Creation"], ["saving", "Saving Required"]]) },
    { key: "targetWealth", label: "Target wealth (₹)", type: "money", default: 100000000, visibleIf: (v) => v.mode === "saving" },
    { key: "currentAge", label: "Current age (yrs)", type: "years", default: 32 },
    { key: "retirementAge", label: "Retirement age (yrs)", type: "years", default: 60 },
    { key: "currentMonthlySalary", label: "Current monthly salary (₹)", type: "money", default: 120000 },
    { key: "sipPctOfSalary", label: "SIP — % of monthly salary", type: "percent", default: 10, visibleIf: (v) => v.mode !== "saving" },
    { key: "annualIncrementPct", label: "Annual salary increment (%)", type: "percent", default: 8 },
    { key: "investTillAge", label: "Investment till age (yrs)", type: "years", default: 60 },
    { key: "assumedReturnPct", label: "Assumed rate of return (%)", type: "percent", default: 12 },
    { key: "includeExisting", label: "Include existing investment?", type: "toggle", default: true },
    { key: "existingInvestment", label: "Existing investment (₹)", type: "money", default: 600000, visibleIf: (v) => !!v.includeExisting },
    { key: "existingReturnPct", label: "Return on it (%)", type: "percent", default: 12, visibleIf: (v) => !!v.includeExisting },
  ],
  compute: (v) => {
    const mode: SalaryWealthMode = v.mode === "saving" ? "saving" : "wealth";
    const includeExisting = !!v.includeExisting;
    const retirementAge = nn(v.retirementAge);
    const investTillAge = nn(v.investTillAge);
    const assumedReturnPct = nn(v.assumedReturnPct);
    const result = computeSalaryWealth({
      mode,
      currentAge: nn(v.currentAge),
      retirementAge,
      currentMonthlySalary: nn(v.currentMonthlySalary),
      sipPctOfSalary: nn(v.sipPctOfSalary),
      annualIncrementPct: nn(v.annualIncrementPct),
      investTillAge,
      assumedReturnPct,
      includeExisting,
      existingInvestment: nn(v.existingInvestment),
      existingReturnPct: nn(v.existingReturnPct),
      targetWealth: nn(v.targetWealth),
    });

    const out: ResultBlock[] = [];
    if (mode === "saving") {
      out.push(
        stat("Starting monthly SIP needed", inr(result.requiredMonthlySip ?? 0), "success"),
        stat("As % of monthly salary", Number.isFinite(result.requiredSipPct ?? 0) ? `${(result.requiredSipPct ?? 0).toFixed(2)}%` : "—", "warning"),
        stat("Target wealth", inr(result.targetWealth ?? 0)),
        stat(`New investment till age ${investTillAge}`, inr(result.newInvestment)),
        stat("Or one-time lumpsum today", inr(result.requiredLumpsumToday ?? NaN), "success"),
        stat("Left invested for", `${result.totalYears} yrs, till age ${retirementAge}`),
        note(`Instead of a starting SIP of ${inr(result.requiredMonthlySip ?? NaN)} rising with the salary, a one-time lumpsum of ${inr(result.requiredLumpsumToday ?? NaN)} invested today at ${assumedReturnPct}% reaches the ${inr(result.targetWealth ?? 0)} target by age ${retirementAge}${includeExisting ? ", together with the existing investment" : ""}.`),
      );
    } else {
      out.push(
        stat("Total salary received", inr(result.totalSalaryReceived)),
        stat("New investment through SIP", inr(result.newInvestment)),
        stat("Wealth from the SIP", inr(result.sipWealth), "success"),
        stat("Wealth from existing investment", includeExisting ? inr(result.existingFutureValue) : "—"),
        stat(`Total wealth at ${retirementAge}`, inr(result.wealth), "success"),
        stat("Starting monthly SIP", inr(result.monthlySip), "warning"),
      );
      if (Number.isFinite(result.pctToMatchSalary) && result.totalSalaryReceived > 0) {
        out.push(note(`To build, through the SIP alone, as much as the ${inr(result.totalSalaryReceived)} of salary received, invest about ${result.pctToMatchSalary.toFixed(2)}% of the monthly salary (rising with it) until age ${investTillAge}.`));
      }
    }

    out.push(
      stat("Investing period", `${result.sipYears} yrs${result.holdYears > 0 ? ` + ${result.holdYears}y hold` : ""}`),
      stat("First → last monthly SIP", `${inr(result.monthlySip)} → ${inr(result.lastMonthlySip)}`),
      ...(includeExisting ? [stat("Existing fund grows to", inr(result.existingFutureValue))] : []),
      stat("SIP corpus alone", inr(result.wealth - result.existingFutureValue)),
    );

    if (result.schedule.length > 0) {
      out.push(
        section(`Year-by-year growth (${result.schedule.length} years)`),
        table(
          ["Age", "Monthly SIP", "Invested that year", "Corpus at year end"],
          result.schedule.map((row) => [
            `${row.age}${row.phase === "hold" ? " (hold)" : ""}`,
            row.monthlySipThatYear > 0 ? inr(row.monthlySipThatYear) : "—",
            row.investedThisYear > 0 ? inr(row.investedThisYear) : "—",
            inr(row.endCorpus),
          ]),
        ),
        note(`Corpus shown is the SIP investment only${includeExisting ? "; the existing fund grows separately to the figure above." : "."}`),
      );
    }
    out.push(note("* Illustration only. Assumes the SIP rises in step with your salary increment and a constant rate of return; actual results vary with market performance. Not investment advice."));
    return out;
  },
};

/** FvAnnualLumpsumPlanner.tsx — Future Value of Annual Lumpsum (computeFvAnnualLumpsum). */
const fvannual: CalcBody = {
  inputs: [
    { key: "annualInvestment", label: "Annual lumpsum investment (₹)", type: "money", default: 500000 },
    { key: "investmentYears", label: "Investment period (years)", type: "years", default: 15 },
    { key: "paymentYears", label: "Payment period (years)", type: "years", default: 10, hint: "Years you actually invest. After this, the corpus just keeps growing." },
    { key: "scenario1Pct", label: "Scenario 1 return (% p.a.)", type: "percent", default: 12 },
    { key: "scenario2Pct", label: "Scenario 2 return (% p.a., optional)", type: "percent", default: 0 },
  ],
  compute: (v) => {
    const investmentYears = nn(v.investmentYears);
    const paymentYears = nn(v.paymentYears);
    const scenario2Pct = nn(v.scenario2Pct);
    const result = computeFvAnnualLumpsum({
      annualInvestment: nn(v.annualInvestment),
      investmentYears,
      paymentYears,
      scenario1Pct: nn(v.scenario1Pct),
      scenario2Pct: scenario2Pct > 0 ? scenario2Pct : null,
    });
    const s1 = result.scenario1;
    const s2 = result.scenario2;
    const out: ResultBlock[] = [];
    if (paymentYears > investmentYears) {
      out.push(insight(`Payment period is longer than the investment period — contributions are capped at the investment period (${investmentYears} years).`, "warning"));
    }
    out.push(
      stat("Total invested", inr(s1.totalInvested)),
      stat(`Future value @ ${s1.ratePct.toFixed(2)}%`, inr(s1.futureValue), "success"),
      stat("Wealth gain", inr(s1.wealthGain), "success"),
      ...(s2 ? [stat(`Future value @ ${s2.ratePct.toFixed(2)}%`, inr(s2.futureValue), "warning")] : []),
    );
    if (s2) {
      out.push(note(`Difference between scenarios: ${inr(Math.abs(s2.futureValue - s1.futureValue))} (${s2.ratePct > s1.ratePct ? "Scenario 2 higher" : "Scenario 1 higher"}).`));
    }
    if (s1.schedule.length > 0) {
      out.push(
        section(`Projected annual investment value (${s1.schedule.length} years)`),
        table(
          ["Year", "Annual investment", `Year-end @ ${s1.ratePct.toFixed(2)}%`, ...(s2 ? [`Year-end @ ${s2.ratePct.toFixed(2)}%`] : [])],
          s1.schedule.map((row, i) => [
            `${row.year}`,
            row.year <= paymentYears ? inr(row.investment) : "—",
            inr(row.yearEndValue),
            ...(s2 ? [inr(s2.schedule[i]?.yearEndValue ?? 0)] : []),
          ]),
        ),
      );
    }
    out.push(note("* Illustration only. Each year's investment is assumed made at the start of the year and compounded annually at the assumed return. Figures are approximate; returns are neither indicative nor guaranteed. Not investment advice."));
    return out;
  },
};

/** AnnualLumpsumRequiredCalculator.tsx — Annual Lumpsum for Target Future Value
 *  (computeAnnualLumpsumRequired). */
const annualreq: CalcBody = {
  inputs: [
    { key: "targetAmount", label: "Target amount (₹)", type: "money", default: 2500000 },
    { key: "investmentYears", label: "Investment period (yrs)", type: "years", default: 10 },
    { key: "paymentYears", label: "Payment period (yrs)", type: "years", default: 10 },
    { key: "scenario1Pct", label: "Scenario 1 return (%)", type: "percent", default: 12 },
    { key: "useScenario2", label: "Compare scenario 2", type: "toggle", default: false },
    { key: "scenario2Pct", label: "Scenario 2 return (%)", type: "percent", default: 10, visibleIf: (v) => !!v.useScenario2 },
  ],
  compute: (v) => {
    const targetAmount = nn(v.targetAmount);
    const investmentYears = nn(v.investmentYears);
    const paymentYears = nn(v.paymentYears);
    const result = computeAnnualLumpsumRequired({
      targetAmount, investmentYears, paymentYears,
      scenario1Pct: nn(v.scenario1Pct), scenario2Pct: v.useScenario2 ? nn(v.scenario2Pct) : null,
    });
    const s1 = result.scenario1;
    const s2 = result.scenario2;
    const deferred = paymentYears < investmentYears;

    const out: ResultBlock[] = [
      stat(`Required / yr @ ${fmtPct(s1.ratePct)}`, inr(s1.requiredAnnual), "brand"),
      stat(`Total invested @ ${fmtPct(s1.ratePct)}`, inr(s1.totalInvested)),
      ...(s2
        ? [
          stat(`Required / yr @ ${fmtPct(s2.ratePct)}`, inr(s2.requiredAnnual), "success"),
          stat(`Total invested @ ${fmtPct(s2.ratePct)}`, inr(s2.totalInvested)),
        ]
        : [stat("Wealth gain", inr(s1.wealthGain), "success")]),
    ];
    if (Number.isFinite(s1.requiredAnnual)) {
      const second = s2 ? ` At ${fmtPct(s2.ratePct)} the requirement ${s2.requiredAnnual < s1.requiredAnnual ? "drops" : "rises"} to ${inr(s2.requiredAnnual)}/year.` : "";
      out.push(insight(`To reach ${inr(targetAmount)} in ${investmentYears} years${deferred ? ` (investing for the first ${paymentYears})` : ""} at ${fmtPct(s1.ratePct)}, invest about ${inr(s1.requiredAnnual)}/year.${second}`, "brand"));
    }
    out.push(
      section(s2 ? "1. Projected annual investment value" : `1. Projected annual investment value @ ${fmtPct(s1.ratePct)}`),
      table(
        [
          "Year",
          s2 ? `Investment @ ${fmtPct(s1.ratePct)}` : "Investment",
          `Year-end value @ ${fmtPct(s1.ratePct)}`,
          ...(s2 ? [`Investment @ ${fmtPct(s2.ratePct)}`, `Year-end value @ ${fmtPct(s2.ratePct)}`] : []),
        ],
        s1.schedule.map((r, i) => {
          const paying = r.year <= paymentYears;
          const r2 = s2?.schedule[i];
          return [
            `${r.year}`,
            paying ? inr(r.investment) : "—",
            inr(r.yearEndValue),
            ...(s2 && r2 ? [paying ? inr(r2.investment) : "—", inr(r2.yearEndValue)] : []),
          ];
        }),
        true,
      ),
    );
    return out;
  },
};

/** LumpsumSipFvCalculator.tsx — Future Value of Lumpsum + SIP (lumpsumPlusSipFv). */
const sip: CalcBody = {
  inputs: [
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 15000 },
    { key: "sipPct", label: "SIP return (%)", type: "percent", default: 15 },
    { key: "lumpsum", label: "Lumpsum today (₹)", type: "money", default: 1000000 },
    { key: "lumpsumPct", label: "Lumpsum return (%)", type: "percent", default: 12 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 10 },
    reportInput(),
  ],
  compute: (v) => {
    const sipPct = nn(v.sipPct);
    const lumpsumPct = nn(v.lumpsumPct);
    const res = lumpsumPlusSipFv({ monthlySip: nn(v.monthlySip), sipPct, lumpsum: nn(v.lumpsum), lumpsumPct, years: nn(v.years) });
    const out: ResultBlock[] = [
      stat("Total invested", inr(res.invested)),
      stat(`SIP value @ ${fmtPct(sipPct)}`, inr(res.sipFv)),
      stat(`Lumpsum value @ ${fmtPct(lumpsumPct)}`, inr(res.lumpsumFv)),
      stat("Total future value", inr(res.total), "brand"),
    ];
    if (res.years > 0 && res.total > 0) {
      out.push(insight(`Over ${res.years} years the SIP builds ${inr(res.sipFv)} and the lumpsum grows to ${inr(res.lumpsumFv)} — ${inr(res.total)} in all from ${inr(res.invested)} put in.`, "brand"));
    }
    if (v.view === "detailed" && res.rows.length > 0) {
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

/** CalculatorsApp.tsx CagrCalc — CAGR Return Calculator (cagrCalculate). */
const cagr: CalcBody = {
  inputs: [
    { key: "initialValue", label: "Initial value (₹)", type: "money", default: 100000 },
    { key: "finalValue", label: "Current/Final value (₹)", type: "money", default: 250000 },
    { key: "years", label: "Duration (years)", type: "years", default: 5 },
  ],
  compute: (v) => {
    const initialValue = nn(v.initialValue);
    const finalValue = nn(v.finalValue);
    const years = nn(v.years);
    const res = cagrCalculate({ initialValue, finalValue, years });
    // cagrCalculate returns 0% when there is no base value or period — show "—".
    const hasBase = initialValue > 0;
    const hasCagr = hasBase && years > 0;
    return [
      stat("Absolute return", hasBase ? `${res.absoluteReturnPct.toFixed(2)}%` : "—", !hasBase ? undefined : res.absoluteReturnPct >= 0 ? "success" : "danger"),
      stat("CAGR return", hasCagr ? `${res.cagrPct.toFixed(2)}% p.a.` : "—", !hasCagr ? undefined : res.cagrPct >= 0 ? "success" : "danger"),
      stat("Absolute wealth gain", inr(finalValue - initialValue), finalValue >= initialValue ? "success" : "danger"),
    ];
  },
};

/** LumpsumFvCalculator.tsx — Future Value of a Lumpsum (lumpsumFv). */
const lumpsumfv: CalcBody = {
  inputs: [
    { key: "amount", label: "One-time investment (₹)", type: "money", default: 500000 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 10 },
    ...scenarioInputs(15, 12, true),
    reportInput(),
  ],
  compute: (v) => {
    const amount = nn(v.amount);
    const rates = ratesOf(v).map(nn);
    const res = lumpsumFv({ amount, years: nn(v.years), ratesPct: rates });
    const out: ResultBlock[] = [
      stat("Invested today", inr(res.invested)),
      stat("Period", `${res.years} yrs`),
      ...rates.map((r, i) => stat(`Future value @ ${fmtPct(r)}`, inr(res.fv[i]), i === 0 ? "brand" : "success")),
    ];
    if (res.years > 0 && amount > 0) {
      const second = rates.length > 1 ? ` At ${fmtPct(rates[1])} it would be ${inr(res.fv[1])}.` : "";
      out.push(insight(`Left untouched, ${inr(amount)} becomes ${inr(res.fv[0])} in ${res.years} years at ${fmtPct(rates[0])} — about ${(res.fv[0] / amount).toFixed(1)}× the money put in.${second}`, "brand"));
    }
    if (v.view === "detailed" && res.rows.length > 0) {
      out.push(
        section("1. Value at the end of each year"),
        table(
          ["Year", "Investment", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)],
          res.rows.map((r) => [`${r.year}`, r.investment > 0 ? inr(r.investment) : "—", ...r.values.map((x) => inr(x))]),
          true,
        ),
      );
    }
    return out;
  },
};

/** StepUpSipFvCalculator.tsx — Future Value of a Step-Up SIP (stepUpSipFv). */
const stepupfv: CalcBody = {
  inputs: [
    { key: "monthly", label: "Starting monthly SIP (₹)", type: "money", default: 10000 },
    { key: "stepUpPct", label: "Step-up every year (%)", type: "percent", default: 10 },
    { key: "years", label: "SIP period (yrs)", type: "years", default: 20 },
    ...scenarioInputs(12, 15, true),
    reportInput(),
  ],
  compute: (v) => {
    const monthly = nn(v.monthly);
    const stepUpPct = nn(v.stepUpPct);
    const rates = ratesOf(v).map(nn);
    const res = stepUpSipFv({ monthly, stepUpPct, years: nn(v.years), ratesPct: rates });
    const n = res.rows.length;
    const lastMonthly = n > 0 ? res.rows[n - 1].monthly : monthly;
    const out: ResultBlock[] = [
      stat("Total invested", inr(res.invested)),
      stat("Monthly SIP in the last year", inr(lastMonthly)),
      ...rates.map((r, i) => stat(`Future value @ ${fmtPct(r)}`, inr(res.fv[i]), i === 0 ? "brand" : "success")),
    ];
    if (n > 0 && monthly > 0) {
      const second = rates.length > 1 ? ` or ${inr(res.fv[1])} at ${fmtPct(rates[1])}` : "";
      out.push(insight(`Starting at ${inr(monthly)} and rising ${fmtPct(stepUpPct)} each year to ${inr(lastMonthly)}, the SIP puts in ${inr(res.invested)} and could grow to ${inr(res.fv[0])} at ${fmtPct(rates[0])}${second}.`, "brand"));
    }
    if (v.view === "detailed" && n > 0) {
      out.push(
        section("1. Year-wise instalments and value"),
        table(
          ["Year", "Monthly SIP", "Invested in year", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)],
          res.rows.map((r) => [`${r.year}`, inr(r.monthly), inr(r.annual), ...r.values.map((x) => inr(x))]),
          true,
        ),
      );
    }
    return out;
  },
};

/** LimitedSipFvCalculator.tsx — Future Value of a Limited-Period SIP (limitedSipFv). */
const limitedfv: CalcBody = {
  inputs: [
    { key: "monthly", label: "Monthly SIP (₹)", type: "money", default: 5000 },
    { key: "sipYears", label: "SIP period (yrs)", type: "years", default: 5 },
    { key: "deferYears", label: "Stay invested after the SIP (yrs)", type: "years", default: 10 },
    ...scenarioInputs(12, 15, true),
    reportInput(),
  ],
  compute: (v) => {
    const monthly = nn(v.monthly);
    const rates = ratesOf(v).map(nn);
    const res = limitedSipFv({ monthly, sipYears: nn(v.sipYears), deferYears: nn(v.deferYears), ratesPct: rates });
    const total = res.sipYears + res.deferYears;
    const out: ResultBlock[] = [
      stat("Total invested", inr(res.invested)),
      stat("Total period", `${total} yrs`),
      ...rates.map((r, i) => stat(`Value after ${total} yrs @ ${fmtPct(r)}`, inr(res.fv[i]), i === 0 ? "brand" : "success")),
    ];
    if (res.sipYears > 0 && monthly > 0) {
      const second = rates.length > 1 ? ` or ${inr(res.fv[1])} at ${fmtPct(rates[1])}` : "";
      out.push(insight(`Instalments stop after ${res.sipYears} years (${inr(res.invested)} in all), yet the money keeps compounding for ${res.deferYears} more — reaching ${inr(res.fv[0])} at ${fmtPct(rates[0])}${second}.`, "brand"));
    }
    if (v.view === "detailed" && res.rows.length > 0) {
      out.push(
        section("1. Year-wise value"),
        table(
          ["Year", "Monthly SIP", "Invested in year", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)],
          res.rows.map((r) => [
            `${r.year}`,
            r.monthly > 0 ? inr(r.monthly) : "—",
            r.annual > 0 ? inr(r.annual) : "—",
            ...r.values.map((x) => inr(x)),
          ]),
          true,
        ),
      );
    }
    return out;
  },
};

/** SipStpFutureValueCalculator.tsx — Future Value of SIP + STP (computeSipStpFv);
 *  the year-wise table is StpParts.tsx SipStpYearTable. */
const sipstp: CalcBody = {
  inputs: [
    { key: "monthlySip", label: "Monthly SIP (₹)", type: "money", default: 10000 },
    { key: "sipRatePct", label: "SIP fund return (% p.a.)", type: "percent", default: 12 },
    { key: "years", label: "Investment period (yrs)", type: "years", default: 15 },
    { key: "stpLumpsum", label: "STP lumpsum in debt fund (₹)", type: "money", default: 1000000 },
    { key: "debtPct", label: "Debt fund return (% p.a.)", type: "percent", default: 5 },
    { key: "equityPct", label: "Equity fund return (% p.a.)", type: "percent", default: 12 },
    { key: "detailed", label: "Show year-wise table", type: "toggle", default: true },
  ],
  compute: (v) => {
    const monthlySip = nn(v.monthlySip);
    const stpLumpsum = nn(v.stpLumpsum);
    const years = nn(v.years);
    const r = computeSipStpFv({ monthlySip, sipRatePct: nn(v.sipRatePct), stpLumpsum, debtPct: nn(v.debtPct), equityPct: nn(v.equityPct), years });
    const out: ResultBlock[] = [
      note(`Monthly transfer: capital appreciation — only the debt fund's gain moves to equity (${inr(r.monthlyTransfer)} a month), so the lumpsum itself stays in debt.`),
      stat("SIP fund value", inr(r.sipValue)),
      stat("STP debt fund value", inr(r.stpDebtValue)),
      stat("STP equity fund value", inr(r.stpEquityValue)),
      stat("Total value", inr(r.total), "brand"),
    ];
    if (years > 0) {
      out.push(insight(`Investing ${inr(r.totalInvested)} in all — ${inr(monthlySip)} a month plus ${inr(stpLumpsum)} up front — could grow to ${inr(r.total)} in ${years} years.`, "brand"));
    }
    if (v.detailed && r.rows.length > 0) {
      out.push(
        section("1. Year-wise investment and value"),
        table(
          ["Year", "Invested in the year", "Invested to date", "SIP fund", "STP fund", "Total"],
          r.rows.map((x) => [`${x.year}`, inr(x.annualInvestment), inr(x.cumulativeInvestment), inr(x.sipValue), inr(x.stpValue), inr(x.total)]),
          true,
        ),
      );
    }
    out.push(note("* Illustration only, at an effective monthly rate for each fund. Not investment advice."));
    return out;
  },
};

/** CompoundingCalculator.tsx — Compound Interest (compounding). */
const FREQ_LABEL: Record<CompoundFrequency, string> = {
  yearly: "Yearly",
  half_yearly: "Half-yearly",
  quarterly: "Quarterly",
  monthly: "Monthly",
  daily: "Daily",
};
const ADD_LABEL: Record<AdditionFrequency, string> = {
  monthly: "Every month",
  quarterly: "Every quarter",
  half_yearly: "Every half-year",
  yearly: "Every year",
};
const own = (o: object, k: unknown): boolean => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const compoundingDef: CalcBody = {
  inputs: [
    { key: "principal", label: "Principal (₹)", type: "money", default: 100000 },
    { key: "rate", label: "Interest rate (% a year)", type: "percent", default: 8 },
    { key: "years", label: "Period (years)", type: "years", default: 10 },
    { key: "frequency", label: "Compounded", type: "select", default: "quarterly", options: opts(Object.entries(FREQ_LABEL)) },
    { key: "addition", label: "Regular addition (₹, optional)", type: "money", default: 0 },
    { key: "addFreq", label: "Added", type: "select", default: "monthly", options: opts(Object.entries(ADD_LABEL)), visibleIf: (v) => nn(v.addition) > 0 },
    { key: "timing", label: "Addition made at the", type: "segmented", default: "end", options: opts([["start", "Start of the period"], ["end", "End of the period"]]), visibleIf: (v) => nn(v.addition) > 0 },
  ],
  compute: (v) => {
    const principal = nn(v.principal);
    const rate = nn(v.rate);
    const years = Math.round(nn(v.years)); // the web rounds the period as it is typed
    const frequency: CompoundFrequency = own(FREQ_LABEL, v.frequency) ? v.frequency : "quarterly";
    const addFreq: AdditionFrequency = own(ADD_LABEL, v.addFreq) ? v.addFreq : "monthly";
    const timing: "start" | "end" = v.timing === "start" ? "start" : "end";
    const res = compounding({ principal, ratePct: rate, years, frequency, addition: nn(v.addition), additionFrequency: addFreq, additionTiming: timing });
    const out: ResultBlock[] = [
      stat("Amount invested", inr(res.invested)),
      stat("Interest earned", inr(res.interest), "success"),
      stat(`Value after ${years} yrs`, inr(res.total), "brand"),
      stat("Effective annual rate", `${res.effectiveRatePct.toFixed(2)}%`),
    ];
    if (res.total > 0 && years > 0) {
      const daily = frequency !== "yearly"
        ? ` Compounded only once a year it would earn ${fmtPct(rate)} flat; daily compounding would give ${effectiveAnnualRate(rate, COMPOUND_PERIODS.daily).toFixed(2)}%.`
        : "";
      out.push(insight(`${fmtPct(rate)} compounded ${FREQ_LABEL[frequency].toLowerCase()} works out to ${res.effectiveRatePct.toFixed(2)}% a year, so ${inr(res.invested)} grows to ${inr(res.total)} in ${years} years.${daily}`, "brand"));
    }
    if (res.rows.length > 0) {
      out.push(
        section("1. Growth year by year"),
        table(
          ["Year", "Amount invested", "Interest this year", "Interest to date", "Total value"],
          res.rows.map((r) => [`${r.year}`, inr(r.invested), inr(r.interestThisYear), inr(r.interest), inr(r.total)]),
          true,
        ),
        note("Value = principal × (1 + rate ÷ n)^(n × years), n = compounding periods a year (365 for daily). An addition between compounding dates grows for the fraction of the period it is held, as banks reckon recurring deposits."),
      );
    }
    return out;
  },
};

export const DEFS: Record<string, CalcBody> = {
  sip360, reckoner, growing, salary, fvannual, annualreq, sip, cagr, lumpsumfv, sipfv, stepupfv, limitedfv, sipstp,
  compounding: compoundingDef,
};
