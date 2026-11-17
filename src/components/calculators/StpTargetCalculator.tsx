"use client";

/**
 * STP Required for Target Future Value — the lumpsum to place in a debt fund
 * today so a monthly STP into an equity fund reaches a target. Transfer by
 * capital appreciation, a fixed % of the initial investment, or a fixed ₹
 * amount (solved by bisection — the number of transfers depends on the
 * lumpsum). Math: @/lib/calculators/stp-comprehensive (`stpRequiredForTarget`;
 * verified to the reference case: ₹1 Cr · 12 yrs · 6% / 12% · 1% a month →
 * ₹33,51,520).
 */

import { useMemo, useState } from "react";
import { stpRequiredForTarget, type MonthlyStpMode } from "@/lib/calculators/stp-comprehensive";
import { inr, NumberField, Stat, Insight, Toggle } from "./ui";
import { MonthlyModeFields, StpYearTable, describeMonthlyMode } from "./StpParts";

export function StpTargetCalculator() {
  const [target, setTarget] = useState(10_000_000);
  const [years, setYears] = useState(12);
  const [debtPct, setDebtPct] = useState(6);
  const [equityPct, setEquityPct] = useState(12);
  const [mode, setMode] = useState<MonthlyStpMode>("fixedPct");
  const [amount, setAmount] = useState(30_000);
  const [pct, setPct] = useState(1);
  const [detailed, setDetailed] = useState(true);

  const { initialRequired, projection } = useMemo(
    () => stpRequiredForTarget({ target, years, debtPct, equityPct, mode, fixedAmount: amount, fixedPct: pct }),
    [target, years, debtPct, equityPct, mode, amount, pct]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">STP Required for Target Future Value</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Target future value (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="Debt fund return (% p.a.)" value={debtPct} setValue={setDebtPct} step={0.5} />
        <NumberField label="Equity fund return (% p.a.)" value={equityPct} setValue={setEquityPct} step={0.5} />
      </div>
      <MonthlyModeFields mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} pct={pct} setPct={setPct} />

      {!Number.isFinite(initialRequired) && (
        <Insight tone="amber">No lumpsum reaches this target with these returns.</Insight>
      )}

      {projection && Number.isFinite(initialRequired) && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Initial investment required" value={inr(initialRequired)} tone="cyan" />
            <Stat label="Debt fund value" value={inr(projection.debtFinalValue)} />
            <Stat label="Equity fund value" value={inr(projection.equityFinalValue)} />
            <Stat label="Total value" value={inr(projection.totalFinalValue)} />
            <Stat label="Annualised return" value={`${projection.annualisedReturnPct.toFixed(2)}%`} tone="emerald" />
          </div>

          <Insight tone="cyan">
            Place <strong>{inr(initialRequired)}</strong> in a {debtPct}% debt fund and move{" "}
            {describeMonthlyMode(mode, amount, pct).toLowerCase()}
            {mode === "fixedPct" && <> ({inr(projection.transferAmount)})</>} into a {equityPct}% equity fund to reach{" "}
            {inr(target)} in {years} years.
            {mode !== "appreciation" && projection.exhaustedAtPeriod != null && (
              <> Transfers stop after {projection.transfersMade} months, when the debt fund holds less than one.</>
            )}
          </Insight>

          <Toggle checked={detailed} onChange={setDetailed} label="Show year-wise table" />
          {detailed && <StpYearTable result={projection} />}
        </>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. Each month both funds earn their return (effective monthly rate), then the transfer
        is made at month end. Not investment advice.
      </p>
    </div>
  );
}
