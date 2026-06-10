"use client";

/**
 * 8-calculator tabbed app — Network FP "3.5 MF Investment Calculators"
 * parity. Pure client-side; uses the existing goal-planning math
 * helpers.
 */

import { useState } from "react";
import { Printer } from "lucide-react";
import { ClientNameField } from "./ClientNameField";
import { Sip360Planner } from "./Sip360Planner";
import { StepUpReckoner } from "./StepUpReckoner";
import { IncomeBridgePlanner } from "./IncomeBridgePlanner";
import { SalaryWealthBuilder } from "./SalaryWealthBuilder";
import { CashflowCorpusPlanner } from "./CashflowCorpusPlanner";
import { PropertyYieldCalculator } from "./PropertyYieldCalculator";
import { InsuranceReturnAnalyzer } from "./InsuranceReturnAnalyzer";
import { SurrenderAnalyzer } from "./SurrenderAnalyzer";
import { SwpPeriodicPlanner } from "./SwpPeriodicPlanner";
import { SwpEndPeriodCalculator } from "./SwpEndPeriodCalculator";
import { SwpComprehensivePlanner } from "./SwpComprehensivePlanner";
import { StpComprehensivePlanner } from "./StpComprehensivePlanner";
import {
  fvSip,
  fvLumpsum,
  requiredSip,
  inflatedTarget,
  fvStepUpSip,
  growingSipSchedule,
  costOfDelay,
  retirementCorpus,
  swpDeplete,
  stpCalculate,
  cagrCalculate,
  DEFAULT_EXPECTED_RETURN_PCT,
  DEFAULT_INFLATION_PCT,
} from "@/lib/goal-planning/calc";

type TabKey =
  | "sip360"
  | "reckoner"
  | "growing"
  | "bridge"
  | "salary"
  | "multipurpose"
  | "property"
  | "insurance"
  | "surrender"
  | "swpperiodic"
  | "swpend"
  | "swpcomp"
  | "stpcomp"
  | "sip"
  | "lumpsum"
  | "goal"
  | "inflation"
  | "delay"
  | "retirement"
  | "stepup"
  | "swp"
  | "stp"
  | "cagr";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "sip360", label: "★ SIP 360° Planner" },
  { key: "reckoner", label: "★ Step-Up SIP Reckoner" },
  { key: "growing", label: "★ Growing SIP vs SIP" },
  { key: "bridge", label: "★ Income Bridge (SIP→SWP)" },
  { key: "salary", label: "★ Salary → Wealth" },
  { key: "multipurpose", label: "★ Cashflow & Corpus" },
  { key: "property", label: "★ Property Yield" },
  { key: "insurance", label: "★ Insurance IRR" },
  { key: "surrender", label: "★ Surrender vs Invest" },
  { key: "swpperiodic", label: "★ SWP Periodic" },
  { key: "swpend", label: "★ SWP End Period" },
  { key: "swpcomp", label: "★ SWP Comprehensive" },
  { key: "stpcomp", label: "★ STP Comprehensive" },
  { key: "sip", label: "1. SIP" },
  { key: "lumpsum", label: "2. Lumpsum" },
  { key: "goal", label: "3. Goal" },
  { key: "inflation", label: "4. Inflation" },
  { key: "delay", label: "5. Cost of Delay" },
  { key: "retirement", label: "6. Retirement" },
  { key: "stepup", label: "7. Step-up SIP" },
  { key: "swp", label: "8. SWP" },
  { key: "stp", label: "9. STP" },
  { key: "cagr", label: "10. CAGR" },
];

