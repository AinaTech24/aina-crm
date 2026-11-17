"use client";

/**
 * Lumpsum for a Target — the one-time amount to invest today so it grows to a
 * target, under one or two return scenarios, with the value at the end of
 * every year.
 * Math: lumpsumForTarget in src/lib/calculators/sip-suite.ts (annual
 * compounding; year-end values from the unrounded lumpsum, so the last year
 * equals the target; ₹3,00,00,000 in 25 years → ₹17,64,699 at 12%, ₹9,11,329 at 15%).
 */

import { useMemo, useState } from "react";
import { lumpsumForTarget, scenarioRates } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function LumpsumForTargetCalculator() {
  const [clientName, setClientName] = useState("");
  const [target, setTarget] = useState(30000000);
  const [years, setYears] = useState(25);
  const [r1, setR1] = useState(12);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(15);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(() => lumpsumForTarget({ target, years, ratesPct: rates }), [target, years, rates]);
  const s1 = res[0];
  const n = s1?.rows.length ?? 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Lumpsum for a Target</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Target amount (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>target {inr(target)} in {n} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Target" value={inr(target)} />
        <Stat label="Period" value={`${n} yrs`} />
        {res.map((sc, i) => (
          <Stat key={i} label={`Invest today @ ${fmtPct(sc.ratePct)}`} value={inr(sc.lumpsum)} tone={i === 0 ? "cyan" : "emerald"} />
        ))}
      </div>

      {s1 && target > 0 && (
        <Insight tone="cyan">
          Investing <strong>{inr(s1.lumpsum)}</strong> today at {fmtPct(s1.ratePct)} grows to <strong>{inr(target)}</strong> in {n} years
          {res[1] && <>; at {fmtPct(res[1].ratePct)} only <strong>{inr(res[1].lumpsum)}</strong> is needed</>}.
        </Insight>
      )}

      {view === "detailed" && n > 0 && (
        <Section n={1} title="Value at the end of each year">
          <CalcChart
            data={s1.rows.map((r, i) => ({ year: r.year, ...Object.fromEntries(res.map((sc, j) => [`s${j}`, sc.rows[i].value])) }))}
            xKey="year"
            series={res.map((sc, j) => ({ key: `s${j}`, name: `@ ${fmtPct(sc.ratePct)}`, color: SUITE_COLORS[j] }))}
          />
          <YearTableWrap>
            <Table
              head={["Year", ...res.flatMap((sc) => [`Invested @ ${fmtPct(sc.ratePct)}`, `Year-end value @ ${fmtPct(sc.ratePct)}`])]}
              rows={s1.rows.map((r, i) => [
                `${r.year}`,
                ...res.flatMap((sc) => [sc.rows[i].investment > 0 ? inr(sc.rows[i].investment) : "—", inr(sc.rows[i].value)]),
              ])}
              highlightLastRow
            />
          </YearTableWrap>
        </Section>
      )}
    </div>
  );
}
