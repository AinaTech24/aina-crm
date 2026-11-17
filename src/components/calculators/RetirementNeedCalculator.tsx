"use client";

/**
 * Retirement Need Based — the corpus a client needs to retire on today's
 * lifestyle, what is still missing after their existing investment and money
 * due at retirement, and four ways to fund it. Two inflation rates (before /
 * after retirement), an annuity paid at the start of each month until a chosen
 * age, and a balance left at the end. Up to two return scenarios.
 * Math: src/lib/calculators/retirement-need.ts (verified to the reference case →
 * corpus ₹3,81,67,725, gap ₹3,21,12,306, SIP ₹24,047, and every table row).
 */

import { useMemo, useState } from "react";
import { retirementNeed } from "@/lib/calculators/retirement-need";
import { inr, fmtPct, NumberField, Toggle, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

export function RetirementNeedCalculator() {
  const [currentAge, setCurrentAge] = useState(32);
  const [retirementAge, setRetirementAge] = useState(55);
  const [monthlyExpense, setMonthlyExpense] = useState(40000);
  const [inflPrePct, setInflPrePct] = useState(6);
  const [inflPostPct, setInflPostPct] = useState(5);
  const [acc1, setAcc1] = useState(12);
  const [dist1, setDist1] = useState(8);
  const [useScenario2, setUseScenario2] = useState(false);
  const [acc2, setAcc2] = useState(10);
  const [dist2, setDist2] = useState(7);
  const [currentInvestment, setCurrentInvestment] = useState(200000);
  const [currentInvestmentPct, setCurrentInvestmentPct] = useState(7.5);
  const [receivable, setReceivable] = useState(5000000);
  const [annuityEndAge, setAnnuityEndAge] = useState(85);
  const [endBalance, setEndBalance] = useState(10000000);

  const result = useMemo(
    () =>
      retirementNeed({
        currentAge, retirementAge, monthlyExpense, inflPrePct, inflPostPct,
        scenarios: useScenario2 ? [{ accPct: acc1, distPct: dist1 }, { accPct: acc2, distPct: dist2 }] : [{ accPct: acc1, distPct: dist1 }],
        currentInvestment, currentInvestmentPct, receivable, annuityEndAge, endBalance,
      }),
    [currentAge, retirementAge, monthlyExpense, inflPrePct, inflPostPct, acc1, dist1, useScenario2, acc2, dist2,
      currentInvestment, currentInvestmentPct, receivable, annuityEndAge, endBalance]
  );

  const sc = result.scenarios;
  const s1 = sc[0];
  const label = (i: number) => `Scenario ${i + 1} (${fmtPct(sc[i].accPct)} / ${fmtPct(sc[i].distPct)})`;
  const opt = (v: number | null) => (v == null ? "—" : inr(v));
  const funded = s1.gap <= 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Retirement Need Based Calculator</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Current age (yrs)" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Retirement age (yrs)" value={retirementAge} setValue={setRetirementAge} step={1} />
        <NumberField label="Monthly expense today (₹)" value={monthlyExpense} setValue={setMonthlyExpense} step={5000} />
        <NumberField label="Inflation till retirement (%)" value={inflPrePct} setValue={setInflPrePct} step={0.5} />
        <NumberField label="Inflation after retirement (%)" value={inflPostPct} setValue={setInflPostPct} step={0.5} />
        <NumberField label="Return before retirement (%)" value={acc1} setValue={setAcc1} step={0.5} />
        <NumberField label="Return after retirement (%)" value={dist1} setValue={setDist1} step={0.5} />
        <NumberField label="Income needed until age" value={annuityEndAge} setValue={setAnnuityEndAge} step={1} />
        <NumberField label="Balance to leave at that age (₹)" value={endBalance} setValue={setEndBalance} step={500000} />
        <NumberField label="Existing investments today (₹)" value={currentInvestment} setValue={setCurrentInvestment} step={100000} />
        <NumberField label="Return on existing investments (%)" value={currentInvestmentPct} setValue={setCurrentInvestmentPct} step={0.5} />
        <NumberField label="Other money due at retirement (₹)" value={receivable} setValue={setReceivable} step={100000} />
      </div>

      <div className="grid md:grid-cols-3 gap-3 items-end rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent">
        <Toggle checked={useScenario2} onChange={setUseScenario2} label="Compare a second scenario" />
        {useScenario2 && (
          <>
            <NumberField label="Scenario 2 — before retirement (%)" value={acc2} setValue={setAcc2} step={0.5} />
            <NumberField label="Scenario 2 — after retirement (%)" value={dist2} setValue={setDist2} step={0.5} />
          </>
        )}
      </div>


      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Monthly expense at ${retirementAge}`} value={inr(result.expenseAtRetirement)} />
        <Stat label="Corpus needed" value={inr(s1.corpus)} tone="cyan" />
        <Stat label="Existing investments grow to" value={inr(result.fvCurrent)} />
        <Stat label="Still to build" value={inr(Math.max(0, s1.gap))} tone={funded ? "emerald" : "amber"} />
      </div>

      <Section n={1} title="The retirement need">
        <Table
          head={["", ...sc.map((_, i) => label(i))]}
          rows={[
            ["Monthly expense at retirement", ...sc.map(() => inr(result.expenseAtRetirement))],
            ["Total corpus required", ...sc.map((s) => inr(s.corpus))],
            [`Existing ${inr(currentInvestment)} @ ${fmtPct(currentInvestmentPct)} grows to`, ...sc.map(() => inr(result.fvCurrent))],
            ["Other money due at retirement", ...sc.map(() => inr(receivable))],
            ["Balance corpus required", ...sc.map((s) => inr(Math.max(0, s.gap)))],
          ]}
          highlightLastRow
        />
      </Section>

      <Section n={2} title="Ways to build the balance">
        <Table
          head={["Option", ...sc.map((_, i) => label(i))]}
          rows={[
            [`Monthly SIP till age ${retirementAge}`, ...sc.map((s) => inr(s.sipTillRetirement))],
            ["Monthly SIP for 5 years, then stay invested", ...sc.map((s) => opt(s.sip5y))],
            ["Monthly SIP for 10 years, then stay invested", ...sc.map((s) => opt(s.sip10y))],
            ["Lumpsum today", ...sc.map((s) => inr(s.lumpsum))],
          ]}
        />
        {funded ? (
          <Insight>The existing investments and the money due at retirement already cover the corpus — no further investment is needed.</Insight>
        ) : (
          <Insight tone="cyan">
            To retire at {retirementAge} on today&apos;s {inr(monthlyExpense)}/month lifestyle (about{" "}
            {inr(result.expenseAtRetirement)}/month by then), invest <strong>{inr(s1.sipTillRetirement)}/month</strong> until
            retirement, or <strong>{inr(s1.lumpsum)}</strong> once today.
          </Insight>
        )}
      </Section>

      {s1.rows.length > 0 && (
        <Section n={3} title={`Monthly income and corpus left, age ${retirementAge + 1} to ${annuityEndAge}`}>
          <CalcChart
            data={s1.rows.map((r) => ({ age: r.age, balance: r.balanceEoy }))}
            xKey="age"
            xUnit="Age"
            series={[{ key: "balance", name: "Corpus left", color: "#0ea5e9" }]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Age", ...sc.flatMap((_, i) => [`Avg monthly income · S${i + 1}`, `Corpus at year end · S${i + 1}`])]}
              rows={s1.rows.map((r, ri) => [
                `${r.age}`,
                ...sc.flatMap((s) => [inr(s.rows[ri]?.avgMonthlyAnnuity ?? NaN), inr(s.rows[ri]?.balanceEoy ?? NaN)]),
              ])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. The income is paid on the 1st of every month and rises monthly in line with post-retirement
        inflation; the monthly figure in the table is the average of that year&apos;s twelve payments. SIPs are invested at the
        start of each month; returns compound at the effective monthly equivalent of the yearly rate. Existing investments
        compound yearly at their own rate. Returns are neither indicative nor guaranteed. Not investment advice.
      </p>
    </div>
  );
}
