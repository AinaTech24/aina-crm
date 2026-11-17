"use client";

/**
 * Future Value of a Step-Up SIP — a monthly SIP raised by a fixed % at the start
 * of every year, under one or two return scenarios, with each year's monthly
 * and annual instalment and the year-end value.
 * Math: stepUpSipFv in src/lib/calculators/sip-suite.ts (effective monthly rate,
 * SIP at the start of each month; ₹10,000/month +10% a year for 20 years →
 * ₹68,73,000 invested, ₹1,86,31,383 at 12%, ₹2,49,73,181 at 15%).
 */

import { useMemo, useState } from "react";
import { scenarioRates, stepUpSipFv } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function StepUpSipFvCalculator() {
  const [clientName, setClientName] = useState("");
  const [monthly, setMonthly] = useState(10000);
  const [stepUpPct, setStepUpPct] = useState(10);
  const [years, setYears] = useState(20);
  const [r1, setR1] = useState(12);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(15);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(() => stepUpSipFv({ monthly, stepUpPct, years, ratesPct: rates }), [monthly, stepUpPct, years, rates]);
  const n = res.rows.length;
  const lastMonthly = n > 0 ? res.rows[n - 1].monthly : monthly;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of a Step-Up SIP</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Starting monthly SIP (₹)" value={monthly} setValue={setMonthly} step={1000} />
        <NumberField label="Step-up every year (%)" value={stepUpPct} setValue={setStepUpPct} step={1} />
        <NumberField label="SIP period (yrs)" value={years} setValue={setYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>{inr(monthly)}/month, +{fmtPct(stepUpPct)} a year, for {n} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total invested" value={inr(res.invested)} />
        <Stat label="Monthly SIP in the last year" value={inr(lastMonthly)} />
        {rates.map((r, i) => (
          <Stat key={i} label={`Future value @ ${fmtPct(r)}`} value={inr(res.fv[i])} tone={i === 0 ? "cyan" : "emerald"} />
        ))}
      </div>

      {n > 0 && monthly > 0 && (
        <Insight tone="cyan">
          Starting at {inr(monthly)} and rising {fmtPct(stepUpPct)} each year to {inr(lastMonthly)}, the SIP puts in{" "}
          {inr(res.invested)} and could grow to <strong>{inr(res.fv[0])}</strong> at {fmtPct(rates[0])}
          {rates.length > 1 && <> or <strong>{inr(res.fv[1])}</strong> at {fmtPct(rates[1])}</>}.
        </Insight>
      )}

      {view === "detailed" && n > 0 && (
        <Section n={1} title="Year-wise instalments and value">
          <CalcChart
            data={res.rows.map((r) => ({ year: r.year, ...Object.fromEntries(rates.map((_, i) => [`s${i}`, r.values[i]])) }))}
            xKey="year"
            series={rates.map((r, i) => ({ key: `s${i}`, name: `@ ${fmtPct(r)}`, color: SUITE_COLORS[i] }))}
          />
          <YearTableWrap>
            <Table
              head={["Year", "Monthly SIP", "Invested in year", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)]}
              rows={res.rows.map((r) => [`${r.year}`, inr(r.monthly), inr(r.annual), ...r.values.map((v) => inr(v))])}
              highlightLastRow
            />
          </YearTableWrap>
        </Section>
      )}
    </div>
  );
}
