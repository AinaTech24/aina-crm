"use client";

/**
 * Future Value of STP — a lumpsum placed in a debt fund and moved into an
 * equity fund every month, by capital appreciation, a fixed ₹ amount or a fixed
 * % of the initial investment, until the debt fund cannot cover a transfer.
 * Math: @/lib/calculators/stp-comprehensive (`computeMonthlyStp`; verified to
 * the reference case: ₹25L · ₹50,000/month · 10 yrs · 5% / 12% → ₹67,23,507,
 * 10.40% a year).
 */

import { useMemo, useState } from "react";
import { computeMonthlyStp, type MonthlyStpMode } from "@/lib/calculators/stp-comprehensive";
import { inr, NumberField, Stat, Insight, Toggle } from "./ui";
import { MonthlyModeFields, StpYearTable, describeMonthlyMode } from "./StpParts";

export function StpFutureValueCalculator() {
  const [initial, setInitial] = useState(2_500_000);
  const [years, setYears] = useState(10);
  const [debtPct, setDebtPct] = useState(5);
  const [equityPct, setEquityPct] = useState(12);
  const [mode, setMode] = useState<MonthlyStpMode>("fixedAmount");
  const [amount, setAmount] = useState(50_000);
  const [pct, setPct] = useState(2);
  const [detailed, setDetailed] = useState(true);

  const result = useMemo(
    () => computeMonthlyStp({ initial, years, debtPct, equityPct, mode, fixedAmount: amount, fixedPct: pct }),
    [initial, years, debtPct, equityPct, mode, amount, pct]
  );
  const months = Math.round(years * 12);
  const stopped = result.exhaustedAtPeriod;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of STP</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Initial investment (₹)" value={initial} setValue={setInitial} step={100000} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="Debt fund return (% p.a.)" value={debtPct} setValue={setDebtPct} step={0.5} />
        <NumberField label="Equity fund return (% p.a.)" value={equityPct} setValue={setEquityPct} step={0.5} />
      </div>
      <MonthlyModeFields mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} pct={pct} setPct={setPct} />

      {months > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Debt fund value" value={inr(result.debtFinalValue)} />
            <Stat label="Equity fund value" value={inr(result.equityFinalValue)} />
            <Stat label="Total value" value={inr(result.totalFinalValue)} tone="cyan" />
            <Stat label="Annualised return" value={`${result.annualisedReturnPct.toFixed(2)}%`} tone="emerald" />
          </div>

          <Insight tone="cyan">
            {inr(initial)} in a {debtPct}% debt fund, moving {describeMonthlyMode(mode, amount, pct).toLowerCase()} into a{" "}
            {equityPct}% equity fund, could be worth <strong>{inr(result.totalFinalValue)}</strong> after {years} years.
            {mode !== "appreciation" && (
              stopped != null
                ? <> The debt fund covers {result.transfersMade} transfers; from month {stopped} it holds less than one, so the remaining {inr(result.debtFinalValue)} stays in debt.</>
                : <> All {result.transfersMade} monthly transfers are covered by the debt fund.</>
            )}
          </Insight>

          <Toggle checked={detailed} onChange={setDetailed} label="Show year-wise table" />
          {detailed && <StpYearTable result={result} />}
        </>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. Each month both funds earn their return (effective monthly rate), then the transfer
        is made at month end. Not investment advice.
      </p>
    </div>
  );
}
