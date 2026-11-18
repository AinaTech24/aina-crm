"use client";

/**
 * Compounding — what a sum grows to at a quoted rate compounded yearly,
 * half-yearly, quarterly, monthly or daily, with an optional regular addition,
 * and the effective annual rate that frequency gives.
 * Math: src/lib/calculators/compounding.ts (₹1,00,000 at 10% quarterly for
 * 5 years → ₹1,63,862; effective rate 10.38%).
 */

import { useMemo, useState } from "react";
import {
  compounding, effectiveAnnualRate, COMPOUND_PERIODS,
  type AdditionFrequency, type CompoundFrequency,
} from "@/lib/calculators/compounding";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section, Segmented, Field } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, SUITE_COLORS, YearTableWrap } from "./sip-suite-ui";

const FREQ_LABEL: Record<CompoundFrequency, string> = {
  yearly: "Yearly",
  half_yearly: "Half-yearly",
  quarterly: "Quarterly",
  monthly: "Monthly",
  daily: "Daily",
};

const ADD_LABEL: Record<AdditionFrequency, string> = {
  monthly: "Every month",
  quarterly: "Every quarter",
  half_yearly: "Every half-year",
  yearly: "Every year",
};

export function CompoundingCalculator() {
  const [clientName, setClientName] = useState("");
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(8);
  const [years, setYears] = useState(10);
  const [frequency, setFrequency] = useState<CompoundFrequency>("quarterly");
  const [addition, setAddition] = useState(0);
  const [addFreq, setAddFreq] = useState<AdditionFrequency>("monthly");
  const [timing, setTiming] = useState<"start" | "end">("end");

  const res = useMemo(
    () => compounding({ principal, ratePct: rate, years, frequency, addition, additionFrequency: addFreq, additionTiming: timing }),
    [principal, rate, years, frequency, addition, addFreq, timing],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Compound Interest</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Principal (₹)" value={principal} setValue={setPrincipal} step={10000} />
        <NumberField label="Interest rate (% a year)" value={rate} setValue={setRate} step={0.25} />
        <NumberField label="Period (years)" value={years} setValue={(v) => setYears(Math.round(v))} step={1} />
        <Field label="Compounded">
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as CompoundFrequency)} className="input-base text-sm w-full">
            {(Object.keys(FREQ_LABEL) as CompoundFrequency[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
          </select>
        </Field>
        <NumberField label="Regular addition (₹, optional)" value={addition} setValue={setAddition} step={1000} />
        {addition > 0 && (
          <>
            <Field label="Added">
              <select value={addFreq} onChange={(e) => setAddFreq(e.target.value as AdditionFrequency)} className="input-base text-sm w-full">
                {(Object.keys(ADD_LABEL) as AdditionFrequency[]).map((f) => <option key={f} value={f}>{ADD_LABEL[f]}</option>)}
              </select>
            </Field>
            <Segmented
              label="Addition made at the"
              value={timing}
              onChange={setTiming}
              options={[
                { value: "start", label: "Start of the period" },
                { value: "end", label: "End of the period" },
              ]}
            />
          </>
        )}
      </div>

      <PreparedFor name={clientName}>{inr(principal)} at {fmtPct(rate)} compounded {FREQ_LABEL[frequency].toLowerCase()}</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Amount invested" value={inr(res.invested)} />
        <Stat label="Interest earned" value={inr(res.interest)} tone="emerald" />
        <Stat label={`Value after ${years} yrs`} value={inr(res.total)} tone="cyan" />
        <Stat label="Effective annual rate" value={`${res.effectiveRatePct.toFixed(2)}%`} />
      </div>

      {res.total > 0 && years > 0 && (
        <Insight tone="cyan">
          {fmtPct(rate)} compounded {FREQ_LABEL[frequency].toLowerCase()} works out to{" "}
          <strong>{res.effectiveRatePct.toFixed(2)}%</strong> a year, so {inr(res.invested)} grows to{" "}
          <strong>{inr(res.total)}</strong> in {years} years.
          {frequency !== "yearly" && (
            <> Compounded only once a year it would earn {fmtPct(rate)} flat; daily compounding would give{" "}
              {effectiveAnnualRate(rate, COMPOUND_PERIODS.daily).toFixed(2)}%.</>
          )}
        </Insight>
      )}

      {res.rows.length > 0 && (
        <Section n={1} title="Growth year by year">
          <CalcChart
            data={res.rows.map((r) => ({ year: r.year, total: r.total, invested: r.invested }))}
            xKey="year"
            series={[
              { key: "total", name: "Total value", color: SUITE_COLORS[0] },
              { key: "invested", name: "Amount invested", color: SUITE_COLORS[1] },
            ]}
          />
          <YearTableWrap>
            <Table
              head={["Year", "Amount invested", "Interest this year", "Interest to date", "Total value"]}
              rows={res.rows.map((r) => [
                `${r.year}`,
                inr(r.invested),
                inr(r.interestThisYear),
                inr(r.interest),
                inr(r.total),
              ])}
              highlightLastRow
            />
          </YearTableWrap>
          <p className="text-xs text-muted-foreground">
            Value = principal × (1 + rate ÷ n)^(n × years), n = compounding periods a year (365 for daily). An
            addition between compounding dates grows for the fraction of the period it is held, as banks reckon
            recurring deposits.
          </p>
        </Section>
      )}
    </div>
  );
}
