"use client";

/**
 * Period returns (Fund Research), two cards:
 *   FundCalendarReturns — calendar-year returns of up to five real schemes,
 *     years side by side;
 *   FundMonthlyReturns  — one scheme's month-by-month (or quarter-by-quarter)
 *     returns, a row per year with the year's return beside it.
 * Partial periods (launch year, the year to date) are marked, never hidden.
 * Math: periodReturns / returnGrid in src/lib/fund-research/periodic.ts.
 */

import { useMemo, useState } from "react";
import { type PeriodReturn, periodReturns, returnGrid } from "@/lib/fund-research/periodic";
import { Segmented, Table, Section } from "./ui";
import { YearTableWrap } from "./sip-suite-ui";
import {
  type FundSlot, type PickedScheme, FundList, FundPicker, PickFirst, ResearchNote,
  newSlot, pctText, useNavHistories, useNavHistory,
} from "./fund-research-ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

/** "12.34%", with a marker for a partial period. */
function cell(r: PeriodReturn | null | undefined): string {
  if (!r) return "—";
  return `${pctText(r.returnPct)}${r.partial === "since_launch" ? " ¹" : r.partial === "to_date" ? " ²" : ""}`;
}

const PARTIAL_NOTE = "¹ since the scheme's launch in that period. ² to the latest NAV — the period has not ended.";

export function FundCalendarReturns() {
  const [funds, setFunds] = useState<FundSlot[]>(() => [newSlot()]);
  const [show, setShow] = useState<"10" | "all">("10");
  const states = useNavHistories(funds.map((f) => f.pick?.schemeCode));

  const data = useMemo(() => states.flatMap((st) =>
    st.status === "ready" ? [{ name: st.data.schemeName, years: periodReturns(st.data.series, "year") }] : [],
  ), [states]);
  const allYears = [...new Set(data.flatMap((d) => d.years.map((y) => y.year)))].sort((a, b) => b - a);
  const years = show === "10" ? allYears.slice(0, 10) : allYears;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Calendar-Year Returns</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2">
          <FundList funds={funds} setFunds={setFunds} states={states} />
        </div>
        <Segmented
          label="Years"
          value={show}
          onChange={setShow}
          options={[{ value: "10", label: "Last 10" }, { value: "all", label: "Since launch" }]}
        />
      </div>

      {data.length === 0 && <PickFirst message="Pick up to five schemes to see their year-by-year returns." />}
      {data.length > 0 && years.length > 0 && (
        <>
          <Section n={1} title="Return in each calendar year">
            <Table
              head={["Scheme", ...years.map(String)]}
              rows={data.map((d) => [d.name, ...years.map((y) => cell(d.years.find((r) => r.year === y)))])}
            />
          </Section>
          <ResearchNote
            ranges={data.flatMap((d) => d.years.length ? [{ name: d.name, from: d.years[0].fromDate, to: d.years[d.years.length - 1].toDate }] : [])}
            extra={`A year's return runs from the last NAV of the year before to the last NAV of the year. ${PARTIAL_NOTE}`}
          />
        </>
      )}
    </div>
  );
}

export function FundMonthlyReturns() {
  const [fund, setFund] = useState<PickedScheme | null>(null);
  const [kind, setKind] = useState<"month" | "quarter">("month");
  const nav = useNavHistory(fund?.schemeCode);

  const grid = useMemo(() => (nav.status === "ready" ? returnGrid(nav.data.series, kind) : null), [nav, kind]);
  const heads = kind === "month" ? MONTHS : QUARTERS;
  const first = grid?.rows[grid.rows.length - 1]?.cells.find((c) => c !== null);
  const last = grid?.rows[0] ? [...grid.rows[0].cells].reverse().find((c) => c !== null) : null;

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Monthly &amp; Quarterly Returns</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <FundPicker label="Scheme" value={fund} onChange={setFund} state={nav} />
        </div>
        <Segmented
          label="Period"
          value={kind}
          onChange={setKind}
          options={[{ value: "month", label: "Monthly" }, { value: "quarter", label: "Quarterly" }]}
        />
      </div>

      {!fund && <PickFirst />}
      {grid && nav.status === "ready" && grid.rows.length > 0 && (
        <>
          <Section n={1} title={kind === "month" ? "Return in each month" : "Return in each quarter"}>
            <YearTableWrap>
              <Table
                head={["Year", ...heads, "Year"]}
                rows={grid.rows.map((r) => [String(r.year), ...r.cells.map(cell), cell(r.yearReturn)])}
              />
            </YearTableWrap>
          </Section>
          {first && last && (
            <ResearchNote
              ranges={[{ name: nav.data.schemeName, from: first.fromDate, to: last.toDate }]}
              extra={`Each return runs from the last NAV of the previous ${kind} to the last NAV of the ${kind}; a ${kind} with no NAV of its own shows —. ${PARTIAL_NOTE}`}
            />
          )}
        </>
      )}
    </div>
  );
}
