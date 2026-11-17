"use client";

/**
 * Limited-Period SIP for a Target — the monthly SIP needed when it runs for only
 * a few years and the corpus then stays invested (the deferment) until the
 * target date. One or two return scenarios.
 * Math: limitedSipNeed in src/lib/calculators/sip-suite.ts (effective monthly
 * rate, SIP at the start of each month; ₹25,00,000 with a 5-year SIP held
 * 10 more at 12% → ₹9,925/month, ₹5,95,485 invested — the total uses the
 * unrounded SIP).
 */

import { useMemo, useState } from "react";
import { limitedSipNeed, scenarioRates } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function LimitedSipNeedCalculator() {
  const [clientName, setClientName] = useState("");
  const [target, setTarget] = useState(2500000);
  const [sipYears, setSipYears] = useState(5);
  const [deferYears, setDeferYears] = useState(10);
  const [r1, setR1] = useState(12);
  const [useR2, setUseR2] = useState(false);
  const [r2, setR2] = useState(15);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(() => limitedSipNeed({ target, sipYears, deferYears, ratesPct: rates }), [target, sipYears, deferYears, rates]);
  const s1 = res[0];
  const s = Math.max(0, Math.round(sipYears));
  const total = s + Math.max(0, Math.round(deferYears));

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Limited-Period SIP for a Target</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Target amount (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="SIP period (yrs)" value={sipYears} setValue={setSipYears} step={1} />
        <NumberField label="Stay invested after the SIP (yrs)" value={deferYears} setValue={setDeferYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>target {inr(target)} in {total} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {res.map((sc, i) => (
          <Stat key={`m${i}`} label={`Monthly SIP needed @ ${fmtPct(sc.ratePct)}`} value={inr(sc.monthlySip)} tone={i === 0 ? "cyan" : "emerald"} />
        ))}
        {res.map((sc, i) => (
          <Stat key={`t${i}`} label={`Total invested @ ${fmtPct(sc.ratePct)}`} value={inr(sc.totalInvestment)} />
        ))}
      </div>

      {s1 && Number.isFinite(s1.monthlySip) ? (
        <Insight tone="cyan">
          A SIP of <strong>{inr(s1.monthlySip)}/month</strong> for {s} years — {inr(s1.totalInvestment)} in all — then left
          invested for {total - s} more years reaches <strong>{inr(target)}</strong> at {fmtPct(s1.ratePct)}.
        </Insight>
      ) : (
        <Insight tone="amber">Enter a SIP period of at least one year.</Insight>
      )}

      {view === "detailed" && res.map((sc, i) =>
        sc.rows.length > 0 ? (
          <Section key={i} n={i + 1} title={`Year-wise value @ ${fmtPct(sc.ratePct)}`}>
            {i === 0 && (
              <CalcChart
                data={sc.rows.map((r) => ({ year: r.year, value: r.value }))}
                xKey="year"
                series={[{ key: "value", name: "Corpus", color: SUITE_COLORS[0] }]}
              />
            )}
            <YearTableWrap>
              <Table
                head={["Year", "Monthly SIP", "Invested in year", "Year-end value"]}
                rows={sc.rows.map((r) => [
                  `${r.year}`,
                  r.monthly > 0 ? inr(r.monthly) : "—",
                  r.annual > 0 ? inr(r.annual) : "—",
                  inr(r.value),
                ])}
                highlightLastRow
              />
            </YearTableWrap>
          </Section>
        ) : null,
      )}
    </div>
  );
}
