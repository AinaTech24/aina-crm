"use client";

/**
 * SIP / STP Required for Target Future Value — a lumpsum in a debt fund whose
 * monthly gain is moved (capital appreciation STP) into equity, topped up by a
 * monthly SIP. Solves the SIP needed for a given lumpsum, or the lumpsum
 * needed for a given SIP. Math: @/lib/calculators/stp-comprehensive
 * (`computeSipStpForTarget`; verified to the reference case: ₹25L · 10 yrs ·
 * STP ₹5L 6% → 12% · SIP @12% → ₹6,516 a month).
 */

import { useMemo, useState } from "react";
import { computeSipStpForTarget } from "@/lib/calculators/stp-comprehensive";
import { inr, NumberField, Segmented, Stat, Insight, Toggle } from "./ui";
import { SipStpYearTable } from "./StpParts";

export function SipStpTargetCalculator() {
  const [target, setTarget] = useState(2_500_000);
  const [years, setYears] = useState(10);
  const [solve, setSolve] = useState<"sip" | "stp">("sip");
  const [stpLumpsum, setStpLumpsum] = useState(500_000);
  const [monthlySip, setMonthlySip] = useState(5_000);
  const [debtPct, setDebtPct] = useState(6);
  const [equityPct, setEquityPct] = useState(12);
  const [sipRatePct, setSipRatePct] = useState(12);
  const [detailed, setDetailed] = useState(true);

  const r = useMemo(
    () => computeSipStpForTarget({ target, years, solve, stpLumpsum, monthlySip, debtPct, equityPct, sipRatePct }),
    [target, years, solve, stpLumpsum, monthlySip, debtPct, equityPct, sipRatePct]
  );
  const p = r.projection;
  const solved = solve === "sip" ? r.monthlySip : r.stpLumpsum;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">SIP / STP Required for Target Future Value</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Target amount (₹)" value={target} setValue={setTarget} step={100000} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <Segmented
          label="Calculate"
          value={solve}
          onChange={setSolve}
          options={[
            { value: "sip", label: "Monthly SIP" },
            { value: "stp", label: "STP lumpsum" },
          ]}
        />
        {solve === "sip" ? (
          <NumberField label="STP lumpsum in debt fund (₹)" value={stpLumpsum} setValue={setStpLumpsum} step={100000} />
        ) : (
          <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        )}
        <NumberField label="Debt fund return (% p.a.)" value={debtPct} setValue={setDebtPct} step={0.5} />
        <NumberField label="Equity fund return (% p.a.)" value={equityPct} setValue={setEquityPct} step={0.5} />
        <NumberField label="SIP fund return (% p.a.)" value={sipRatePct} setValue={setSipRatePct} step={0.5} />
      </div>
      <p className="text-2xs text-muted-foreground">
        Monthly transfer: capital appreciation — only the debt fund&apos;s gain moves to equity; the lumpsum stays in debt.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={solve === "sip" ? "Monthly SIP required" : "STP lumpsum required"} value={inr(solved)} tone="cyan" />
        <Stat label="SIP fund value" value={inr(p.sipValue)} />
        <Stat label="STP fund value" value={inr(p.stpValue)} />
        <Stat label="Total value" value={inr(p.total)} tone="emerald" />
      </div>

      {r.overshoots ? (
        <Insight tone="amber">
          {solve === "sip"
            ? <>The STP lumpsum alone grows past {inr(target)} in {years} years — no SIP is needed.</>
            : <>The SIP alone grows past {inr(target)} in {years} years — no STP lumpsum is needed.</>}
        </Insight>
      ) : (
        Number.isFinite(solved) && years > 0 && (
          <Insight tone="cyan">
            {solve === "sip"
              ? <>With {inr(stpLumpsum)} in the STP, a SIP of <strong>{inr(solved)} a month</strong> reaches {inr(target)} in {years} years.</>
              : <>With a SIP of {inr(monthlySip)} a month, placing <strong>{inr(solved)}</strong> in the STP reaches {inr(target)} in {years} years.</>}
          </Insight>
        )
      )}

      <Toggle checked={detailed} onChange={setDetailed} label="Show year-wise table" />
      {detailed && <SipStpYearTable rows={p.rows} />}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. The SIP is paid at the start of each month; the STP transfer is made at month end.
        Effective monthly rates. Not investment advice.
      </p>
    </div>
  );
}
