"use client";

/**
 * STP Comprehensive Planner.
 *
 * Future value of a lumpsum routed Debt → Equity via a Systematic Transfer Plan,
 * with Capital-Appreciation or Fixed transfers (a ₹ amount or a % of the
 * initial investment) at any frequency (daily … annually). Shows the
 * year-by-year debt/equity split and the blended annualised return.
 *
 * Math lives in @/lib/calculators/stp-comprehensive (calibrated to the reference
 * case study to the rupee). A fixed transfer the debt fund cannot cover in full
 * is skipped, not swept — the remainder stays in debt.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { SelectField } from "@/components/ui/SelectField";
import {
  computeStpComprehensive, STP_FREQUENCIES, type StpFixedBasis, type StpFrequency, type StpTransferMode,
} from "@/lib/calculators/stp-comprehensive";
import { inr, NumberField, Field, Segmented, Stat, Insight } from "./ui";
import { StpYearTable } from "./StpParts";

export function StpComprehensivePlanner() {
  const [addClientName, setAddClientName] = useState(false);
  const [clientName, setClientName] = useState("");
  const [addSchemes, setAddSchemes] = useState(false);
  const [schemes, setSchemes] = useState("");

  const [initialInvestment, setInitialInvestment] = useState(2500000);
  const [debtReturnPct, setDebtReturnPct] = useState(5);
  const [equityReturnPct, setEquityReturnPct] = useState(12);
  const [transferMode, setTransferMode] = useState<StpTransferMode>("fixed");
  const [fixedBasis, setFixedBasis] = useState<StpFixedBasis>("amount");
  const [frequency, setFrequency] = useState<StpFrequency>("weekly");
  const [numInstallments, setNumInstallments] = useState(50);
  const [fixedTransferAmount, setFixedTransferAmount] = useState(50000);
  const [fixedTransferPct, setFixedTransferPct] = useState(2);

  const [periodUnit, setPeriodUnit] = useState<"years" | "months">("years");
  const [periodValue, setPeriodValue] = useState(10);
  const [reportDetail, setReportDetail] = useState(true); // Detail vs Summary

  const totalMonths = periodUnit === "years" ? periodValue * 12 : periodValue;

  const result = useMemo(
    () =>
      computeStpComprehensive({
        initialInvestment, debtReturnPct, equityReturnPct, transferMode, frequency,
        numInstallments, fixedBasis, fixedTransferAmount, fixedTransferPct, totalMonths,
      }),
    [initialInvestment, debtReturnPct, equityReturnPct, transferMode, frequency, numInstallments, fixedBasis, fixedTransferAmount, fixedTransferPct, totalMonths]
  );
  const freqLabel = STP_FREQUENCIES.find((f) => f.value === frequency)?.label.toLowerCase();
  const short = transferMode === "fixed" && result.exhaustedAtPeriod != null;

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">STP Comprehensive Planner{addClientName && clientName ? ` · ${clientName}` : ""}</h2>
      </div>

      {/* Core inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Initial investment (₹)" value={initialInvestment} setValue={setInitialInvestment} />
        <NumberField label="Debt fund return (% p.a.)" value={debtReturnPct} setValue={setDebtReturnPct} step={0.5} />
        <NumberField label="Equity fund return (% p.a.)" value={equityReturnPct} setValue={setEquityReturnPct} step={0.5} />
      </div>

      {/* Transfer mode */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <Segmented
              label="Transfer mode"
              value={transferMode}
              onChange={setTransferMode}
              options={[
                { value: "appreciation", label: "Capital appreciation" },
                { value: "fixed", label: "Fixed transfer" },
              ]}
            />
            {transferMode === "fixed" && (
              <Segmented
                label="Fixed by"
                value={fixedBasis}
                onChange={setFixedBasis}
                options={[
                  { value: "amount", label: "₹ amount" },
                  { value: "pctOfInitial", label: "% of initial" },
                ]}
              />
            )}
          </div>
          <p className="text-2xs text-muted-foreground">
            {transferMode === "appreciation"
              ? "Only the debt fund's gains move to equity — the principal stays in debt."
              : "A fixed transfer moves to equity each period, for the chosen number of instalments, while the debt fund can cover it."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Transfer frequency">
            <SelectField value={frequency} onChange={(e) => setFrequency(e.target.value as StpFrequency)} className="w-full">
              {STP_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </SelectField>
          </Field>
          <NumberField label="No. of instalments" value={numInstallments} setValue={setNumInstallments} step={1} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        {transferMode === "fixed" && fixedBasis === "amount" && (
          <NumberField label="Each transfer amount (₹)" value={fixedTransferAmount} setValue={setFixedTransferAmount} />
        )}
        {transferMode === "fixed" && fixedBasis === "pctOfInitial" && (
          <NumberField label="Each transfer (% of initial)" value={fixedTransferPct} setValue={setFixedTransferPct} step={0.25} />
        )}
        <Field label="Total investment period">
          <div className="flex gap-2">
            <input
              type="number"
              value={periodValue}
              min={0}
              step={1}
              onChange={(e) => setPeriodValue(Math.max(0, Number(e.target.value) || 0))}
              className="input-base text-sm w-full"
            />
            <SelectField value={periodUnit} onChange={(e) => setPeriodUnit(e.target.value as "years" | "months")} className="w-28">
              <option value="years">Years</option>
              <option value="months">Months</option>
            </SelectField>
          </div>
        </Field>
        <Field label="Report">
          <SelectField value={reportDetail ? "detail" : "summary"} onChange={(e) => setReportDetail(e.target.value === "detail")} className="w-full">
            <option value="summary">Summary</option>
            <option value="detail">Detail (year-by-year)</option>
          </SelectField>
        </Field>
      </div>

      {/* Optional: client + schemes */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={addClientName} onChange={(e) => setAddClientName(e.target.checked)} /> Add client name
          </label>
          {addClientName && <div className="mt-1 w-56"><ClientNameField value={clientName} onChange={setClientName} /></div>}
        </div>
        <div className="flex-1 min-w-60">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={addSchemes} onChange={(e) => setAddSchemes(e.target.checked)} /> Add suggested schemes
          </label>
          {addSchemes && (
            <div className="mt-1">
              <SchemeAutocomplete
                size="sm"
                placeholder="Search your Scheme Master to add…"
                onSelect={(s) => setSchemes(schemes ? `${schemes}, ${s.schemeName}` : s.schemeName)}
              />
              {schemes && (
                <div className="mt-1 flex items-start gap-1.5 text-2xs text-muted-foreground">
                  <span className="flex-1">{schemes}</span>
                  <button type="button" onClick={() => setSchemes("")} className="text-rose-600 hover:underline shrink-0">clear</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Debt fund value" value={inr(result.debtFinalValue)} />
        <Stat label="Equity fund value" value={inr(result.equityFinalValue)} tone="emerald" />
        <Stat label="Total fund value" value={inr(result.totalFinalValue)} tone="emerald" />
        <Stat label="Annualised return" value={`${result.annualisedReturnPct.toFixed(2)}%`} tone="emerald" />
      </div>
      <div className="text-2xs text-muted-foreground">
        {transferMode === "fixed" && <>Each transfer: <strong>{inr(result.transferAmount)}</strong>. </>}
        Total transferred to equity: <strong>{inr(result.totalTransferred)}</strong> in {result.transfersMade} {freqLabel}{" "}
        transfer(s) over {result.totalPeriods} period(s).
      </div>
      {short && (
        <Insight tone="amber">
          The debt fund covers only {result.transfersMade} of the {numInstallments} instalments; the remaining{" "}
          {inr(result.debtFinalValue)} is left in debt rather than moved as a part transfer.
        </Insight>
      )}

      {/* Year-by-year (Detail) */}
      {reportDetail && <StpYearTable result={result} title="Projected annual investment value" />}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only, on the assumptions you enter. The plan is simulated at the transfer frequency (effective rate);
        actual results vary with market performance. Not investment advice.
      </p>
    </div>
  );
}
