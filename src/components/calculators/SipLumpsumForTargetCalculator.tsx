"use client";

/**
 * SIP or Lumpsum for a Target — given a target, either the monthly SIP needed
 * on top of a lumpsum the client already has, or the lumpsum needed on top of
 * a SIP they can afford. Each leg has its own assumed return.
 * Math: sipLumpsumForTarget in src/lib/calculators/sip-suite.ts (effective
 * monthly rate, SIP at the start of each month, lumpsum compounding annually;
 * ₹1,00,00,000 in 15 years with ₹10,00,000 today, both at 12% → ₹9,511/month).
 */

import { useMemo, useState } from "react";
import { sipLumpsumForTarget } from "@/lib/calculators/sip-suite";
import { inr, fmtPct, NumberField, Segmented, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, ReportSwitch, SUITE_COLORS, YearTableWrap, type ReportView } from "./sip-suite-ui";

type Solve = "sip" | "lumpsum";

export function SipLumpsumForTargetCalculator() {
  const [clientName, setClientName] = useState("");
  const [target, setTarget] = useState(10000000);
  const [years, setYears] = useState(15);
  const [solve, setSolve] = useState<Solve>("sip");
  const [lumpsum, setLumpsum] = useState(1000000);
  const [monthlySip, setMonthlySip] = useState(10000);
  const [sipPct, setSipPct] = useState(12);
  const [lumpsumPct, setLumpsumPct] = useState(12);
  const [view, setView] = useState<ReportView>("detailed");

  const res = useMemo(
    () => sipLumpsumForTarget({ target, years, solve, lumpsum, monthlySip, sipPct, lumpsumPct }),
    [target, years, solve, lumpsum, monthlySip, sipPct, lumpsumPct],
  );
  const solved = solve === "sip" ? res.sip : res.lumpsum;
  const n = res.rows.length;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">SIP or Lumpsum for a Target</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Target amount (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <Segmented
          label="Work out"
          value={solve}
          onChange={setSolve}
          options={[
            { value: "sip", label: "SIP needed" },
            { value: "lumpsum", label: "Lumpsum needed" },
          ]}
        />
        {solve === "sip"
          ? <NumberField label="Lumpsum invested today (₹)" value={lumpsum} setValue={setLumpsum} step={50000} />
          : <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />}
        <NumberField label="SIP return (%)" value={sipPct} setValue={setSipPct} step={0.5} />
        <NumberField label="Lumpsum return (%)" value={lumpsumPct} setValue={setLumpsumPct} step={0.5} />
        <ReportSwitch value={view} onChange={setView} />
      </div>

      <PreparedFor name={clientName}>target {inr(target)} in {Math.max(0, Math.round(years))} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={solve === "sip" ? "Monthly SIP needed" : "Lumpsum needed today"} value={inr(solved)} tone="cyan" />
        <Stat label={solve === "sip" ? "Lumpsum today" : "Monthly SIP"} value={inr(solve === "sip" ? res.lumpsum : res.sip)} />
        <Stat label="Total invested" value={n > 0 ? inr(res.rows[n - 1].cumulative) : "—"} />
        <Stat label="Target" value={inr(target)} />
      </div>

      {res.covered ? (
        <Insight tone="emerald">
          The {solve === "sip" ? `lumpsum of ${inr(res.lumpsum)}` : `SIP of ${inr(res.sip)}/month`} alone already reaches{" "}
          {inr(target)} — nothing more is needed.
        </Insight>
      ) : Number.isFinite(solved) && n > 0 ? (
        <Insight tone="cyan">
          {solve === "sip"
            ? <>With {inr(res.lumpsum)} invested today at {fmtPct(lumpsumPct)}, a SIP of <strong>{inr(res.sip)}/month</strong> at {fmtPct(sipPct)} closes the gap to <strong>{inr(target)}</strong>.</>
            : <>Alongside {inr(res.sip)}/month at {fmtPct(sipPct)}, a lumpsum of <strong>{inr(res.lumpsum)}</strong> today at {fmtPct(lumpsumPct)} closes the gap to <strong>{inr(target)}</strong>.</>}
        </Insight>
      ) : (
        <Insight tone="amber">Enter an investment period of at least one year.</Insight>
      )}

      {view === "detailed" && n > 0 && (
        <Section n={1} title="Year-wise investment and value">
          <CalcChart
            data={res.rows.map((r) => ({ year: r.year, total: r.total, sip: r.sipValue, ls: r.lumpsumValue }))}
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
