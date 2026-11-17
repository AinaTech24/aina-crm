"use client";

/**
 * Point-to-Point Comparison (Fund Research) — up to five real schemes over the
 * same period: growth of an amount, absolute return, CAGR, annualised mean and
 * standard deviation of NAV returns, and the Sharpe ratio at a risk-free rate
 * the user sets. No alpha or beta: they need a benchmark index series, which
 * the NAV data does not carry — said on the card.
 * Math: pointToPoint in src/lib/fund-research/compare.ts.
 */

import { useMemo, useState } from "react";
import { pointToPoint } from "@/lib/fund-research/compare";
import { inr, NumberField, Table, Section } from "./ui";
import {
  type FundSlot, DateInput, FundList, PickFirst, ResearchNote,
  dateText, newSlot, pctText, todayIso, useNavHistories, yearsBefore,
} from "./fund-research-ui";

export function FundPointToPoint() {
  const today = todayIso();
  const [funds, setFunds] = useState<FundSlot[]>(() => [newSlot()]);
  const [amount, setAmount] = useState(100000);
  const [start, setStart] = useState(yearsBefore(today, 3));
  const [end, setEnd] = useState(today);
  const [rf, setRf] = useState(6.5);
  const states = useNavHistories(funds.map((f) => f.pick?.schemeCode));

  const rows = useMemo(() => states.flatMap((st) =>
    st.status === "ready"
      ? [{ name: st.data.schemeName, res: pointToPoint(st.data.series, { amount, startDate: start, endDate: end, riskFreePct: rf }) }]
      : [],
  ), [states, amount, start, end, rf]);
  const done = rows.flatMap((r) => (r.res.ok ? [{ name: r.name, res: r.res }] : []));

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Point-to-Point Comparison</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <FundList funds={funds} setFunds={setFunds} states={states} />
        </div>
        <div className="space-y-3">
          <NumberField label="Amount (₹)" value={amount} setValue={setAmount} step={10000} />
          <DateInput label="From" value={start} onChange={setStart} max={today} />
          <DateInput label="To" value={end} onChange={setEnd} max={today} />
          <NumberField label="Risk-free rate (% a year)" value={rf} setValue={setRf} step={0.25} />
        </div>
      </div>

      {rows.length === 0 && <PickFirst message="Pick up to five schemes to compare over one period." />}
      {rows.length > 0 && (
        <Section n={1} title="Comparison">
          <Table
            head={["Scheme", "Period", "Growth value", "Absolute", "CAGR", "Mean", "Std deviation", "Sharpe"]}
            rows={rows.map((r) => r.res.ok
              ? [r.name, `${dateText(r.res.startDate)} – ${dateText(r.res.endDate)}`, inr(r.res.growthValue), pctText(r.res.absolutePct),
                r.res.cagrPct === null ? "Under 1 yr" : pctText(r.res.cagrPct), pctText(r.res.meanPct), pctText(r.res.stdDevPct),
                r.res.sharpe === null ? "—" : r.res.sharpe.toFixed(2)]
              : [r.name, r.res.error, "", "", "", "", "", ""])}
          />
        </Section>
      )}
      {done.length > 0 && (
        <ResearchNote
          ranges={done.map((d) => ({ name: d.name, from: d.res.startDate, to: d.res.endDate }))}
          extra="Mean and standard deviation are of the NAV-to-NAV returns in the period, annualised over 252 trading days; Sharpe is (mean − risk-free rate) ÷ standard deviation. Alpha and beta are not shown: they need a benchmark index history, which this data does not include."
        />
      )}
    </div>
  );
}
