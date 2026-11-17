"use client";

/**
 * Pieces shared by the STP calculators (Future Value of STP, STP Comprehensive,
 * STP Required for Target, SIP + STP, the two STP ready reckoners): the
 * transfer-rule picker, the year-wise debt → equity table and the reckoner
 * grid. Presentation only — every figure comes from
 * @/lib/calculators/stp-comprehensive.
 */

import { useMemo, useState } from "react";
import {
  stpReckonerGrid, type MonthlyStpMode, type SipStpRow, type StpComprehensiveResult, type StpScenario,
} from "@/lib/calculators/stp-comprehensive";
import { inr, NumberField, Segmented, Section, SmallNum, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

/* ───────────── transfer rule ───────────── */

export function describeMonthlyMode(mode: MonthlyStpMode, amount: number, pct: number): string {
  if (mode === "appreciation") return "Capital appreciation (the debt fund's monthly gain)";
  if (mode === "fixedPct") return `${pct}% of the initial investment every month`;
  return `${inr(amount)} every month`;
}

/** Capital appreciation | Fixed transfer → (Fixed amount ₹ | Fixed % of initial). */
export function MonthlyModeFields({
  mode, setMode, amount, setAmount, pct, setPct, allowAmount = true,
}: {
  mode: MonthlyStpMode;
  setMode: (m: MonthlyStpMode) => void;
  amount: number;
  setAmount: (v: number) => void;
  pct: number;
  setPct: (v: number) => void;
  /** The reckoners offer only "% of initial" as a fixed transfer. */
  allowAmount?: boolean;
}) {
  const fixed = mode !== "appreciation";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Segmented
        label="Monthly transfer"
        value={fixed ? "fixed" : "appreciation"}
        onChange={(v) => setMode(v === "appreciation" ? "appreciation" : allowAmount ? "fixedAmount" : "fixedPct")}
        options={[
          { value: "appreciation", label: "Capital appreciation" },
          { value: "fixed", label: "Fixed transfer" },
        ]}
      />
      {fixed && allowAmount && (
        <Segmented
          label="Fixed by"
          value={mode}
          onChange={setMode}
          options={[
            { value: "fixedAmount", label: "₹ amount" },
            { value: "fixedPct", label: "% of initial" },
          ]}
        />
      )}
      {mode === "fixedAmount" && (
        <div className="w-44"><NumberField label="Transfer / month (₹)" value={amount} setValue={setAmount} step={1000} /></div>
      )}
      {mode === "fixedPct" && (
        <div className="w-44"><NumberField label="Transfer / month (% of initial)" value={pct} setValue={setPct} step={0.25} /></div>
      )}
    </div>
  );
}

/* ───────────── year-wise table ───────────── */

export function StpYearTable({ result, title = "Year-wise value of the plan", n = 1 }: { result: StpComprehensiveResult; title?: string; n?: number }) {
  if (result.schedule.length === 0) return null;
  return (
    <Section n={n} title={title}>
      <CalcChart
        data={result.schedule.map((r) => ({ year: r.year, debt: r.totalEnd - r.equityEnd, equity: r.equityEnd }))}
        xKey="year"
        series={[
          { key: "equity", name: "Equity fund", color: "#10b981" },
          { key: "debt", name: "Debt fund", color: "#0ea5e9" },
        ]}
      />
      <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
        <Table
          head={["Year", "Debt at start", "Moved to equity", "Equity at start", "Equity at end", "Total at end", "Annualised"]}
          rows={result.schedule.map((r) => [
            `${r.year}`,
            inr(r.debtBeginning),
            r.transferredToEquity > 0 ? inr(r.transferredToEquity) : "—",
            inr(r.equityBeginning),
            inr(r.equityEnd),
            inr(r.totalEnd),
            `${r.annualisedReturnPct.toFixed(2)}%`,
          ])}
          highlightLastRow
        />
      </div>
    </Section>
  );
}

/* ───────────── SIP + STP year-wise table (#12 / #42) ───────────── */

export function SipStpYearTable({ rows, n = 1 }: { rows: SipStpRow[]; n?: number }) {
  if (rows.length === 0) return null;
  return (
    <Section n={n} title="Year-wise investment and value">
      <CalcChart
        data={rows.map((r) => ({ year: r.year, sip: r.sipValue, stp: r.stpValue, invested: r.cumulativeInvestment }))}
        xKey="year"
        series={[
          { key: "sip", name: "SIP fund", color: "#10b981" },
          { key: "stp", name: "STP (debt + equity)", color: "#0ea5e9" },
          { key: "invested", name: "Invested", color: "#94a3b8" },
        ]}
      />
      <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
        <Table
          head={["Year", "Invested in the year", "Invested to date", "SIP fund", "STP fund", "Total"]}
          rows={rows.map((r) => [
            `${r.year}`,
            inr(r.annualInvestment),
            inr(r.cumulativeInvestment),
            inr(r.sipValue),
            inr(r.stpValue),
            inr(r.total),
          ])}
          highlightLastRow
        />
      </div>
    </Section>
  );
}

