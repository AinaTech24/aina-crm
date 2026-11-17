"use client";

/**
 * Future Value of a Lumpsum + SIP — a one-time investment today plus a monthly
 * SIP over the same period, each leg growing at its own assumed return.
 * Math: lumpsumPlusSipFv in src/lib/calculators/sip-suite.ts (effective monthly
 * rate, SIP at the start of each month; ₹15,000/month @15% + ₹10,00,000 @12%
 * for 10 years → ₹39,45,273 + ₹31,05,848 = ₹70,51,121).
 */

import { useMemo, useState } from "react";
import { lumpsumPlusSipFv } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

export function LumpsumSipFvCalculator() {
  const [clientName, setClientName] = useState("");
  const [monthlySip, setMonthlySip] = useState(15000);
  const [sipPct, setSipPct] = useState(15);
  const [lumpsum, setLumpsum] = useState(1000000);
  const [lumpsumPct, setLumpsumPct] = useState(12);
  const [years, setYears] = useState(10);
  const [view, setView] = useState<ReportView>("detailed");

  const res = useMemo(
    () => lumpsumPlusSipFv({ monthlySip, sipPct, lumpsum, lumpsumPct, years }),
    [monthlySip, sipPct, lumpsum, lumpsumPct, years],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of Lumpsum + SIP</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        <NumberField label="SIP return (%)" value={sipPct} setValue={setSipPct} step={0.5} />
        <NumberField label="Lumpsum today (₹)" value={lumpsum} setValue={setLumpsum} step={50000} />
        <NumberField label="Lumpsum return (%)" value={lumpsumPct} setValue={setLumpsumPct} step={0.5} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>{inr(monthlySip)}/month and {inr(lumpsum)} today, for {res.years} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total invested" value={inr(res.invested)} />
        <Stat label={`SIP value @ ${fmtPct(sipPct)}`} value={inr(res.sipFv)} />
        <Stat label={`Lumpsum value @ ${fmtPct(lumpsumPct)}`} value={inr(res.lumpsumFv)} />
        <Stat label="Total future value" value={inr(res.total)} tone="cyan" />
      </div>

      {res.years > 0 && res.total > 0 && (
        <Insight tone="cyan">
          Over {res.years} years the SIP builds <strong>{inr(res.sipFv)}</strong> and the lumpsum grows to{" "}
          <strong>{inr(res.lumpsumFv)}</strong> — <strong>{inr(res.total)}</strong> in all from{" "}
          {inr(res.invested)} put in.
        </Insight>
      )}

      {view === "detailed" && res.rows.length > 0 && (
        <Section n={1} title="Year-wise investment and value">
          <CalcChart
            data={res.rows.map((r) => ({ year: r.year, sip: r.sipValue, ls: r.lumpsumValue, total: r.total }))}
            xKey="year"
            series={[
              { key: "total", name: "Total", color: SUITE_COLORS[0] },
              { key: "sip", name: "SIP", color: SUITE_COLORS[1] },
              { key: "ls", name: "Lumpsum", color: SUITE_COLORS[2] },
            ]}
          />
          <YearTableWrap>
            <Table
              head={["Year", "Invested in year", "Invested to date", "SIP value", "Lumpsum value", "Total value"]}
              rows={res.rows.map((r) => [
                `${r.year}`, inr(r.annual), inr(r.cumulative), inr(r.sipValue), inr(r.lumpsumValue), inr(r.total),
              ])}
              highlightLastRow
            />
          </YearTableWrap>
        </Section>
      )}
    </div>
  );
}
