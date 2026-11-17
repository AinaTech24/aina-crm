"use client";

/**
 * SIP Needed for a Monthly SWP — the corpus a target monthly withdrawal needs
 * (optionally rising with inflation, leaving a chosen balance) and the monthly
 * SIP that builds it, with separate accumulation and distribution returns, an
 * optional wait between the last SIP and the first withdrawal, and up to two
 * return scenarios.
 * Math: src/lib/calculators/swp-target.ts (verified to the rupee — ₹1,00,000/mo ·
 * SIP 20y @12% · SWP 30y @7% · leave ₹50 L → corpus ₹1,60,19,597, SIP ₹17,415).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { sipForSwp } from "@/lib/calculators/swp-target";
import { inr, fmtPct, NumberField, Field, Toggle, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";
import { SwpYearTable, optionalAge } from "./swp-target-parts";

export function SipForSwpCalculator() {
  const [clientName, setClientName] = useState("");
  const [currentAge, setCurrentAge] = useState(40);
  const [monthlySwp, setMonthlySwp] = useState(100000);
  const [sipYears, setSipYears] = useState(20);
  const [defer, setDefer] = useState(false);
  const [deferYears, setDeferYears] = useState(5);
  const [swpYears, setSwpYears] = useState(30);
  const [acc1, setAcc1] = useState(12);
  const [dist1, setDist1] = useState(7);
  const [useS2, setUseS2] = useState(false);
  const [acc2, setAcc2] = useState(10);
  const [dist2, setDist2] = useState(6);
  const [endBalance, setEndBalance] = useState(5000000);
  const [useInflation, setUseInflation] = useState(false);
  const [inflationPct, setInflationPct] = useState(5);

  const age = optionalAge(currentAge);
  const label = age != null ? "age" : "year";

  const scenarios = useMemo(() => {
    const run = (accPct: number, distPct: number) =>
      sipForSwp({
        firstMonthlySwp: monthlySwp, sipYears, deferYears: defer ? deferYears : 0, swpYears,
        accPct, distPct, inflationPct: useInflation ? inflationPct : 0, endBalance, currentAge: age,
      });
    return useS2 ? [run(acc1, dist1), run(acc2, dist2)] : [run(acc1, dist1)];
  }, [monthlySwp, sipYears, defer, deferYears, swpYears, acc1, dist1, useS2, acc2, dist2, useInflation, inflationPct, endBalance, age]);

  const s1 = scenarios[0];
  const tag = (s: (typeof scenarios)[number]) => `${fmtPct(s.accPct)} / ${fmtPct(s.distPct)}`;
  const sameRate = useInflation && scenarios.some((s) => Math.abs(s.distPct - inflationPct) < 1e-9);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">SIP Needed for a Monthly SWP</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Client name (optional)">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <NumberField label="Current age (optional)" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Monthly SWP wanted (₹, first month)" value={monthlySwp} setValue={setMonthlySwp} step={5000} />
        <NumberField label="SIP period (yrs)" value={sipYears} setValue={setSipYears} step={1} />
        <NumberField label="SWP period (yrs)" value={swpYears} setValue={setSwpYears} step={1} />
        <NumberField label="Balance required at the end (₹)" value={endBalance} setValue={setEndBalance} step={100000} />
        <NumberField label="Scenario 1 — SIP-phase return (%)" value={acc1} setValue={setAcc1} step={0.5} />
        <NumberField label="Scenario 1 — SWP-phase return (%)" value={dist1} setValue={setDist1} step={0.5} />
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Toggle checked={useS2} onChange={setUseS2} label="Compare scenario 2" />
          {useS2 && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Scenario 2 — SIP phase (%)" value={acc2} setValue={setAcc2} step={0.5} />
              <NumberField label="Scenario 2 — SWP phase (%)" value={dist2} setValue={setDist2} step={0.5} />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Toggle checked={defer} onChange={setDefer} label="Wait after the SIP ends" />
          {defer && <NumberField label="Years before the first SWP" value={deferYears} setValue={setDeferYears} step={1} />}
        </div>
        <div className="space-y-2">
          <Toggle checked={useInflation} onChange={setUseInflation} label="Raise the SWP with inflation" />
          {useInflation && <NumberField label="Expected inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />}
        </div>
      </div>

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-primary">{clientName}</span> · {inr(monthlySwp)} a month for {swpYears} years
        </div>
      )}

      {scenarios.map((s, i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label={`Corpus needed @ ${tag(s)}`} value={inr(s.corpus)} />
          <Stat label={`Monthly SIP needed @ ${tag(s)}`} value={inr(s.monthlySip)} tone={i === 0 ? "cyan" : "emerald"} />
          <Stat label={`Total withdrawal @ ${tag(s)}`} value={inr(s.totalWithdrawal)} />
        </div>
      ))}

      <Insight tone="cyan">
        A SIP of <strong>{inr(s1.monthlySip)}</strong> a month for {sipYears} years at {fmtPct(s1.accPct)} builds{" "}
        {inr(s1.corpus)}{defer ? ` by the time withdrawals start ${deferYears} years later` : ""} — enough to draw{" "}
        {inr(monthlySwp)} a month{useInflation ? ` (rising with ${fmtPct(inflationPct)} inflation)` : ""} for {swpYears} years at{" "}
        {fmtPct(s1.distPct)} and leave {inr(endBalance)}. You invest {inr(s1.totalInvested)} in all.
      </Insight>
      {sameRate && (
        <Insight tone="amber">The SWP-phase return equals inflation, so the withdrawal grows as fast as the money it is drawn from.</Insight>
      )}

      <Section n={1} title={`Accumulation — annual investment and year-end value @ ${fmtPct(s1.accPct)}`}>
        <CalcChart
          data={s1.accRows.map((r) => ({ x: r.age ?? r.year, value: r.yearEndValue }))}
          xKey="x"
          xUnit={label === "age" ? "Age" : "Year"}
          series={[{ key: "value", name: "Value", color: "#0ea5e9" }]}
        />
        <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
          <Table
            head={[label === "age" ? "Age" : "Year", "Annual investment", "Year-end value"]}
            rows={s1.accRows.map((r) => [
              label === "age" && r.age != null ? `${r.age}` : `${r.year}`,
              r.annualInvestment > 0 ? inr(r.annualInvestment) : "—",
              inr(r.yearEndValue),
            ])}
            highlightLastRow
          />
        </div>
      </Section>

      <Section n={2} title="Distribution — monthly withdrawal and year-end value">
        <SwpYearTable scenarios={scenarios.map((s) => ({ ratePct: s.distPct, rows: s.swpRows }))} firstLabel={label} />
      </Section>

      <p className="text-2xs text-muted-foreground">
        SIP paid at the start of each month; withdrawals taken on the last day of each month · effective monthly rates ·
        the distribution table shows each year&apos;s average monthly withdrawal. Illustration only; returns are not guaranteed.
      </p>
    </div>
  );
}