/* ───────────── ready-reckoner grid (#45 / #46) ───────────── */

const lakh = (n: number) => (Number.isFinite(n) ? (n / 1e5).toFixed(2) : "—");

export function StpReckoner({ kind }: { kind: "fv" | "need" }) {
  const [amount, setAmount] = useState(5_000_000);
  const [mode, setMode] = useState<MonthlyStpMode>("appreciation");
  const [pct, setPct] = useState(1);
  const [scenarios, setScenarios] = useState<StpScenario[]>([
    { debtPct: 5, equityPct: 10 },
    { debtPct: 6, equityPct: 12 },
    { debtPct: 7, equityPct: 15 },
  ]);
  const [years, setYears] = useState<number[]>([5, 10, 15, 20, 25]);

  const grid = useMemo(
    () =>
      stpReckonerGrid({
        kind, amount, scenarios, years, mode: mode === "fixedPct" ? "fixedPct" : "appreciation", fixedPct: pct,
      }),
    [kind, amount, scenarios, years, mode, pct]
  );

  const setScenario = (i: number, patch: Partial<StpScenario>) =>
    setScenarios((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setYear = (i: number, v: number) => setYears((y) => y.map((x, k) => (k === i ? Math.round(v) : x)));

  const best = grid.length > 0 && grid[0].length > 0 ? grid[grid.length - 1][grid[0].length - 1] : NaN;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">
        {kind === "fv" ? "STP Future Value Ready Reckoner" : "STP Need-Based Ready Reckoner"}
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <NumberField
            label={kind === "fv" ? "Initial investment in the debt fund (₹)" : "Target amount (₹)"}
            value={amount}
            setValue={setAmount}
            step={100000}
          />
          <MonthlyModeFields
            mode={mode} setMode={setMode} amount={0} setAmount={() => undefined} pct={pct} setPct={setPct} allowAmount={false}
          />
        </div>
        <div className="space-y-3">
          <div>
            <span className="text-2xs uppercase tracking-wide text-muted-foreground font-medium block mb-1">
              Return scenarios (debt fund | equity fund, % p.a.)
            </span>
            <div className="grid grid-cols-3 gap-2">
              {scenarios.map((s, i) => (
                <div key={i} className="grid grid-cols-2 gap-1">
                  <SmallNum label={`Debt ${i + 1}`} value={s.debtPct} onChange={(v) => setScenario(i, { debtPct: v })} />
                  <SmallNum label={`Equity ${i + 1}`} value={s.equityPct} onChange={(v) => setScenario(i, { equityPct: v })} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <span className="text-2xs uppercase tracking-wide text-muted-foreground font-medium block mb-1">STP periods (years)</span>
            <div className="grid grid-cols-5 gap-2">
              {years.map((y, i) => (
                <SmallNum key={i} label={`Period ${i + 1}`} value={y} onChange={(v) => setYear(i, v)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <Section n={1} title={kind === "fv" ? "Future value of the initial investment (₹ lakh)" : "Initial investment required (₹ lakh)"}>
        <Table
          head={["Debt | equity return", ...years.map((y) => `${y} yrs`)]}
          rows={scenarios.map((s, i) => [`${s.debtPct}% | ${s.equityPct}%`, ...grid[i].map(lakh)])}
        />
      </Section>

      {Number.isFinite(best) && (
        <Insight tone="cyan">
          {kind === "fv" ? (
            <>
              {inr(amount)} parked in a {scenarios[scenarios.length - 1].debtPct}% debt fund and moved into a{" "}
              {scenarios[scenarios.length - 1].equityPct}% equity fund ({describeMonthlyMode(mode, 0, pct).toLowerCase()}) could grow to{" "}
              <strong>{inr(best)}</strong> in {years[years.length - 1]} years.
            </>
          ) : (
            <>
              At {scenarios[scenarios.length - 1].debtPct}% | {scenarios[scenarios.length - 1].equityPct}% over{" "}
              {years[years.length - 1]} years, about <strong>{inr(best)}</strong> placed today reaches {inr(amount)}.
            </>
          )}
        </Insight>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. Transfers are made at each month end after both funds earn that month&apos;s return
        (effective monthly rate); a fixed transfer stops once the debt fund holds less than one transfer. Not investment advice.
      </p>
    </div>
  );
}
