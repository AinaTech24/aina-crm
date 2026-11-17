"use client";

/**
 * SIP for a Target, with the Cost of Delay — the monthly SIP that reaches a
 * target under one or two return scenarios, an optional step-up SIP beside it,
 * year-wise tables, and how much higher the SIP must be for every year the
 * start is put off.
 * Math: sipForTarget in src/lib/calculators/sip-suite.ts (effective monthly
 * rate, SIP at the start of each month; totals from the unrounded SIP;
 * ₹50,00,000 in 15 years → ₹10,506 / ₹8,112 at 12% / 15%, step-up +10% a year
 * from ₹6,043 / ₹4,874; one year's delay → ₹12,091 / ₹9,529).
 */

import { useMemo, useState } from "react";
import { scenarioRates, sipForTarget } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Toggle, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, ScenarioFields, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function SipForTargetCalculator() {
  const [clientName, setClientName] = useState("");
  const [target, setTarget] = useState(5000000);
  const [years, setYears] = useState(15);
  const [r1, setR1] = useState(12);
  const [useR2, setUseR2] = useState(true);
  const [r2, setR2] = useState(15);
  const [withStepUp, setWithStepUp] = useState(true);
  const [stepUpPct, setStepUpPct] = useState(10);
  const [withDelay, setWithDelay] = useState(true);
  const [view, setView] = useState<ReportView>("detailed");

  const rates = useMemo(() => scenarioRates(r1, useR2 ? r2 : null), [r1, useR2, r2]);
  const res = useMemo(
    () => sipForTarget({ target, years, ratesPct: rates, stepUpPct: withStepUp ? stepUpPct : null, costOfDelay: withDelay }),
    [target, years, rates, withStepUp, stepUpPct, withDelay],
  );
  const s1 = res[0];
  const n = s1?.rows.length ?? 0;
  const hasStep = !!s1?.stepUp;
  const delay1 = s1?.delay?.[0];
  const scenarioHead = (label: string) => res.map((sc) => `${label} @ ${fmtPct(sc.ratePct)}`);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">SIP for a Target &amp; Cost of Delay</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Target amount (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="SIP period (yrs)" value={years} setValue={setYears} step={1} />
        <ScenarioFields r1={r1} setR1={setR1} useR2={useR2} setUseR2={setUseR2} r2={r2} setR2={setR2} />
        <div className="flex flex-col justify-end gap-1">
          <Toggle checked={withStepUp} onChange={setWithStepUp} label="Compare a step-up SIP" />
          {withStepUp && <NumberField label="Step-up every year (%)" value={stepUpPct} setValue={setStepUpPct} step={1} />}
        </div>
        <div className="flex flex-col justify-end gap-2">
          <Toggle checked={withDelay} onChange={setWithDelay} label="Show cost of delay" />
          <ReportSwitch value={view} onChange={setView} />
        </div>
      </div>

      <PreparedFor name={clientName}>target {inr(target)} in {n} years</PreparedFor>

      {n === 0 ? (
        <Insight tone="amber">Enter a SIP period of at least one year.</Insight>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {res.map((sc, i) => (
              <Stat key={`n${i}`} label={`Monthly SIP @ ${fmtPct(sc.ratePct)}`} value={inr(sc.sip)} tone={i === 0 ? "cyan" : undefined} />
            ))}
            {hasStep && res.map((sc, i) => (
              <Stat key={`s${i}`} label={`Starting step-up SIP @ ${fmtPct(sc.ratePct)}`} value={inr(sc.stepUp!.startSip)} tone="emerald" />
            ))}
          </div>

          <Table
            head={["", ...scenarioHead("Monthly SIP"), ...scenarioHead("Total invested")]}
            rows={[
              ["SIP", ...res.map((sc) => inr(sc.sip)), ...res.map((sc) => inr(sc.total))],
              ...(hasStep
                ? [[`Step-up SIP (+${fmtPct(stepUpPct)}/yr)`, ...res.map((sc) => inr(sc.stepUp!.startSip)), ...res.map((sc) => inr(sc.stepUp!.total))]]
                : []),
            ]}
          />

          {delay1 && (
            <Insight tone="amber">
              Waiting just one year lifts the SIP needed at {fmtPct(s1.ratePct)} from <strong>{inr(s1.sip)}</strong> to{" "}
              <strong>{inr(delay1.sip)}</strong> a month — and the total put in from {inr(s1.total)} to {inr(delay1.total)}.
            </Insight>
          )}

          {view === "detailed" && (
            <>
              <Section n={1} title="SIP — year-wise value">
                <CalcChart
                  data={s1.rows.map((r, i) => ({
                    year: r.year,
                    normal: r.value,
                    ...(hasStep ? { step: s1.stepUp!.rows[i]?.value ?? 0 } : {}),
                  }))}
                  xKey="year"
                  series={[
                    { key: "normal", name: `SIP @ ${fmtPct(s1.ratePct)}`, color: SUITE_COLORS[0] },
                    ...(hasStep ? [{ key: "step", name: `Step-up SIP @ ${fmtPct(s1.ratePct)}`, color: SUITE_COLORS[1] }] : []),
                  ]}
                />
                <YearTableWrap>
                  <Table
                    head={["Year", ...res.flatMap((sc) => [`Invested @ ${fmtPct(sc.ratePct)}`, `Year-end value @ ${fmtPct(sc.ratePct)}`])]}
                    rows={s1.rows.map((r, i) => [`${r.year}`, ...res.flatMap((sc) => [inr(sc.rows[i].annual), inr(sc.rows[i].value)])])}
                    highlightLastRow
                  />
                </YearTableWrap>
              </Section>

              {hasStep && (
                <Section n={2} title={`Step-up SIP (+${fmtPct(stepUpPct)}/yr) — year-wise value`}>
                  <YearTableWrap>
                    <Table
                      head={["Year", ...res.flatMap((sc) => [`Invested @ ${fmtPct(sc.ratePct)}`, `Year-end value @ ${fmtPct(sc.ratePct)}`])]}
                      rows={s1.stepUp!.rows.map((r, i) => [
                        `${r.year}`,
                        ...res.flatMap((sc) => [inr(sc.stepUp!.rows[i].annual), inr(sc.stepUp!.rows[i].value)]),
                      ])}
                      highlightLastRow
                    />
                  </YearTableWrap>
                </Section>
              )}

              {s1.delay && s1.delay.length > 0 && (
                <Section n={hasStep ? 3 : 2} title="Cost of delaying the SIP">
                  <YearTableWrap>
                    <Table
                      head={["Start delayed by", ...scenarioHead("Monthly SIP"), ...scenarioHead("Total invested")]}
                      rows={[
                        ["No delay", ...res.map((sc) => inr(sc.sip)), ...res.map((sc) => inr(sc.total))],
                        ...s1.delay.map((d, i) => [
                          `${d.delayYears} yr${d.delayYears === 1 ? "" : "s"}`,
                          ...res.map((sc) => inr(sc.delay![i].sip)),
                          ...res.map((sc) => inr(sc.delay![i].total)),
                        ]),
                      ]}
                    />
                  </YearTableWrap>
                </Section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
