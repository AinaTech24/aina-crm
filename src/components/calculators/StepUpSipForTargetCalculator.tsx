"use client";

/**
 * Step-Up SIP for a Target — the starting monthly SIP that, raised by a fixed %
 * every year, reaches a target amount. One or two return scenarios, with each
 * year's instalments and year-end value.
 * Math: stepUpSipForTarget in src/lib/calculators/sip-suite.ts (effective
 * monthly rate, SIP at the start of each month; ₹50,00,000 in 15 years, +5% a
 * year → start at ₹9,425 (10%) / ₹7,467 (13%), investing ₹24,40,656 / ₹19,33,620).
 */

import { useMemo, useState } from "react";
import { scenarioRates, stepUpSipForTarget } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function StepUpSipForTargetCalculator() {
  const [clientName, setClientName] = useState("");
  const [target, setTarget] = useState(5000000);
  const [years, setYears] = useState(15);
  const [stepUpPct, setStepUpPct] = useState(5);
  const [r1, setR1] = useState(10);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(13);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(() => stepUpSipForTarget({ target, years, stepUpPct, ratesPct: rates }), [target, years, stepUpPct, rates]);
  const s1 = res[0];

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Step-Up SIP for a Target</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Target amount (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="SIP period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="Step-up every year (%)" value={stepUpPct} setValue={setStepUpPct} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>target {inr(target)} in {s1?.rows.length ?? 0} years, +{fmtPct(stepUpPct)} a year</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {res.map((sc, i) => (
          <Stat key={`m${i}`} label={`Starting SIP @ ${fmtPct(sc.ratePct)}`} value={inr(sc.startSip)} tone={i === 0 ? "cyan" : "emerald"} />
        ))}
        {res.map((sc, i) => (
          <Stat key={`l${i}`} label={`One-time lumpsum today @ ${fmtPct(sc.ratePct)}`} value={inr(sc.lumpsumToday)} />
        ))}
        {res.map((sc, i) => (
          <Stat key={`t${i}`} label={`Total invested @ ${fmtPct(sc.ratePct)}`} value={inr(sc.total)} />
        ))}
      </div>

      {s1 && Number.isFinite(s1.startSip) ? (
        <Insight tone="cyan">
          Start at <strong>{inr(s1.startSip)}/month</strong> and raise it {fmtPct(stepUpPct)} every year to reach{" "}
          <strong>{inr(target)}</strong> at {fmtPct(s1.ratePct)}
          {res[1] && <> — or start at <strong>{inr(res[1].startSip)}/month</strong> at {fmtPct(res[1].ratePct)}</>}. Or invest a
          one-time lumpsum of <strong>{inr(s1.lumpsumToday)}</strong> today at {fmtPct(s1.ratePct)}
          {res[1] && <> ({inr(res[1].lumpsumToday)} at {fmtPct(res[1].ratePct)})</>} and leave it to grow.
        </Insight>
      ) : (
        <Insight tone="amber">Enter a SIP period of at least one year.</Insight>
      )}

      {view === "detailed" && s1 && s1.rows.length > 0 && (
        <>
          <CalcChart
            data={s1.rows.map((r, i) => ({ year: r.year, ...Object.fromEntries(res.map((sc, j) => [`s${j}`, sc.rows[i]?.value ?? 0])) }))}
            xKey="year"
            series={res.map((sc, j) => ({ key: `s${j}`, name: `@ ${fmtPct(sc.ratePct)}`, color: SUITE_COLORS[j] }))}
          />
          {res.map((sc, i) => (
            <Section key={i} n={i + 1} title={`Year-wise plan @ ${fmtPct(sc.ratePct)}`}>
              <YearTableWrap>
                <Table
                  head={["Year", "Monthly SIP", "Invested in year", "Year-end value"]}
                  rows={sc.rows.map((r) => [`${r.year}`, inr(r.monthly), inr(r.annual), inr(r.value)])}
                  highlightLastRow
                />
              </YearTableWrap>
            </Section>
          ))}
        </>
      )}
    </div>
  );
}
