"use client";

/**
 * PPF — maturity of a Public Provident Fund account: a fixed or year-by-year
 * deposit over the 15-year term, plus optional 5-year extensions with or
 * without fresh deposits. Math: src/lib/calculators/ppf.ts (annual
 * compounding, deposits by 5 April; ₹1,50,000 a year for 15 years at 7.1% →
 * ₹40,68,209).
 */

import { useMemo, useState } from "react";
import {
  PPF_DEFAULT_RATE_PCT, PPF_EXTENSION_YEARS, PPF_MAX_DEPOSIT, PPF_TERM_YEARS, ppfCalc, type PpfExtension,
} from "@/lib/calculators/ppf";
import { inr, fmtPct, NumberField, SmallNum, Stat, Table, Insight, Section, Segmented, Toggle } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, SUITE_COLORS, YearTableWrap } from "./sip-suite-ui";

const MAX_EXTENSIONS = 4;

export function PpfCalculator() {
  const [clientName, setClientName] = useState("");
  const [mode, setMode] = useState<"fixed" | "variable">("fixed");
  const [yearly, setYearly] = useState(PPF_MAX_DEPOSIT);
  const [amounts, setAmounts] = useState<number[]>(() => Array(PPF_TERM_YEARS + PPF_EXTENSION_YEARS * MAX_EXTENSIONS).fill(100000));
  const [rate, setRate] = useState(PPF_DEFAULT_RATE_PCT);
  const [extensions, setExtensions] = useState<PpfExtension[]>([]);

  const res = useMemo(
    () => ppfCalc({ mode, yearlyAmount: yearly, amounts, ratePct: rate, extensions }),
    [mode, yearly, amounts, rate, extensions],
  );

  function setExtCount(n: number) {
    setExtensions((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? { withContributions: true }));
  }
  function setExt(i: number, withContributions: boolean) {
    setExtensions((prev) => prev.map((e, j) => (j === i ? { withContributions } : e)));
  }
  function setAmount(i: number, v: number) {
    setAmounts((prev) => prev.map((a, j) => (j === i ? v : a)));
  }

  const contributingYears = res.rows.filter((r) => r.contributing).map((r) => r.year);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">PPF Maturity</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <Segmented
          label="Deposits"
          value={mode}
          onChange={setMode}
          options={[
            { value: "fixed", label: "Same every year" },
            { value: "variable", label: "Year by year" },
          ]}
        />
        {mode === "fixed" && <NumberField label="Yearly deposit (₹)" value={yearly} setValue={setYearly} step={5000} />}
        <NumberField label="Interest rate (% a year)" value={rate} setValue={setRate} step={0.1} />
        <Segmented
          label="5-year extensions"
          value={String(extensions.length)}
          onChange={(v) => setExtCount(Number(v))}
          options={Array.from({ length: MAX_EXTENSIONS + 1 }, (_, i) => ({ value: String(i), label: i === 0 ? "None" : `${i}` }))}
        />
      </div>

      {extensions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-md border border-border p-3">
          {extensions.map((e, i) => {
            const from = PPF_TERM_YEARS + i * PPF_EXTENSION_YEARS + 1;
            return (
              <Toggle
                key={i}
                checked={e.withContributions}
                onChange={(v) => setExt(i, v)}
                label={`Extension ${i + 1} (years ${from}–${from + PPF_EXTENSION_YEARS - 1}): keep depositing`}
              />
            );
          })}
        </div>
      )}

      {mode === "variable" && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Deposit for each year (₹)</div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {contributingYears.map((y) => (
              <SmallNum key={y} label={`Year ${y}`} value={amounts[y - 1] ?? 0} onChange={(v) => setAmount(y - 1, v)} />
            ))}
          </div>
        </div>
      )}

      {res.issues.length > 0 && (
        <Insight tone="amber">
          <ul className="list-disc pl-4 space-y-0.5">
            {res.issues.slice(0, 6).map((x) => <li key={x.year}>{x.message}</li>)}
            {res.issues.length > 6 && <li>…and {res.issues.length - 6} more years.</li>}
          </ul>
        </Insight>
      )}

      <PreparedFor name={clientName}>PPF over {res.years} years</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total deposited" value={inr(res.totalDeposited)} />
        <Stat label="Interest earned" value={inr(res.totalInterest)} tone="emerald" />
        <Stat label={`Maturity value (${res.years} yrs)`} value={inr(res.maturity)} tone="cyan" />
        {extensions.length > 0
          ? <Stat label={`At the end of the ${PPF_TERM_YEARS}-year term`} value={inr(res.termMaturity)} />
          : <Stat label="Interest rate" value={fmtPct(rate)} />}
      </div>

      {res.totalDeposited > 0 && (
        <Insight tone="cyan">
          Deposits of <strong>{inr(res.totalDeposited)}</strong> grow to <strong>{inr(res.maturity)}</strong> at {fmtPct(rate)} —
          interest of {inr(res.totalInterest)}, all of it tax-free (PPF is exempt at deposit, on interest and at
          maturity; deposits qualify under Section 80C in the old regime).
        </Insight>
      )}

      {res.rows.length > 0 && (
        <Section n={1} title="Balance year by year">
          <CalcChart
            data={res.rows.map((r) => ({
              year: r.year,
              deposited: res.rows.slice(0, r.year).reduce((s, x) => s + x.deposit, 0),
              balance: r.closing,
            }))}
            xKey="year"
            series={[
              { key: "balance", name: "Balance", color: SUITE_COLORS[0] },
              { key: "deposited", name: "Deposited to date", color: SUITE_COLORS[1] },
            ]}
          />
          <YearTableWrap>
            <Table
              head={["Year", "Phase", "Opening balance", "Deposit", "Interest", "Closing balance"]}
              rows={res.rows.map((r) => [
                `${r.year}`,
                r.phase === "term" ? "Term" : `Extension ${r.block}${r.contributing ? "" : " (no deposits)"}`,
                inr(r.opening),
                r.deposit > 0 ? inr(r.deposit) : "—",
                inr(r.interest),
                inr(r.closing),
              ])}
              highlightLastRow
            />
          </YearTableWrap>
          <p className="text-xs text-muted-foreground">
            Each deposit is assumed made by 5 April, so it earns the full year&apos;s interest; interest is credited
            every 31 March. Deposits are limited to ₹500–₹1,50,000 a financial year. The government resets the rate
            every quarter — one rate is applied throughout.
          </p>
        </Section>
      )}
    </div>
  );
}
