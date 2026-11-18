"use client";

/**
 * Rolling Returns (Fund Research) — for up to five real schemes, every daily
 * N-year window from a start date: average, median, best, worst, how often
 * negative, and how the windows spread across return bands.
 * Math: rollingReturns in src/lib/fund-research/rolling.ts (NAV rules in nav.ts).
 */

import { useMemo, useState } from "react";
import { ROLLING_BANDS, ROLLING_WINDOWS, rollingReturns } from "@/lib/fund-research/rolling";
import { Field, Table, Section } from "./ui";
import {
  type FundSlot, DateInput, FundList, PickFirst, ResearchNote,
  dateText, newSlot, pctText, todayIso, useNavHistories, yearsBefore,
} from "./fund-research-ui";

export function FundRollingReturns() {
  const today = todayIso();
  const [funds, setFunds] = useState<FundSlot[]>(() => [newSlot()]);
  const [start, setStart] = useState(yearsBefore(today, 10));
  const [years, setYears] = useState<number>(3);
  const states = useNavHistories(funds.map((f) => f.pick?.schemeCode));

  const rows = useMemo(() => states.flatMap((st) =>
    st.status === "ready" ? [{ name: st.data.schemeName, res: rollingReturns(st.data.series, { startDate: start, years }) }] : [],
  ), [states, start, years]);
  const done = rows.flatMap((r) => (r.res.ok ? [{ name: r.name, res: r.res }] : []));

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Rolling Returns</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <FundList funds={funds} setFunds={setFunds} states={states} />
        </div>
        <div className="space-y-3">
          <DateInput label="Windows starting from" value={start} onChange={setStart} max={today} />
          <Field label="Rolling period">
            <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="input-base text-sm w-full">
              {ROLLING_WINDOWS.map((y) => (
                <option key={y} value={y}>{y} year{y === 1 ? "" : "s"}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {rows.length === 0 && <PickFirst message="Pick up to five schemes to see their rolling returns." />}
      {rows.length > 0 && (
        <>
          <Section n={1} title={`${years}-year rolling return statistics (% a year)`}>
            <Table
              head={["Scheme", "Windows", "Average", "Median", "Best", "Worst", "Negative"]}
              rows={rows.map((r) => r.res.ok
                ? [r.name, r.res.count.toLocaleString("en-IN"), pctText(r.res.averagePct), pctText(r.res.medianPct),
                  `${pctText(r.res.max.returnPct)} (from ${dateText(r.res.max.start)})`,
                  `${pctText(r.res.min.returnPct)} (from ${dateText(r.res.min.start)})`, pctText(r.res.negativePct, 1)]
                : [r.name, r.res.error, "", "", "", "", ""])}
            />
          </Section>
          {done.length > 0 && (
            <Section n={2} title="How often each return band occurred (% of windows)">
              <Table
                head={["Scheme", ...ROLLING_BANDS.map((b) => b.label)]}
                rows={done.map((d) => [d.name, ...d.res.bands.map((b) => pctText(b.pct, 1))])}
              />
            </Section>
          )}
          {done.length > 0 && (
            <ResearchNote
              ranges={done.map((d) => ({ name: d.name, from: d.res.windows[0].start, to: d.res.windows[d.res.windows.length - 1].end }))}
              extra={`A window starts on every NAV date and ends ${years} calendar year${years === 1 ? "" : "s"} later; its return is annualised.`}
            />
          )}
        </>
      )}
    </div>
  );
}
