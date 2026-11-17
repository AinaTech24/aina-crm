"use client";

/**
 * Future Value of a Limited-Period SIP — a monthly SIP paid for a few years,
 * after which the corpus stays invested (the deferment) with no further
 * instalments. One or two return scenarios, value at the end of every year.
 * Math: limitedSipFv in src/lib/calculators/sip-suite.ts (effective monthly
 * rate, SIP at the start of each month; ₹5,000/month for 5 years held 10 more →
 * ₹3,00,000 invested, ₹12,59,478 at 12%, ₹17,66,737 at 15%).
 */

import { useMemo, useState } from "react";
import { limitedSipFv, scenarioRates } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function LimitedSipFvCalculator() {
  const [clientName, setClientName] = useState("");
  const [monthly, setMonthly] = useState(5000);
  const [sipYears, setSipYears] = useState(5);
  const [deferYears, setDeferYears] = useState(10);
  const [r1, setR1] = useState(12);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(15);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(() => limitedSipFv({ monthly, sipYears, deferYears, ratesPct: rates }), [monthly, sipYears, deferYears, rates]);
  const total = res.sipYears + res.deferYears;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of a Limited-Period SIP</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Monthly SIP (₹)" value={monthly} setValue={setMonthly} step={1000} />
        <NumberField label="SIP period (yrs)" value={sipYears} setValue={setSipYears} step={1} />
        <NumberField label="Stay invested after the SIP (yrs)" value={deferYears} setValue={setDeferYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>
        {inr(monthly)}/month for {res.sipYears} years, held {res.deferYears} more
      </PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total invested" value={inr(res.invested)} />
        <Stat label="Total period" value={`${total} yrs`} />
        {rates.map((r, i) => (
          <Stat key={i} label={`Value after ${total} yrs @ ${fmtPct(r)}`} value={inr(res.fv[i])} tone={i === 0 ? "cyan" : "emerald"} />
        ))}
      </div>

      {res.sipYears > 0 && monthly > 0 && (
        <Insight tone="cyan">
          Instalments stop after {res.sipYears} years ({inr(res.invested)} in all), yet the money keeps compounding for{" "}
          {res.deferYears} more — reaching <strong>{inr(res.fv[0])}</strong> at {fmtPct(rates[0])}
          {rates.length > 1 && <> or <strong>{inr(res.fv[1])}</strong> at {fmtPct(rates[1])}</>}.
        </Insight>
      )}

      {view === "detailed" && res.rows.length > 0 && (
        <Section n={1} title="Year-wise value">
          <CalcChart
            data={res.rows.map((r) => ({ year: r.year, ...Object.fromEntries(rates.map((_, i) => [`s${i}`, r.values[i]])) }))}
            xKey="year"
            series={rates.map((r, i) => ({ key: `s${i}`, name: `@ ${fmtPct(r)}`, color: SUITE_COLORS[i] }))}
          />
          <YearTableWrap>
            <Table
              head={["Year", "Monthly SIP", "Invested in year", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)]}
              rows={res.rows.map((r) => [
                `${r.year}`,
                r.monthly > 0 ? inr(r.monthly) : "—",
                r.annual > 0 ? inr(r.annual) : "—",
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
