"use client";

/**
 * Lumpsum Return (Fund Research) — one amount invested on the same date in up
 * to five real schemes: value, profit, CAGR and absolute return side by side.
 * Math: lumpsumReturn in src/lib/fund-research/lumpsum.ts (NAV rules in nav.ts).
 */

import { useMemo, useState } from "react";
import { lumpsumReturn } from "@/lib/fund-research/lumpsum";
import { inr, NumberField, Table, Insight, Section } from "./ui";
import {
  type FundSlot, DateInput, FundList, PickFirst, ResearchNote,
  dateText, navText, newSlot, pctText, todayIso, unitsText, useNavHistories, yearsBefore,
} from "./fund-research-ui";

export function FundLumpsumReturn() {
  const today = todayIso();
  const [funds, setFunds] = useState<FundSlot[]>(() => [newSlot()]);
  const [amount, setAmount] = useState(100000);
  const [start, setStart] = useState(yearsBefore(today, 5));
  const [end, setEnd] = useState(today);
  const states = useNavHistories(funds.map((f) => f.pick?.schemeCode));

  const rows = useMemo(() => states.map((st) =>
    st.status === "ready"
      ? { name: st.data.schemeName, amc: st.data.amc, res: lumpsumReturn(st.data.series, { amount, startDate: start, endDate: end }) }
      : null,
  ), [states, amount, start, end]);
  const ready = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  const done = ready.flatMap((r) => (r.res.ok ? [{ name: r.name, res: r.res }] : []));
  const best = done.length > 1 ? done.reduce((a, b) => (b.res.value > a.res.value ? b : a)) : null;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Lumpsum Return of Schemes</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <FundList funds={funds} setFunds={setFunds} states={states} />
        </div>
        <div className="space-y-3">
          <NumberField label="Amount (₹)" value={amount} setValue={setAmount} step={10000} />
          <DateInput label="Invested on" value={start} onChange={setStart} max={today} />
          <DateInput label="Value as on" value={end} onChange={setEnd} max={today} />
        </div>
      </div>

      {ready.length === 0 && <PickFirst message="Pick up to five schemes to compare a lumpsum." />}
      {ready.length > 0 && (
        <Section n={1} title="Returns">
          <Table
            head={["Scheme", "Bought on", "NAV", "Units", "Valued on", "Value", "Profit", "CAGR", "Absolute"]}
            rows={ready.map((r) => r.res.ok
              ? [r.name, dateText(r.res.buyDate), navText(r.res.buyNav), unitsText(r.res.units), dateText(r.res.valueDate),
                inr(r.res.value), inr(r.res.profit), r.res.cagrPct === null ? "Under 1 yr" : pctText(r.res.cagrPct), pctText(r.res.absolutePct)]
              : [r.name, r.res.error, "", "", "", "", "", "", ""])}
          />
        </Section>
      )}
      {best && (
        <Insight tone="cyan">
          {inr(amount)} grew most in <strong>{best.name}</strong>: <strong>{inr(best.res.value)}</strong> by{" "}
          {dateText(best.res.valueDate)}.
        </Insight>
      )}
      {done.length > 0 && (
        <ResearchNote ranges={done.map((d) => ({ name: d.name, from: d.res.buyDate, to: d.res.valueDate }))} />
      )}
    </div>
  );
}
