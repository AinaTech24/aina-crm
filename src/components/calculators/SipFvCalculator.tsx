"use client";

/**
 * Future Value of a SIP — a monthly SIP under one or two return scenarios, with
 * an optional comparison against the same SIP raised every year by a % or by a
 * fixed ₹ amount. Year-wise tables for both.
 * Math: sipFv in src/lib/calculators/sip-suite.ts (effective monthly rate, SIP
 * at the start of each month; ₹10,000/month, 15 years, +₹2,000 a year →
 * ₹47,59,314 / ₹61,63,656 normal, ₹94,99,880 / ₹1,17,91,026 step-up at 12% / 15%).
 */

import { useMemo, useState } from "react";
import { scenarioRates, sipFv, type SipProjection, type StepUp } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Segmented, Stat, Table, Toggle, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

type StepMode = "pct" | "amount";

export function SipFvCalculator() {
  const [clientName, setClientName] = useState("");
  const [monthly, setMonthly] = useState(10000);
  const [years, setYears] = useState(15);
  const [r1, setR1] = useState(12);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(15);
  const [withStepUp, setWithStepUp] = useState(true);
  const [stepMode, setStepMode] = useState<StepMode>("amount");
  const [stepPct, setStepPct] = useState(10);
  const [stepAmount, setStepAmount] = useState(2000);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const stepUp = useMemo<StepUp | null>(
    () => (!withStepUp ? null : stepMode === "pct" ? { mode: "pct", pct: stepPct } : { mode: "amount", amount: stepAmount }),
    [withStepUp, stepMode, stepPct, stepAmount],
  );
  const res = useMemo(() => sipFv({ monthly, years, ratesPct: rates, stepUp }), [monthly, years, rates, stepUp]);
  const stepLabel = stepMode === "pct" ? `+${fmtPct(stepPct)} a year` : `+${inr(stepAmount)} a year`;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of a SIP</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Monthly SIP (₹)" value={monthly} setValue={setMonthly} step={1000} />
        <NumberField label="SIP period (yrs)" value={years} setValue={setYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <div className="flex flex-col justify-end gap-2">
          <Toggle checked={withStepUp} onChange={setWithStepUp} label="Compare a step-up SIP" />
          {withStepUp && (
            <Segmented
              value={stepMode}
              onChange={setStepMode}
              options={[
                { value: "pct", label: "% every year" },
                { value: "amount", label: "₹ every year" },
              ]}
            />
          )}
        </div>
        {withStepUp && (stepMode === "pct"
          ? <NumberField label="Step-up every year (%)" value={stepPct} setValue={setStepPct} step={1} />
          : <NumberField label="Step-up every year (₹)" value={stepAmount} setValue={setStepAmount} step={500} />)}
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>{inr(monthly)}/month for {res.years} years{res.stepUp ? `, step-up ${stepLabel}` : ""}</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total invested — SIP" value={inr(res.normal.invested)} />
        {res.stepUp && <Stat label="Total invested — step-up SIP" value={inr(res.stepUp.invested)} />}
        {rates.map((r, i) => (
          <Stat key={`n${i}`} label={`SIP value @ ${fmtPct(r)}`} value={inr(res.normal.fv[i])} tone={i === 0 ? "cyan" : undefined} />
        ))}
        {res.stepUp && rates.map((r, i) => (
          <Stat key={`s${i}`} label={`Step-up SIP value @ ${fmtPct(r)}`} value={inr(res.stepUp!.fv[i])} tone="emerald" />
        ))}
      </div>

      {res.stepUp && res.years > 0 && monthly > 0 && (
        <Insight tone="cyan">
          Raising the SIP {stepLabel} turns <strong>{inr(res.normal.fv[0])}</strong> into{" "}
          <strong>{inr(res.stepUp.fv[0])}</strong> at {fmtPct(rates[0])} — for{" "}
          {inr(res.stepUp.invested - res.normal.invested)} more invested over {res.years} years.
        </Insight>
      )}

      {view === "detailed" && res.normal.rows.length > 0 && (
        <>
          <Section n={1} title="SIP — year-wise value">
            <CalcChart
              data={res.normal.rows.map((r, i) => ({
                year: r.year,
                normal: r.values[0],
                ...(res.stepUp ? { step: res.stepUp.rows[i].values[0] } : {}),
              }))}
              xKey="year"
              series={[
                { key: "normal", name: `SIP @ ${fmtPct(rates[0])}`, color: SUITE_COLORS[0] },
                ...(res.stepUp ? [{ key: "step", name: `Step-up SIP @ ${fmtPct(rates[0])}`, color: SUITE_COLORS[1] }] : []),
              ]}
            />
            <ProjectionTable p={res.normal} rates={rates} />
          </Section>
          {res.stepUp && (
            <Section n={2} title={`Step-up SIP (${stepLabel}) — year-wise value`}>
              <ProjectionTable p={res.stepUp} rates={rates} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function ProjectionTable({ p, rates }: { p: SipProjection; rates: number[] }) {
  return (
    <YearTableWrap>
      <Table
        head={["Year", "Monthly SIP", "Invested in year", ...rates.map((r) => `Year-end value @ ${fmtPct(r)}`)]}
        rows={p.rows.map((r) => [`${r.year}`, inr(r.monthly), inr(r.annual), ...r.values.map((v) => inr(v))])}
        highlightLastRow
      />
    </YearTableWrap>
  );
}