export function CalculatorsApp() {
  const [tab, setTab] = useState<TabKey>("sip360");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`chip text-xs ${
                tab === t.key ? "bg-slate-900 text-white" : "bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => window.print()} className="btn-ghost text-xs">
          <Printer className="size-3.5" /> Print
        </button>
      </div>

      {tab === "sip360" && <Sip360Planner />}
      {tab === "reckoner" && <StepUpReckoner />}
      {tab === "growing" && <GrowingSipCalc />}
      {tab === "bridge" && <IncomeBridgePlanner />}
      {tab === "salary" && <SalaryWealthBuilder />}
      {tab === "multipurpose" && <CashflowCorpusPlanner />}
      {tab === "property" && <PropertyYieldCalculator />}
      {tab === "insurance" && <InsuranceReturnAnalyzer />}
      {tab === "surrender" && <SurrenderAnalyzer />}
      {tab === "swpperiodic" && <SwpPeriodicPlanner />}
      {tab === "swpend" && <SwpEndPeriodCalculator />}
      {tab === "swpcomp" && <SwpComprehensivePlanner />}
      {tab === "stpcomp" && <StpComprehensivePlanner />}
      {tab === "sip" && <SipCalc />}
      {tab === "lumpsum" && <LumpsumCalc />}
      {tab === "goal" && <GoalCalc />}
      {tab === "inflation" && <InflationCalc />}
      {tab === "delay" && <DelayCalc />}
      {tab === "retirement" && <RetirementCalc />}
      {tab === "stepup" && <StepUpCalc />}
      {tab === "swp" && <SwpCalc />}
      {tab === "stp" && <StpCalc />}
      {tab === "cagr" && <CagrCalc />}
    </div>
  );
}

/* ───────────────────────── 1. SIP ───────────────────────── */
function SipCalc() {
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");
  const [presentValue, setPresentValue] = useState(0);
  const [sipAmount, setSipAmount] = useState(10000);
  const [years, setYears] = useState(10);
  const [returnPct, setReturnPct] = useState(DEFAULT_EXPECTED_RETURN_PCT);

  const months = years * 12;
  const fvOfPv = fvLumpsum(presentValue, returnPct, months);
  const fvOfSip = fvSip(sipAmount, returnPct, months);
  const total = fvOfPv + fvOfSip;
  const invested = presentValue + sipAmount * months;

  return (
    <CalcShell
      title="SIP Investment Calculator"
      purpose="Future value of a monthly SIP, with optional present value."
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <Field label="Investment objective">
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="input-base text-sm w-full"
          />
        </Field>
        <NumberField label="Present value (₹)" value={presentValue} setValue={setPresentValue} />
        <NumberField
          label="Monthly SIP (₹)"
          value={sipAmount}
          setValue={setSipAmount}
        />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          { label: "Amount invested", value: inr(invested) },
          { label: "Future value", value: inr(total), tone: "emerald" },
          { label: "Wealth gain", value: inr(total - invested), tone: "emerald" },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 2. Lumpsum ───────────────────────── */
function LumpsumCalc() {
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");
  const [amount, setAmount] = useState(100000);
  const [years, setYears] = useState(10);
  const [returnPct, setReturnPct] = useState(DEFAULT_EXPECTED_RETURN_PCT);

  const fv = fvLumpsum(amount, returnPct, years * 12);

  return (
    <CalcShell title="Lumpsum Investment Calculator" purpose="Future value of a one-shot lumpsum.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <Field label="Investment objective">
          <input value={objective} onChange={(e) => setObjective(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Investment amount (₹)" value={amount} setValue={setAmount} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          { label: "Amount invested", value: inr(amount) },
          { label: "Future value", value: inr(fv), tone: "emerald" },
          { label: "Wealth gain", value: inr(fv - amount), tone: "emerald" },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 3. Goal ───────────────────────── */
function GoalCalc() {
  const [clientName, setClientName] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState(10000000);
  const [years, setYears] = useState(15);
  const [returnPct, setReturnPct] = useState(DEFAULT_EXPECTED_RETURN_PCT);

  const monthly = requiredSip(goalAmount, 0, returnPct, years * 12);

  return (
    <CalcShell title="Goal Calculator" purpose="Monthly SIP required to reach a target goal amount.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <Field label="Goal name">
          <input value={goalName} onChange={(e) => setGoalName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Goal amount (₹)" value={goalAmount} setValue={setGoalAmount} />
        <NumberField label="Years to goal" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          { label: "Goal amount", value: inr(goalAmount) },
          { label: "Monthly SIP required", value: inr(monthly), tone: "emerald" },
          { label: "Total invested over goal", value: inr(monthly * years * 12) },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 4. Inflation ───────────────────────── */
function InflationCalc() {
  const [clientName, setClientName] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [amount, setAmount] = useState(100000);
  const [years, setYears] = useState(15);
  const [ratePct, setRatePct] = useState(DEFAULT_INFLATION_PCT);

  const fv = inflatedTarget(amount, ratePct, years);

  return (
    <CalcShell title="Inflation Calculator" purpose="Future value of an expense or goal, inflated.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <Field label="Type of expense">
          <input value={expenseType} onChange={(e) => setExpenseType(e.target.value)} className="input-base text-sm w-full" placeholder="e.g. College fees, home cost" />
        </Field>
        <NumberField label="Current amount (₹)" value={amount} setValue={setAmount} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Inflation rate (% p.a.)" value={ratePct} setValue={setRatePct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          { label: "Today's value", value: inr(amount) },
          { label: "Future value", value: inr(fv), tone: "amber" },
          { label: "Inflation impact", value: inr(fv - amount), tone: "rose" },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 5. Cost of Delay ───────────────────────── */
function DelayCalc() {
  const [startAgeNow, setStartAgeNow] = useState(25);
  const [startAgeLater, setStartAgeLater] = useState(35);
  const [endAge, setEndAge] = useState(60);
  const [lumpsum, setLumpsum] = useState(0);
  const [sip, setSip] = useState(10000);
  const [returnPct, setReturnPct] = useState(DEFAULT_EXPECTED_RETURN_PCT);

  const res = costOfDelay({
    sipAmount: sip,
    lumpsum,
    startAgeNow,
    startAgeLater,
    endAge,
    returnPct,
  });

  return (
    <CalcShell title="Cost of Delay Calculator" purpose="Wealth difference between starting now vs later.">
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="SIP starting age (now)" value={startAgeNow} setValue={setStartAgeNow} step={1} />
        <NumberField label="SIP starting age (later)" value={startAgeLater} setValue={setStartAgeLater} step={1} />
        <NumberField label="SIP ending age" value={endAge} setValue={setEndAge} step={1} />
        <NumberField label="Lumpsum (₹)" value={lumpsum} setValue={setLumpsum} />
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <DelayColumn label="Invest now" body={res.now} />
        <DelayColumn label="Invest later" body={res.later} />
      </div>
      <ResultRow
        cells={[
          {
            label: "Cost of delay",
            value: inr(res.costOfDelay),
            tone: "rose",
          },
        ]}
      />
    </CalcShell>
  );
}

function DelayColumn({
  label,
  body,
}: {
  label: string;
  body: { years: number; invested: number; finalValue: number; gain: number };
}) {
  return (
    <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </div>
      <Row k="Years invested" v={body.years.toString()} />
      <Row k="Invested" v={inr(body.invested)} />
      <Row k="Final value" v={inr(body.finalValue)} />
      <Row k="Gain" v={inr(body.gain)} />
    </div>
  );
}

/* ───────────────────────── 6. Retirement ───────────────────────── */
function RetirementCalc() {
  const [currentAge, setCurrentAge] = useState(35);
  const [retirementAge, setRetirementAge] = useState(60);
  const [lifeExpectancy, setLifeExpectancy] = useState(85);
  const [monthlyIncome, setMonthlyIncome] = useState(100000);
  const [inflationPct, setInflationPct] = useState(DEFAULT_INFLATION_PCT);
  const [preReturnPct, setPreReturnPct] = useState(12);
  const [postReturnPct, setPostReturnPct] = useState(7);
  const [existingFund, setExistingFund] = useState(0);

  const res = retirementCorpus({
    currentAge,
    retirementAge,
    lifeExpectancy,
    monthlyIncomeTodayInr: monthlyIncome,
    inflationPct,
    preReturnPct,
    postReturnPct,
    existingFundInr: existingFund,
  });

  return (
    <CalcShell title="Retirement Planning Calculator" purpose="Corpus required + monthly savings to fund retirement.">
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Current age" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Retirement age" value={retirementAge} setValue={setRetirementAge} step={1} />
        <NumberField label="Life expectancy" value={lifeExpectancy} setValue={setLifeExpectancy} step={1} />
        <NumberField label="Monthly income today (₹)" value={monthlyIncome} setValue={setMonthlyIncome} />
        <NumberField label="Inflation rate (% p.a.)" value={inflationPct} setValue={setInflationPct} step={0.1} />
        <NumberField label="Existing fund (₹)" value={existingFund} setValue={setExistingFund} />
        <NumberField label="Pre-retirement return (%)" value={preReturnPct} setValue={setPreReturnPct} step={0.1} />
        <NumberField label="Post-retirement return (%)" value={postReturnPct} setValue={setPostReturnPct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          {
            label: "Monthly income at retirement",
            value: inr(res.monthlyIncomeAtRetirement),
            tone: "amber",
          },
          {
            label: "Corpus required",
            value: inr(res.corpusRequired),
            tone: "amber",
          },
          {
            label: "FV of existing fund",
            value: inr(res.fvOfExistingFund),
          },
          {
            label: "Monthly savings required",
            value: inr(res.monthlySavingsRequired),
            tone: "emerald",
          },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 7. Step-up SIP ───────────────────────── */
function StepUpCalc() {
  const [sip, setSip] = useState(10000);
  const [stepUpPct, setStepUpPct] = useState(10);
  const [years, setYears] = useState(15);
  const [returnPct, setReturnPct] = useState(DEFAULT_EXPECTED_RETURN_PCT);

  const months = years * 12;
  const fvFlat = fvSip(sip, returnPct, months);
  const fvStep = fvStepUpSip(sip, stepUpPct, returnPct, months);
  const investedFlat = sip * months;
  // Step-up invested
  let investedStep = 0;
  let cur = sip;
  for (let y = 0; y < years; y++) {
    investedStep += cur * 12;
    cur *= 1 + stepUpPct / 100;
  }

  return (
    <CalcShell title="Step-up SIP Calculator" purpose="Compare flat SIP vs SIP increased annually.">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Initial monthly SIP (₹)" value={sip} setValue={setSip} />
        <NumberField label="Annual step-up (%)" value={stepUpPct} setValue={setStepUpPct} step={1} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Without step-up
          </div>
          <Row k="Invested" v={inr(investedFlat)} />
          <Row k="Final value" v={inr(fvFlat)} />
          <Row k="Gain" v={inr(fvFlat - investedFlat)} />
        </div>
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
            With step-up
          </div>
          <Row k="Invested" v={inr(investedStep)} />
          <Row k="Final value" v={inr(fvStep)} />
          <Row k="Gain" v={inr(fvStep - investedStep)} />
        </div>
      </div>
      <ResultRow
        cells={[
          {
            label: "Difference (step-up advantage)",
            value: inr(fvStep - fvFlat),
            tone: "emerald",
          },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 8. SWP ───────────────────────── */
function SwpCalc() {
  const [corpus, setCorpus] = useState(500000);
  const [withdrawal, setWithdrawal] = useState(10000);
  const [returnPct, setReturnPct] = useState(8);
  const [years, setYears] = useState(5);

  const res = swpDeplete({
    corpusInr: corpus,
    monthlyWithdrawalInr: withdrawal,
    returnPct,
    years,
  });

  return (
    <CalcShell title="SWP Calculator" purpose="Monthly withdrawal from a corpus over a period.">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Total investment (₹)" value={corpus} setValue={setCorpus} />
        <NumberField label="Monthly withdrawal (₹)" value={withdrawal} setValue={setWithdrawal} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
      </div>
      <ResultRow
        cells={[
          { label: "Invested", value: inr(res.invested) },
          { label: "Total withdrawn", value: inr(res.totalWithdrawn), tone: "amber" },
          {
            label: "Final value",
            value: inr(res.finalValue),
            tone: res.finalValue > 0 ? "emerald" : "rose",
          },
        ]}
      />
      {res.monthsBeforeDepletion != null && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 mt-2">
          ⚠️ Corpus depletes after {Math.floor(res.monthsBeforeDepletion / 12)}{" "}
          years {res.monthsBeforeDepletion % 12} months.
        </div>
      )}
    </CalcShell>
  );
}

/* ───────────────────────── ★ Growing SIP vs SIP ───────────────────────── */
function GrowingSipCalc() {
  const [clientName, setClientName] = useState("");
  const [sip, setSip] = useState(100000);
  const [returnPct, setReturnPct] = useState(14);
  const [growthPct, setGrowthPct] = useState(10);
  const [years, setYears] = useState(20);

  const { regular, growing } = growingSipSchedule({
    monthlySip: sip,
    annualReturnPct: returnPct,
    annualGrowthPct: growthPct,
    years: Math.min(40, Math.max(1, years)),
  });

  const rLast = regular[regular.length - 1];
  const gLast = growing[growing.length - 1];
  const span = rLast?.year ?? years;
  const advantage = (gLast?.fv ?? 0) - (rLast?.fv ?? 0);

  return (
    <CalcShell
      title="Growing SIP vs Regular SIP"
      purpose="A step-up SIP that increases your monthly amount each year vs a flat SIP — year-by-year corpus, profit and profit-as-%-of-cost. Returns are treated as effective annual (compounded monthly, contributions at month start), matching the BIRD working sheet."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="Annual step-up (%)" value={growthPct} setValue={setGrowthPct} step={1} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
      </div>

      <ResultRow
        cells={[
          { label: `Regular SIP corpus (${span}y)`, value: inr(rLast?.fv ?? 0) },
          { label: `Growing SIP corpus (${span}y)`, value: inr(gLast?.fv ?? 0), tone: "emerald" },
          { label: "Extra from step-up", value: inr(advantage), tone: "emerald" },
        ]}
      />
      <ResultRow
        cells={[
          { label: "Invested — regular", value: inr(rLast?.invested ?? 0) },
          { label: "Invested — growing", value: inr(gLast?.invested ?? 0) },
          {
            label: "Growing — profit % of cost",
            value: `${((gLast?.profitPctOfCorpus ?? 0) * 100).toFixed(0)}%`,
            tone: "emerald",
          },
        ]}
      />

      <SipFvChart regular={regular} growing={growing} />

      <div className="overflow-x-auto scrollbar-thin border rounded-md">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground bg-secondary/40">
            <tr>
              <th className="px-2 py-1.5 text-left" rowSpan={2}>Year</th>
              <th className="px-2 py-1.5 text-center border-l" colSpan={3}>Regular SIP</th>
              <th className="px-2 py-1.5 text-center border-l" colSpan={3}>Growing SIP</th>
            </tr>
            <tr>
              <th className="px-2 py-1 text-right">Corpus</th>
              <th className="px-2 py-1 text-right">Invested</th>
              <th className="px-2 py-1 text-right">Profit %</th>
              <th className="px-2 py-1 text-right border-l">Corpus</th>
              <th className="px-2 py-1 text-right">Invested</th>
              <th className="px-2 py-1 text-right">Profit %</th>
            </tr>
          </thead>
          <tbody>
            {regular.map((rr, idx) => {
              const gg = growing[idx];
              return (
                <tr key={rr.year} className="border-t hover:bg-accent/30">
                  <td className="px-2 py-1.5 font-medium">{rr.year}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{inrCompact(rr.fv)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{inrCompact(rr.invested)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{(rr.profitPctOfCorpus * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums border-l text-emerald-700 font-medium">{inrCompact(gg.fv)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{inrCompact(gg.invested)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{(gg.profitPctOfCorpus * 100).toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Profit % = (corpus − amount invested) ÷ amount invested. The growing SIP invests more over time, so its
        corpus is far larger; a flat SIP can show a higher profit-% only because its cost base is smaller.
      </p>
    </CalcShell>
  );
}

function SipFvChart({
  regular,
  growing,
}: {
  regular: { year: number; fv: number }[];
  growing: { year: number; fv: number }[];
}) {
  const W = 640;
  const H = 220;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 18;
  const n = regular.length;
  if (n < 2) return null;
  const maxFv = Math.max(...growing.map((d) => d.fv), ...regular.map((d) => d.fv), 1);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxFv) * (H - padT - padB);
  const poly = (data: { fv: number }[]) => data.map((d, i) => `${x(i).toFixed(1)},${y(d.fv).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center gap-4 mb-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-400" /> Regular SIP
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> Growing SIP
        </span>
        <span className="ml-auto text-muted-foreground">Corpus across {n} years</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="SIP corpus growth: regular vs growing">
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(maxFv * g)}
              y2={y(maxFv * g)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
            <text x={padL} y={y(maxFv * g) - 2} className="fill-muted-foreground" fontSize={9}>
              {inrCompact(maxFv * g)}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="#94a3b8" strokeWidth={2} points={poly(regular)} />
        <polyline fill="none" stroke="#10b981" strokeWidth={2.5} points={poly(growing)} />
      </svg>
    </div>
  );
}

