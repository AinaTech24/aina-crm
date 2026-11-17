"use client";

/**
 * Income Bridge Planner (SIP → SWP) — "Monthly SWP for SIP".
 *
 * Two-phase plan: accumulate a corpus (stepped-up SIP / lumpsum / salary-based),
 * optionally hold it for some years, then draw a monthly income (SWP) that can
 * rise with inflation until a chosen age, leaving a target end balance behind.
 * Up to two scenarios, each a pair of returns (building / withdrawing).
 *
 * Works in two directions:
 *   • "How much income?"   — solve the sustainable monthly SWP from a plan.
 *   • "How much to invest?" — back out the SIP / lumpsum needed for a target SWP.
 *
 * Math lives in @/lib/calculators/income-bridge (verified to the rupee — SIP
 * ₹10,000 × 25y @12% → ₹1,70,22,066; SWP 25y @9% leaving ₹1 cr → ₹1,29,323/mo).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeIncomeBridge,
  type CalcType,
  type InvestMode,
  type PlanningType,
} from "@/lib/calculators/income-bridge";
import { inr, fmtPct, NumberField, Field, TextField, Segmented, Toggle, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

const CALC_TYPES: { value: CalcType; label: string }[] = [
  { value: "monthly_swp", label: "How much monthly income?" },
  { value: "investment_need", label: "How much to invest?" },
];

const INVEST_MODES: { value: InvestMode; label: string }[] = [
  { value: "sip", label: "SIP" },
  { value: "lumpsum", label: "Lumpsum" },
  { value: "lumpsum_sip", label: "Lumpsum + SIP" },
  { value: "salary", label: "Salary %" },
];

const PLANNING_TYPES: { value: PlanningType; label: string }[] = [
  { value: "retirement", label: "Retirement Planning" },
  { value: "invest_now_withdraw_later", label: "Invest Now, Withdraw Later" },
];

export function IncomeBridgePlanner() {
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");

  const [calcType, setCalcType] = useState<CalcType>("monthly_swp");
  const [investMode, setInvestMode] = useState<InvestMode>("sip");
  const [planningType, setPlanningType] = useState<PlanningType>("retirement");

  // Accumulation
  const [startAge, setStartAge] = useState(35);
  const [sipTillAge, setSipTillAge] = useState(60);
  const [retirementAge, setRetirementAge] = useState(60);
  const [monthlySip, setMonthlySip] = useState(10000);
  const [topUpPct, setTopUpPct] = useState(0);
  const [lumpsum, setLumpsum] = useState(1000000);
  const [monthlySalary, setMonthlySalary] = useState(150000);
  const [savingsPct, setSavingsPct] = useState(20);
  const [salaryGrowthPct, setSalaryGrowthPct] = useState(8);
  const [accumReturnPct, setAccumReturnPct] = useState(12);

  // Distribution
  const [swpTillAge, setSwpTillAge] = useState(85);
  const [distReturnPct, setDistReturnPct] = useState(9);
  const [distInflationPct, setDistInflationPct] = useState(0);
  const [endBalance, setEndBalance] = useState(10000000);
  const [desiredMonthlySwp, setDesiredMonthlySwp] = useState(50000);

  // Scenario 2 — a second pair of returns
  const [useS2, setUseS2] = useState(false);
  const [accum2, setAccum2] = useState(10);
  const [dist2, setDist2] = useState(8);

  const usesSip = investMode === "sip" || investMode === "lumpsum_sip";
  const usesLump = investMode === "lumpsum" || investMode === "lumpsum_sip";
  const isSalary = investMode === "salary";
  const isReverse = calcType === "investment_need";

  const scenarios = useMemo(() => {
    const run = (accum: number, dist: number) =>
      computeIncomeBridge({
        calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge,
        monthlySip, topUpPct, lumpsum, monthlySalary, savingsPct, salaryGrowthPct,
        accumReturnPct: accum, distReturnPct: dist, distInflationPct, endBalance, desiredMonthlySwp,
      });
    const first = { accum: accumReturnPct, dist: distReturnPct, result: run(accumReturnPct, distReturnPct) };
    return useS2 ? [first, { accum: accum2, dist: dist2, result: run(accum2, dist2) }] : [first];
  }, [
    calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge,
    monthlySip, topUpPct, lumpsum, monthlySalary, savingsPct, salaryGrowthPct,
    accumReturnPct, distReturnPct, distInflationPct, endBalance, desiredMonthlySwp, useS2, accum2, dist2,
  ]);

  const result = scenarios[0].result;
  const tag = (s: (typeof scenarios)[number]) => (scenarios.length > 1 ? ` @ ${fmtPct(s.accum)} / ${fmtPct(s.dist)}` : "");

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Income Bridge Planner · SIP → SWP</h2>
      </div>

      {/* Step 1 — what to calculate */}
      <div className="flex flex-wrap gap-4">
        <Segmented label="I want to find" value={calcType} onChange={setCalcType} options={CALC_TYPES} />
        <Segmented label="Build my corpus with" value={investMode} onChange={setInvestMode} options={INVEST_MODES} />
        <Segmented label="Planning type" value={planningType} onChange={setPlanningType} options={PLANNING_TYPES} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Client name (optional)">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <TextField label="Objective" value={objective} setValue={setObjective} placeholder="e.g. Retirement income" />
      </div>

      {/* Inputs — two phases */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/70 p-4 space-y-3">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">① Accumulation — build the corpus</div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Current age (investment start)" value={startAge} setValue={setStartAge} step={1} />
            {(usesSip || isSalary) && <NumberField label="SIP till age" value={sipTillAge} setValue={setSipTillAge} step={1} />}
            <NumberField label="SWP starts at age" value={retirementAge} setValue={setRetirementAge} step={1} />
            <NumberField label="Return — accumulation (% p.a.)" value={accumReturnPct} setValue={setAccumReturnPct} step={0.5} />

            {isSalary ? (
              <>
                <NumberField label="Monthly salary (₹)" value={monthlySalary} setValue={setMonthlySalary} />
                <NumberField label="Save / invest (% of salary)" value={savingsPct} setValue={setSavingsPct} step={1} />
                <NumberField label="Annual salary growth (%)" value={salaryGrowthPct} setValue={setSalaryGrowthPct} step={1} />
              </>
            ) : (
              <>
                {usesSip && !isReverse && <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} />}
                {usesSip && <NumberField label="SIP top-up every year (%)" value={topUpPct} setValue={setTopUpPct} step={1} />}
                {usesLump && <NumberField label="Lumpsum today (₹)" value={lumpsum} setValue={setLumpsum} />}
              </>
            )}
          </div>
          <p className="text-2xs text-muted-foreground">
            Deferment: the corpus stays invested from the SIP&apos;s last month until the SWP starts
            ({Math.max(0, retirementAge - (usesSip || isSalary ? sipTillAge : startAge))} yrs now).
            {isReverse && <> In “How much to invest?” mode the {investMode === "lumpsum" ? "lumpsum" : "monthly SIP"} is calculated for you.</>}
          </p>
        </div>

        <div className="rounded-lg border border-border/70 p-4 space-y-3">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">② Distribution — draw the income</div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="SWP till age" value={swpTillAge} setValue={setSwpTillAge} step={1} />
            <NumberField label="Return — distribution (% p.a.)" value={distReturnPct} setValue={setDistReturnPct} step={0.5} />
            <NumberField label="Inflation — distribution (%)" value={distInflationPct} setValue={setDistInflationPct} step={0.5} />
            {isReverse && <NumberField label="Desired monthly SWP (₹)" value={desiredMonthlySwp} setValue={setDesiredMonthlySwp} />}
            <div className="col-span-2">
              <NumberField label="Balance to leave at end of SWP (₹)" value={endBalance} setValue={setEndBalance} />
              {!isReverse && (
                <p className="text-2xs text-muted-foreground mt-1">
                  Max — {inr(result.maxEndBalance)} (if you withdraw nothing). Leave ₹0 to spend it all down.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Toggle checked={useS2} onChange={setUseS2} label="Compare scenario 2" />
        {useS2 && (
          <>
            <NumberField label="Scenario 2 — accumulation (%)" value={accum2} setValue={setAccum2} step={0.5} />
            <NumberField label="Scenario 2 — distribution (%)" value={dist2} setValue={setDist2} step={0.5} />
          </>
        )}
      </div>

      {scenarios.map((s, i) =>
        s.result.warning ? <Insight key={`w-${i}`} tone="rose">{s.result.warning}{tag(s)}</Insight> : null
      )}

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-primary">{clientName}</span>{objective ? ` · ${objective}` : ""}
        </div>
      )}

      {/* Headline results, one row per scenario */}
      {scenarios.map((s, i) => {
        const r = s.result;
        return isReverse ? (
          <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={`Corpus needed at SWP start${tag(s)}`} value={inr(r.requiredCorpus ?? r.corpus)} tone="amber" />
            {investMode === "lumpsum" ? (
              <Stat label={`Lumpsum to invest today${tag(s)}`} value={inr(r.requiredLumpsum ?? 0)} tone="emerald" />
            ) : (
              <Stat label={`${isSalary ? "Monthly investment needed" : "Monthly SIP needed"}${tag(s)}`} value={inr(r.requiredMonthlySip ?? 0)} tone="emerald" />
            )}
            <Stat label="Monthly SWP (first month)" value={inr(r.monthlySwp)} />
            <Stat label={`Total withdrawal${tag(s)}`} value={inr(r.totalWithdrawn)} tone="emerald" />
          </div>
        ) : (
          <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={`Accumulated corpus${tag(s)}`} value={inr(r.corpus)} tone="amber" />
            <Stat label={`${distInflationPct > 0 ? "Monthly SWP (first month)" : "Monthly SWP"}${tag(s)}`} value={inr(r.monthlySwp)} tone="emerald" />
            <Stat label={`Total withdrawal${tag(s)}`} value={inr(r.totalWithdrawn)} tone="emerald" />
            <Stat label="Balance left at end" value={inr(r.endBalanceActual)} />
          </div>
        );
      })}

      {/* Secondary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total invested" value={inr(result.totalInvested)} />
        <Stat label="Wealth gained (accumulation)" value={inr(result.wealthGain)} />
        <Stat label="First → last monthly SWP" value={`${inr(result.monthlySwp)} → ${inr(result.lastMonthlySwp)}`} />
        {isSalary && isReverse && result.requiredSavingsPct != null ? (
          <Stat label="Required savings rate" value={`${result.requiredSavingsPct.toFixed(1)}% of salary`} />
        ) : (
          <Stat label="Phases" value={`${result.sipYears + result.holdYears}y build · ${result.distYears}y draw`} />
        )}
      </div>

      {/* Accumulation table */}
      {result.accSchedule.length > 0 && (
        <Section n={1} title="Accumulation — annual investment and year-end value">
          <CalcChart
            data={[
              ...result.accSchedule.map((r, i) => ({ age: r.age, s1: r.value, s2: scenarios[1]?.result.accSchedule[i]?.value ?? 0 })),
              ...result.schedule.map((r, i) => ({ age: r.age, s1: r.endCorpus, s2: scenarios[1]?.result.schedule[i]?.endCorpus ?? 0 })),
            ]}
            xKey="age"
            xUnit="Age"
            series={[
              { key: "s1", name: `Corpus${tag(scenarios[0])}`, color: "#0ea5e9" },
              ...(scenarios[1] ? [{ key: "s2", name: `Corpus${tag(scenarios[1])}`, color: "#10b981" }] : []),
            ]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Age", "Annual investment", ...scenarios.map((s) => `Year-end value${tag(s)}`)]}
              rows={result.accSchedule.map((r, i) => [
                `${r.age}`,
                r.invested > 0 ? inr(r.invested) : "—",
                ...scenarios.map((s) => inr(s.result.accSchedule[i]?.value ?? NaN)),
              ])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      {/* Distribution table */}
      {result.schedule.length > 0 && (
        <Section n={2} title="Distribution — monthly withdrawal and year-end value">
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={[
                "Age",
                ...scenarios.flatMap((s) => [`Monthly SWP (avg)${tag(s)}`, `Year-end value${tag(s)}`]),
                `Withdrawn that year${tag(scenarios[0])}`,
              ]}
              rows={result.schedule.map((row, i) => [
                `${row.age}`,
                ...scenarios.flatMap((s) => {
                  const r = s.result.schedule[i];
                  return [inr(r?.avgMonthlyWithdrawal ?? NaN), inr(r?.endCorpus ?? NaN)];
                }),
                inr(row.withdrawnThisYear),
              ])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        Illustration only. Figures assume constant returns and inflation; actual results vary with market performance.
        SIP paid at the start of each month; withdrawals taken at month end and raised every month with inflation ·
        effective monthly rate · the distribution table shows each year&apos;s average monthly withdrawal. Not investment advice.
      </p>
    </div>
  );
}
