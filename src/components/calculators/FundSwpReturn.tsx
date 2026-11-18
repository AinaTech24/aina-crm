"use client";

/**
 * SWP Return (Fund Research) — a lumpsum in one real scheme with regular
 * withdrawals: amount withdrawn, units left, remaining value, XIRR, and each
 * withdrawal's units, FIFO capital gain or loss and days invested.
 * Math: swpReturn in src/lib/fund-research/swp.ts (NAV rules in nav.ts).
 */

import { useMemo, useState } from "react";
import { swpReturn } from "@/lib/fund-research/swp";
import type { Frequency } from "@/lib/fund-research/nav";
import { inr, NumberField, Stat, Table, Insight, Section } from "./ui";
import { YearTableWrap } from "./sip-suite-ui";
import {
  type PickedScheme, DateInput, DayField, FrequencyField, FundPicker, PickFirst, ResearchNote, ToolError,
  dateText, navText, pctText, todayIso, unitsText, useNavHistory, yearsBefore,
} from "./fund-research-ui";

const FREQS: Frequency[] = ["weekly", "fortnightly", "monthly", "quarterly"];

export function FundSwpReturn() {
  const today = todayIso();
  const [fund, setFund] = useState<PickedScheme | null>(null);
  const [amount, setAmount] = useState(1000000);
  const [investDate, setInvestDate] = useState(yearsBefore(today, 5));
  const [withdrawal, setWithdrawal] = useState(8000);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [swpDay, setSwpDay] = useState(10);
  const [swpStart, setSwpStart] = useState(yearsBefore(today, 4));
  const [swpEnd, setSwpEnd] = useState(today);
  const nav = useNavHistory(fund?.schemeCode);

  const res = useMemo(() => {
    if (nav.status !== "ready") return null;
    return swpReturn(nav.data.series, { amount, investDate, withdrawal, frequency, swpDay, swpStart, swpEnd, valueOn: today });
  }, [nav, amount, investDate, withdrawal, frequency, swpDay, swpStart, swpEnd, today]);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">SWP Return of a Scheme</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FundPicker label="Scheme" value={fund} onChange={setFund} state={nav} />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Lumpsum (₹)" value={amount} setValue={setAmount} step={50000} />
          <DateInput label="Invested on" value={investDate} onChange={setInvestDate} max={today} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Withdrawal (₹)" value={withdrawal} setValue={setWithdrawal} step={1000} />
        <FrequencyField value={frequency} onChange={setFrequency} options={FREQS} />
        {(frequency === "monthly" || frequency === "quarterly") && <DayField label="SWP day" value={swpDay} onChange={setSwpDay} />}
        <DateInput label="SWP start" value={swpStart} onChange={setSwpStart} max={today} />
        <DateInput label="SWP end" value={swpEnd} onChange={setSwpEnd} max={today} />
      </div>

      {!fund && <PickFirst />}
      {res && !res.ok && <ToolError message={res.error} />}
      {res && res.ok && nav.status === "ready" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Invested" value={inr(amount)} />
            <Stat label={`Withdrawn (${res.withdrawals})`} value={inr(res.totalWithdrawn)} />
            <Stat label={`Value left on ${dateText(res.valueDate)}`} value={inr(res.remainingValue)} tone="cyan" />
            <Stat label="XIRR" value={pctText(res.xirrPct)} tone="emerald" />
            <Stat label="Units bought" value={unitsText(res.initialUnits)} />
            <Stat label="Units left" value={unitsText(res.unitsLeft)} />
            <Stat label="Capital gain withdrawn" value={inr(res.totalCapitalGain)} />
            <Stat label="Profit" value={inr(res.profit)} tone={res.profit >= 0 ? "emerald" : "rose"} />
          </div>

          <Insight tone={res.exhausted ? "amber" : "cyan"}>
            {inr(amount)} in {nav.data.schemeName} paid out <strong>{inr(res.totalWithdrawn)}</strong> over {res.withdrawals}{" "}
            withdrawals
            {res.exhausted
              ? <> and ran out on {dateText(res.rows[res.rows.length - 1].date)} — the last withdrawal took what was left.</>
              : <> and still held <strong>{inr(res.remainingValue)}</strong> on {dateText(res.valueDate)}.</>}{" "}
            XIRR {pctText(res.xirrPct)}.
          </Insight>

          {res.rows.length > 0 && (
            <Section n={1} title="Withdrawals">
              <YearTableWrap>
                <Table
                  head={["NAV date", "NAV", "Withdrawal", "Units out", "Units left", "Cost (FIFO)", "Gain / loss", "Days invested", "Value left"]}
                  rows={res.rows.map((r) => [
                    dateText(r.date), navText(r.nav), inr(r.amount), unitsText(r.unitsRedeemed), unitsText(r.unitsLeft),
                    inr(r.cost), inr(r.capitalGain), `${r.daysInvested}`, inr(r.value),
                  ])}
                />
              </YearTableWrap>
            </Section>
          )}

          <ResearchNote
            ranges={[{ name: nav.data.schemeName, from: res.buyDate, to: res.valueDate }]}
            extra="Gain or loss is each withdrawal less the purchase cost of the units sold, oldest units first; tax is not worked out."
          />
        </>
      )}
    </div>
  );
}
