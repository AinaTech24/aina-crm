"use client";

/**
 * Portfolio Projection — where a client's existing portfolio, a lumpsum added
 * every year and a running SIP could take them, and how much more raising the
 * lumpsum and the SIP would create (current vs incremental).
 * Math: src/lib/calculators/portfolio-projection.ts (verified to the reference
 * case → ₹6,32,51,914 current vs ₹9,95,74,779 incremental over 20 yrs @ 12%).
 */

import { useMemo, useState } from "react";
import { portfolioProjection, type PortfolioProjectionMode } from "@/lib/calculators/portfolio-projection";
import { inr, fmtPct, NumberField, Segmented, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

export function PortfolioProjectionReport() {
  const [mode, setMode] = useState<PortfolioProjectionMode>("incremental");
  const [portfolioValue, setPortfolioValue] = useState(2500000);
  const [annualLumpsum, setAnnualLumpsum] = useState(200000);
  const [annualLumpsumIncrease, setAnnualLumpsumIncrease] = useState(50000);
  const [monthlySip, setMonthlySip] = useState(25000);
  const [sipIncrease, setSipIncrease] = useState(5000);
  const [ratePct, setRatePct] = useState(12);
  const [years, setYears] = useState(20);

  const result = useMemo(
    () => portfolioProjection({ portfolioValue, annualLumpsum, annualLumpsumIncrease, monthlySip, sipIncrease, ratePct, years, mode }),
    [portfolioValue, annualLumpsum, annualLumpsumIncrease, monthlySip, sipIncrease, ratePct, years, mode]
  );

  const cur = result.current;
  const inc = result.incremental;
  const both = inc != null;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Portfolio Projection</h2>
      </div>

      <Segmented
        label="Show"
        value={mode}
        onChange={setMode}
        options={[
          { value: "current", label: "Current investments" },
          { value: "incremental", label: "Current + increased investments" },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Current portfolio value (₹)" value={portfolioValue} setValue={setPortfolioValue} step={100000} />
        <NumberField label="Lumpsum added every year (₹)" value={annualLumpsum} setValue={setAnnualLumpsum} step={25000} />
        {both && (
          <NumberField label="Raise the yearly lumpsum by (₹)" value={annualLumpsumIncrease} setValue={setAnnualLumpsumIncrease} step={10000} />
        )}
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        {both && <NumberField label="Raise the SIP each year by (₹)" value={sipIncrease} setValue={setSipIncrease} step={1000} />}
        <NumberField label="Expected return (% p.a.)" value={ratePct} setValue={setRatePct} step={0.5} />
        <NumberField label="Period (yrs)" value={years} setValue={setYears} step={1} />
      </div>
      {both && (
        <p className="text-2xs text-muted-foreground -mt-2">
          In the increased plan the yearly lumpsum is {inr(annualLumpsum + annualLumpsumIncrease)} every year, and the SIP goes
          up by {inr(sipIncrease)} every year starting this year ({inr(monthlySip + sipIncrease)}, then{" "}
          {inr(monthlySip + 2 * sipIncrease)}, …).
        </p>
      )}


      <div className={`grid gap-3 grid-cols-2 ${both ? "md:grid-cols-4" : "md:grid-cols-2"}`}>
        <Stat label="Invested — current plan" value={inr(cur.totalInvested)} />
        <Stat label={`Value in ${years} yrs — current plan`} value={inr(cur.components.total)} tone="cyan" />
        {inc && (
          <>
            <Stat label="Invested — increased plan" value={inr(inc.totalInvested)} />
            <Stat label={`Value in ${years} yrs — increased plan`} value={inr(inc.components.total)} tone="emerald" />
          </>
        )}
      </div>

      {inc && result.extraValue > 0 && (
        <Insight>
          Putting in <strong>{inr(result.extraInvested)}</strong> more over {years} years could add{" "}
          <strong>{inr(result.extraValue)}</strong> to the portfolio at {fmtPct(ratePct)} a year.
        </Insight>
      )}

      <Section n={1} title="Expected portfolio value">
        <Table
          head={["Component", "Current plan", ...(inc ? ["Increased plan"] : [])]}
          rows={[
            ["Today's portfolio", inr(cur.components.portfolio), ...(inc ? [inr(inc.components.portfolio)] : [])],
            ["Yearly lumpsums", inr(cur.components.annualLumpsum), ...(inc ? [inr(inc.components.annualLumpsum)] : [])],
            ["SIP", inr(cur.components.sip), ...(inc ? [inr(inc.components.sip)] : [])],
            ["Total", inr(cur.components.total), ...(inc ? [inr(inc.components.total)] : [])],
          ]}
          highlightLastRow
          highlightCol={inc ? 2 : undefined}
        />
      </Section>

      {cur.rows.length > 0 && (
        <Section n={2} title="Year by year — investment and expected value">
          <CalcChart
            data={cur.rows.map((r, i) => ({
              year: r.year,
              current: r.fundValue,
              ...(inc ? { increased: inc.rows[i].fundValue } : {}),
            }))}
            xKey="year"
            series={[
              ...(inc ? [{ key: "increased", name: "Increased plan", color: "#10b981" }] : []),
              { key: "current", name: "Current plan", color: "#0ea5e9" },
            ]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={[
                "Year",
                "Invested (current)", "Cumulative (current)", "Value (current)",
                ...(inc ? ["Invested (increased)", "Cumulative (increased)", "Value (increased)"] : []),
              ]}
              rows={cur.rows.map((r, i) => [
                `${r.year}`,
                inr(r.annualInvestment), inr(r.cumulativeInvestment), inr(r.fundValue),
                ...(inc ? [inr(inc.rows[i].annualInvestment), inr(inc.rows[i].cumulativeInvestment), inr(inc.rows[i].fundValue)] : []),
              ])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. Year 1&apos;s investment includes today&apos;s portfolio. The yearly lumpsum is added at the start
        of each year; the SIP at the start of each month, at the effective monthly equivalent of the yearly return. Returns are
        neither indicative nor guaranteed. Not investment advice.
      </p>
    </div>
  );
}
