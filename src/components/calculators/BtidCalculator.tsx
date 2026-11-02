"use client";

/**
 * BTID — "Buy Term, Invest the Difference" vs a ULIP / endowment / money-back
 * policy. Shows the wealth gap AND the protection gap. The MFD's sharpest
 * insurance cross-sell tool. Math: src/lib/calculators/advisory.ts → btid.
 */

import { useMemo, useState } from "react";
import { btid } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

export function BtidCalculator() {
  const [clientName, setClientName] = useState("");
  const [annualBudget, setAnnualBudget] = useState(100000);
  const [termPremium, setTermPremium] = useState(15000);
  const [termCover, setTermCover] = useState(10000000);
  const [years, setYears] = useState(25);
  const [mfReturn, setMfReturn] = useState(12);
  const [tradReturn, setTradReturn] = useState(5.5);

  const res = useMemo(
    () =>
      btid({
        annualBudget,
        termAnnualPremium: termPremium,
        termCover,
        years,
        mfReturnPct: mfReturn,
        tradReturnPct: tradReturn,
      }),
    [annualBudget, termPremium, termCover, years, mfReturn, tradReturn],
  );
  const mfAhead = res.wealthGap >= 0;
  const coverAhead = res.coverGap >= 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Term + MF vs ULIP / Endowment</h2>
        
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Yearly budget (₹)" value={annualBudget} setValue={setAnnualBudget} step={10000} />
        <NumberField label="Term plan premium / yr (₹)" value={termPremium} setValue={setTermPremium} step={1000} />
        <NumberField label="Term cover (₹)" value={termCover} setValue={setTermCover} step={500000} />
        <NumberField label="Horizon (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="MF return (% p.a.)" value={mfReturn} setValue={setMfReturn} step={0.5} />
        <NumberField label="ULIP/endowment return (% p.a.)" value={tradReturn} setValue={setTradReturn} step={0.5} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Term + MF — corpus (post-tax)" value={inr(Math.round(res.btidPostTax))} tone={mfAhead ? "emerald" : "amber"} />
        <Stat label="Traditional — corpus" value={inr(Math.round(res.tradPostTax))} tone={mfAhead ? "amber" : "emerald"} />
        <Stat label="Term + MF — cover" value={inrShort(res.btidCover)} tone={coverAhead ? "emerald" : "rose"} />
        <Stat label="Traditional — cover" value={inrShort(res.tradCover)} tone={coverAhead ? "rose" : "emerald"} />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Term + MF (post-tax)", value: res.btidPostTax, color: "#10b981" },
          { label: "ULIP/Endowment", value: res.tradPostTax, color: "#f59e0b" },
        ]}
      />

      <Insight tone={mfAhead && coverAhead ? "emerald" : "amber"}>
        For the same {inr(annualBudget)}/year, <strong>Term + MF</strong> builds{" "}
        <strong>{inrShort(res.btidPostTax)}</strong> after LTCG with {inrShort(res.btidCover)} cover — versus{" "}
        <strong>{inrShort(res.tradPostTax)}</strong> and {inrShort(res.tradCover)} cover from a bundled policy. That&rsquo;s{" "}
        <strong>{inrShort(Math.abs(res.wealthGap))}</strong> {mfAhead ? "more" : "less"} wealth and{" "}
        {inrShort(Math.abs(res.coverGap))} {coverAhead ? "more" : "less"} protection.
        {mfAhead && coverAhead && " Insurance and investment do their jobs best when kept separate."}
      </Insight>

      <p className="text-2xs text-muted-foreground">
        {res.ulipTaxFree
          ? "ULIP maturity tax-free only while the annual premium is ≤ ₹2.5 L."
          : "Premium above ₹2.5 L/yr: ULIP gains taxed as LTCG too."}
      </p>
    </div>
  );
}
