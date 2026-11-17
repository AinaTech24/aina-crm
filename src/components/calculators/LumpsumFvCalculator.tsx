"use client";

/**
 * Future Value of a Lumpsum — what a one-time investment grows to, under one
 * or two return scenarios, with the value at the end of every year.
 * Math: lumpsumFv in src/lib/calculators/sip-suite.ts (annual compounding —
 * ₹5,00,000 for 10 years → ₹20,22,779 at 15%, ₹15,52,924 at 12%).
 */

import { useMemo, useState } from "react";
import { lumpsumFv, scenarioRates } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function LumpsumFvCalculator() {
  const [clientName, setClientName] = useState("");
  const [amount, setAmount] = useState(500000);
  const [years, setYears] = useState(10);
  const [r1, setR1] = useState(15);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(12);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(() => lumpsumFv({ amount, years, ratesPct: rates }), [amount, years, rates]);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of a Lumpsum</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="One-time investment (₹)" value={amount} setValue={setAmount} step={50000} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>{inr(amount)} invested today for {res.years} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Invested today" value={inr(res.invested)} />
        <Stat label="Period" value={`${res.years} yrs`} />
        {rates.map((r, i) => (
          <Stat key={i} label={`Future value @ ${fmtPct(r)}`} value={inr(res.fv[i])} tone={i === 0 ? "cyan" : "emerald"} />
        ))}
      </div>

      {res.years > 0 && amount > 0 && (
        <Insight tone="cyan">
          Left untouched, <strong>{inr(amount)}</strong> becomes <strong>{inr(res.fv[0])}</strong> in {res.years} years at{" "}
          {fmtPct(rates[0])} — about {(res.fv[0] / amount).toFixed(1)}× the money put in.
          {rates.length > 1 && <> At {fmtPct(rates[1])} it would be <strong>{inr(res.fv[1])}</strong>.</>}
        </Insight>
      )}

      {view === "detailed" && res.rows.length > 0 && (
        <Section n={1} title="Value at the end of each year">
          <CalcChart
            data={res.rows.map((r) => ({ year: r.year, ...Object.fromEntries(rates.map((_, i) => [`s${i}`, r.values[i]])) }))}
            xKey="year"
            series={rates.map((r, i) => ({ key: `s${i}`, name: `@ ${fmtPct(r)}`, color: SUITE_COLORS[i] }))}
          />
          <YearTableWrap>
            <Table
              head={["Year", "Investment", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)]}
              rows={res.rows.map((r) => [
                `${r.year}`,
                r.investment > 0 ? inr(r.investment) : "—",
                ...r.values.map((v) => inr(v)),
              ])}
              highlightLastRow
            />
          </YearTableWrap>
        </Section>
      )}
    </div>
  );
}
