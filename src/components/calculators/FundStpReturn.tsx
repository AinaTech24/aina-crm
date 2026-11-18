"use client";

/**
 * STP Return (Fund Research) — a lumpsum in one real scheme moved into another
 * by STP: units left and gathered, amount moved, each leg's value at the STP
 * end and today, profit and returns, and the total. Two cards share it:
 *   FundStpReturn          — a fixed amount each time;
 *   FundStpProfitTransfer  — only the value above the initial investment.
 * Math: stpReturn in src/lib/fund-research/stp.ts (NAV rules in nav.ts).
 */

import { useMemo, useState } from "react";
import { stpReturn, type StpLeg, type StpMode } from "@/lib/fund-research/stp";
import type { Frequency } from "@/lib/fund-research/nav";
import { inr, NumberField, Stat, Table, Insight, Section } from "./ui";
import { YearTableWrap } from "./sip-suite-ui";
import {
  type PickedScheme, DateInput, DayField, FrequencyField, FundPicker, PickFirst, ResearchNote, ToolError,
  dateText, navText, pctText, todayIso, unitsText, useNavHistories, yearsBefore,
} from "./fund-research-ui";

const FREQS: Frequency[] = ["weekly", "fortnightly", "monthly", "quarterly"];

function legRows(leg: StpLeg, unitsLabel: string): (string | number)[][] {
  return [
    [unitsLabel, unitsText(leg.units)],
    [`Value on ${dateText(leg.valueAtEndDate)} (STP end)`, inr(leg.valueAtEnd)],
    [`Value on ${dateText(leg.currentValueDate)}`, inr(leg.currentValue)],
    ["Profit", inr(leg.profit)],
    ["Absolute return", pctText(leg.absolutePct)],
    ["XIRR", pctText(leg.xirrPct)],
  ];
}

function StpTool({ mode, title }: { mode: StpMode; title: string }) {
  const today = todayIso();
  const [fromFund, setFromFund] = useState<PickedScheme | null>(null);
  const [toFund, setToFund] = useState<PickedScheme | null>(null);
  const [initial, setInitial] = useState(mode === "fixed" ? 500000 : 1000000);
  const [investDate, setInvestDate] = useState(yearsBefore(today, 5));
  const [stpAmount, setStpAmount] = useState(20000);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [stpDay, setStpDay] = useState(10);
  const [stpStart, setStpStart] = useState(yearsBefore(today, 5));
  const [stpEnd, setStpEnd] = useState(yearsBefore(today, mode === "fixed" ? 3 : 0));
  const [from, to] = useNavHistories([fromFund?.schemeCode, toFund?.schemeCode]);

  const res = useMemo(() => {
    if (from.status !== "ready" || to.status !== "ready") return null;
    return stpReturn(from.data.series, to.data.series, {
      initialAmount: initial, investDate, mode, stpAmount, frequency, stpDay, stpStart, stpEnd, valueOn: today,
    });
  }, [from, to, initial, investDate, mode, stpAmount, frequency, stpDay, stpStart, stpEnd, today]);

  const fromName = from.status === "ready" ? from.data.schemeName : "Transfer-from scheme";
  const toName = to.status === "ready" ? to.data.schemeName : "Transfer-to scheme";

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">{title}</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FundPicker label="Transfer from" value={fromFund} onChange={setFromFund} state={from} />
        <FundPicker label="Transfer to" value={toFund} onChange={setToFund} state={to} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Initial investment (₹)" value={initial} setValue={setInitial} step={50000} />
        <DateInput label="Invested on" value={investDate} onChange={setInvestDate} max={today} />
        {mode === "fixed" && <NumberField label="STP amount (₹)" value={stpAmount} setValue={setStpAmount} step={1000} />}
        <FrequencyField value={frequency} onChange={setFrequency} options={FREQS} />
        {(frequency === "monthly" || frequency === "quarterly") && <DayField label="STP day" value={stpDay} onChange={setStpDay} />}
        <DateInput label="STP start" value={stpStart} onChange={setStpStart} max={today} />
        <DateInput label="STP end" value={stpEnd} onChange={setStpEnd} max={today} />
      </div>

      {(!fromFund || !toFund) && <PickFirst message="Pick the scheme to transfer from and the one to transfer to." />}
      {res && !res.ok && <ToolError message={res.error} />}
      {res && res.ok && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Invested" value={inr(res.total.invested)} />
            <Stat label="Moved by STP" value={inr(res.transferred)} />
            <Stat label={`Total value on ${dateText(res.from.currentValueDate)}`} value={inr(res.total.currentValue)} tone="cyan" />
            <Stat label="Total XIRR" value={pctText(res.total.xirrPct)} tone="emerald" />
          </div>

          <Insight tone="cyan">
            {res.transfers} transfer{res.transfers === 1 ? "" : "s"} moved <strong>{inr(res.transferred)}</strong> from {fromName} to{" "}
            {toName}. The {inr(res.total.invested)} invested is now worth <strong>{inr(res.total.currentValue)}</strong>, a profit
            of <strong>{inr(res.total.profit)}</strong> ({pctText(res.total.absolutePct)}).
            {res.exhausted && <> The transfer-from scheme ran out before the STP end; the last transfer took what was left.</>}
            {mode === "appreciation" && res.periodsWithoutTransfer > 0 && (
              <> {res.periodsWithoutTransfer} period(s) had no gain above the initial investment, so nothing moved.</>
            )}
          </Insight>

          <Section n={1} title="Each leg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-1">From: {fromName}</p>
                <Table
                  head={["", "Amount"]}
                  rows={[["Initial investment", inr(res.total.invested)], ["Moved out", inr(res.transferred)], ...legRows(res.from, "Units remaining")]}
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-1">To: {toName}</p>
                <Table
                  head={["", "Amount"]}
                  rows={[["Transfers", `${res.transfers}`], ["Moved in", inr(res.transferred)], ...legRows(res.to, "Units accumulated")]}
                />
              </div>
            </div>
          </Section>

          {res.rows.length > 0 && (
            <Section n={2} title="Transfers">
              <YearTableWrap>
                <Table
                  head={["Date", "From NAV", "Units out", "Amount", "From units left", "To NAV", "Units in", "To units", "To value"]}
                  rows={res.rows.map((r) => [
                    dateText(r.date), navText(r.fromNav), unitsText(r.unitsOut), inr(r.amount), unitsText(r.fromUnitsLeft),
                    navText(r.toNav), unitsText(r.unitsIn), unitsText(r.toUnits), inr(r.toValue),
                  ])}
                />
              </YearTableWrap>
            </Section>
          )}

          <ResearchNote
            ranges={[
              { name: fromName, from: res.buyDate, to: res.from.currentValueDate },
              ...(res.rows.length ? [{ name: toName, from: res.rows[0].toDate, to: res.to.currentValueDate }] : []),
            ]}
            extra={mode === "appreciation" ? "Each period moves only the value above the initial investment on that date." : undefined}
          />
        </>
      )}
    </div>
  );
}

export function FundStpReturn() {
  return <StpTool mode="fixed" title="STP Return of Two Schemes" />;
}

export function FundStpProfitTransfer() {
  return <StpTool mode="appreciation" title="STP Return — Profit Transfer" />;
}
