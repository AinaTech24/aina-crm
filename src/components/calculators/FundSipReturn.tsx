"use client";

/**
 * SIP Return (Fund Research) — what a SIP in one real scheme would have made:
 * invested, units, value, profit, absolute return and XIRR, with every
 * instalment's NAV, units and running value.
 * Math: sipReturn in src/lib/fund-research/sip.ts (NAV rules in nav.ts).
 */

import { useMemo, useState } from "react";
import { sipReturn } from "@/lib/fund-research/sip";
import type { Frequency } from "@/lib/fund-research/nav";
import { inr, NumberField, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";
import { SUITE_COLORS, YearTableWrap } from "./sip-suite-ui";
import {
  type PickedScheme, DateInput, DayField, FrequencyField, FundPicker, PickFirst, ResearchNote, ToolError,
  dateText, navText, pctText, todayIso, unitsText, useNavHistory, yearsBefore,
} from "./fund-research-ui";

export function FundSipReturn() {
  const today = todayIso();
  const [fund, setFund] = useState<PickedScheme | null>(null);
  const [amount, setAmount] = useState(10000);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [sipDay, setSipDay] = useState(5);
  const [start, setStart] = useState(yearsBefore(today, 5));
  const [end, setEnd] = useState(today);
  const [stepUp, setStepUp] = useState(0);
  const nav = useNavHistory(fund?.schemeCode);

  const res = useMemo(() => {
    if (nav.status !== "ready") return null;
    return sipReturn(nav.data.series, { amount, frequency, sipDay, startDate: start, endDate: end, stepUpPct: stepUp });
  }, [nav, amount, frequency, sipDay, start, end, stepUp]);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">SIP Return of a Scheme</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FundPicker label="Scheme" value={fund} onChange={setFund} state={nav} />
        <NumberField label="Instalment (₹)" value={amount} setValue={setAmount} step={1000} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FrequencyField value={frequency} onChange={setFrequency} />
        {frequency !== "weekly" && <DayField label="SIP day" value={sipDay} onChange={setSipDay} />}
        <DateInput label="Start date" value={start} onChange={setStart} max={today} />
        <DateInput label="End date" value={end} onChange={setEnd} max={today} />
        <NumberField label="Yearly top-up (%)" value={stepUp} setValue={setStepUp} step={5} />
      </div>

      {!fund && <PickFirst />}
      {res && !res.ok && <ToolError message={res.error} />}
      {res && res.ok && nav.status === "ready" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Invested" value={inr(res.invested)} />
            <Stat label={`Value on ${dateText(res.valueDate)}`} value={inr(res.currentValue)} tone="cyan" />
            <Stat label="Profit" value={inr(res.profit)} tone={res.profit >= 0 ? "emerald" : "rose"} />
            <Stat label="XIRR" value={pctText(res.xirrPct)} tone="emerald" />
            <Stat label="Instalments" value={`${res.instalments}`} />
            <Stat label="Units held" value={unitsText(res.units)} />
            <Stat label={`NAV on ${dateText(res.valueDate)}`} value={navText(res.valueNav)} />
            <Stat label="Absolute return" value={pctText(res.absolutePct)} />
          </div>

          <Insight tone="cyan">
            {res.instalments} instalments totalling <strong>{inr(res.invested)}</strong> in {nav.data.schemeName} were
            worth <strong>{inr(res.currentValue)}</strong> on {dateText(res.valueDate)} — an XIRR of{" "}
            <strong>{pctText(res.xirrPct)}</strong>.
            {res.skippedBeforeLaunch > 0 && <> {res.skippedBeforeLaunch} instalment(s) dated before the scheme&apos;s launch are left out.</>}
          </Insight>

          <Section n={1} title="Invested vs value">
            <CalcChart
              data={res.rows.map((r) => ({ date: dateText(r.date), invested: r.cumulativeInvested, value: r.value }))}
              xKey="date"
              xUnit=""
              series={[
                { key: "invested", name: "Invested", color: SUITE_COLORS[1] },
                { key: "value", name: "Value", color: SUITE_COLORS[0] },
              ]}
            />
          </Section>

          <Section n={2} title="Cash flow">
            <YearTableWrap>
              <Table
                head={["NAV date", "NAV", "Amount", "Units", "Cumulative units", "Value"]}
                rows={res.rows.map((r) => [
                  dateText(r.date), navText(r.nav), inr(r.amount), unitsText(r.units), unitsText(r.cumulativeUnits), inr(r.value),
                ])}
              />
            </YearTableWrap>
          </Section>

          <ResearchNote ranges={[{ name: nav.data.schemeName, from: res.rows[0].date, to: res.valueDate }]} />
        </>
      )}
    </div>
  );
}
