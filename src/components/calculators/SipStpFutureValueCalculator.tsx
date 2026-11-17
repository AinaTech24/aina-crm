"use client";

/**
 * Future Value of SIP + STP — a monthly SIP into an equity fund, plus a
 * lumpsum in a debt fund whose monthly gain is moved (capital appreciation
 * STP) into an equity fund. The SIP is paid at the start of each month at its
 * own rate; the STP transfer happens at month end. Math:
 * @/lib/calculators/stp-comprehensive (`computeSipStpFv`; verified to the
 * reference case: SIP ₹10,000 @12% + STP ₹10L 5% → 12%, 15 yrs → ₹76,80,092).
 */

import { useMemo, useState } from "react";
import { computeSipStpFv } from "@/lib/calculators/stp-comprehensive";
import { inr, NumberField, Stat, Insight, Toggle } from "./ui";
import { SipStpYearTable } from "./StpParts";

export function SipStpFutureValueCalculator() {
  const [monthlySip, setMonthlySip] = useState(10_000);
  const [sipRatePct, setSipRatePct] = useState(12);
  const [stpLumpsum, setStpLumpsum] = useState(1_000_000);
  const [debtPct, setDebtPct] = useState(5);
  const [equityPct, setEquityPct] = useState(12);
  const [years, setYears] = useState(15);
  const [detailed, setDetailed] = useState(true);

  const r = useMemo(
    () => computeSipStpFv({ monthlySip, sipRatePct, stpLumpsum, debtPct, equityPct, years }),
    [monthlySip, sipRatePct, stpLumpsum, debtPct, equityPct, years]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Future Value of SIP + STP</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        <NumberField label="SIP fund return (% p.a.)" value={sipRatePct} setValue={setSipRatePct} step={0.5} />
        <NumberField label="Investment period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="STP lumpsum in debt fund (₹)" value={stpLumpsum} setValue={setStpLumpsum} step={100000} />
        <NumberField label="Debt fund return (% p.a.)" value={debtPct} setValue={setDebtPct} step={0.5} />
        <NumberField label="Equity fund return (% p.a.)" value={equityPct} setValue={setEquityPct} step={0.5} />
      </div>
      <p className="text-2xs text-muted-foreground">
        Monthly transfer: capital appreciation — only the debt fund&apos;s gain moves to equity
        ({inr(r.monthlyTransfer)} a month), so the lumpsum itself stays in debt.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="SIP fund value" value={inr(r.sipValue)} />
        <Stat label="STP debt fund value" value={inr(r.stpDebtValue)} />
        <Stat label="STP equity fund value" value={inr(r.stpEquityValue)} />
        <Stat label="Total value" value={inr(r.total)} tone="cyan" />
      </div>

      {years > 0 && (
        <Insight tone="cyan">
          Investing {inr(r.totalInvested)} in all — {inr(monthlySip)} a month plus {inr(stpLumpsum)} up front — could
          grow to <strong>{inr(r.total)}</strong> in {years} years.
        </Insight>
      )}

      <Toggle checked={detailed} onChange={setDetailed} label="Show year-wise table" />
      {detailed && <SipStpYearTable rows={r.rows} />}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only, at an effective monthly rate for each fund. Not investment advice.
      </p>
    </div>
  );
}