/* ───────────────────────── Shared shell + bits ───────────────────────── */
function CalcShell({
  title,
  purpose,
  children,
}: {
  title: string;
  purpose: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{purpose}</p>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  setValue,
  step = 1000,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => {
          // Clamp to ≥0 and ignore non-numeric — illustrations never use
          // negative amounts / rates / durations.
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function ResultRow({
  cells,
}: {
  cells: Array<{
    label: string;
    value: string;
    tone?: "emerald" | "amber" | "rose";
  }>;
}) {
  return (
    <div
      className={`grid gap-3 mt-3`}
      style={{
        gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((c, i) => {
        const cardTone =
          c.tone === "emerald"
            ? "border-emerald-200 bg-emerald-50/60"
            : c.tone === "amber"
              ? "border-amber-200 bg-amber-50/60"
              : c.tone === "rose"
                ? "border-rose-200 bg-rose-50/60"
                : "";
        return (
          <div
            key={i}
            className={`border rounded-md p-3 ${cardTone}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              {c.label}
            </div>
            <div className="text-lg font-semibold mt-0.5">{c.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Compact INR (₹X Cr / ₹X L / ₹Xk) — for dense tables + chart axis labels. */
function inrCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
}

/* ───────────────────────── 9. STP ───────────────────────── */
function StpCalc() {
  const [clientName, setClientName] = useState("");
  const [lumpsum, setLumpsum] = useState(1000000);
  const [transfer, setTransfer] = useState(50000);
  const [sourceReturn, setSourceReturn] = useState(6);
  const [targetReturn, setTargetReturn] = useState(12);
  const [years, setYears] = useState(5);

  const res = stpCalculate({
    lumpsum,
    transferAmount: transfer,
    sourceReturnPct: sourceReturn,
    targetReturnPct: targetReturn,
    years,
  });

  // Comparison logic: what if they kept the whole lumpsum in source debt fund?
  const sourceOnlyFV = fvLumpsum(lumpsum, sourceReturn, years * 12);
  // What if they put the whole lumpsum in target equity fund immediately?
  const targetOnlyFV = fvLumpsum(lumpsum, targetReturn, years * 12);

  return (
    <CalcShell
      title="Systematic Transfer Plan (STP) Calculator"
      purpose="Transfer funds systematically from a source debt fund to a target equity fund."
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <NumberField label="Initial lumpsum amount (₹)" value={lumpsum} setValue={setLumpsum} />
        <NumberField label="Monthly transfer amount (₹)" value={transfer} setValue={setTransfer} />
        <NumberField label="Source expected return (% p.a.)" value={sourceReturn} setValue={setSourceReturn} step={0.1} />
        <NumberField label="Target expected return (% p.a.)" value={targetReturn} setValue={setTargetReturn} step={0.1} />
        <NumberField label="Duration (years)" value={years} setValue={setYears} step={1} />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3">
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Debt fund remaining
          </div>
          <div className="text-base font-semibold">{inr(res.sourceFinalValue)}</div>
          <p className="text-[10px] text-muted-foreground">Un-transferred balance earning {sourceReturn}%</p>
        </div>
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-brand-cyan font-semibold">
            Equity fund value
          </div>
          <div className="text-base font-semibold">{inr(res.targetFinalValue)}</div>
          <p className="text-[10px] text-muted-foreground">Transferred installments compounding at {targetReturn}%</p>
        </div>
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5 bg-emerald-50/20 border-emerald-100">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
            Total STP value
          </div>
          <div className="text-base font-semibold text-emerald-700">{inr(res.totalFinalValue)}</div>
          <p className="text-[10px] text-emerald-600">Combined maturity corpus</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="border border-slate-100 rounded-md p-3 space-y-1 text-xs">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            STP vs Lumpsum Debt (Low risk)
          </div>
          <Row k="Total STP Value" v={inr(res.totalFinalValue)} />
          <Row k="Lumpsum in Debt Only" v={inr(sourceOnlyFV)} />
          <div className="border-t pt-1 font-semibold text-emerald-600 flex justify-between">
            <span>STP Outperformance</span>
            <span>{inr(res.totalFinalValue - sourceOnlyFV)}</span>
          </div>
        </div>
        <div className="border border-slate-100 rounded-md p-3 space-y-1 text-xs">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            STP vs Lumpsum Equity (High risk)
          </div>
          <Row k="Lumpsum in Equity Only" v={inr(targetOnlyFV)} />
          <Row k="Total STP Value" v={inr(res.totalFinalValue)} />
          <div className="border-t pt-1 font-semibold text-muted-foreground flex justify-between">
            <span>STP Risk-Mitigated shortfall</span>
            <span>{inr(targetOnlyFV - res.totalFinalValue)}</span>
          </div>
        </div>
      </div>

      <ResultRow
        cells={[
          { label: "Amount invested", value: inr(lumpsum) },
          { label: "Total return corpus", value: inr(res.totalFinalValue), tone: "emerald" },
          { label: "Net wealth gain", value: inr(res.gain), tone: "emerald" },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 10. CAGR ───────────────────────── */
function CagrCalc() {
  const [initialValue, setInitialValue] = useState(100000);
  const [finalValue, setFinalValue] = useState(250000);
  const [years, setYears] = useState(5);

  const res = cagrCalculate({
    initialValue,
    finalValue,
    years,
  });

  return (
    <CalcShell
      title="CAGR Return Calculator"
      purpose="Compound Annual Growth Rate and absolute return of an investment over a period."
    >
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Initial value (₹)" value={initialValue} setValue={setInitialValue} />
        <NumberField label="Current/Final value (₹)" value={finalValue} setValue={setFinalValue} />
        <NumberField label="Duration (years)" value={years} setValue={setYears} step={0.5} />
      </div>

      <ResultRow
        cells={[
          { label: "Absolute return", value: `${res.absoluteReturnPct.toFixed(2)}%`, tone: res.absoluteReturnPct >= 0 ? "emerald" : "rose" },
          { label: "CAGR return", value: `${res.cagrPct.toFixed(2)}% p.a.`, tone: res.cagrPct >= 0 ? "emerald" : "rose" },
          { label: "Absolute wealth gain", value: inr(finalValue - initialValue), tone: finalValue >= initialValue ? "emerald" : "rose" },
        ]}
      />
    </CalcShell>
  );
}
