"use client";

/**
 * Monthly SWP from a Lumpsum — the monthly withdrawal a one-time investment
 * supports for a chosen period, rising with inflation if asked, while leaving a
 * chosen balance at the end; up to two return scenarios and an optional
 * capital-gains-tax projection. The exact inverse of "Lumpsum needed for a
 * monthly SWP".
 * Math: src/lib/calculators/swp-target.ts (verified to the rupee — ₹1 cr · 25y ·
 * 9% · 5% inflation · leave ₹1 cr → first-year average SWP ₹46,646).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { swpFromLumpsum, type SwpTax } from "@/lib/calculators/swp-target";
import { inr, fmtPct, NumberField, Field, Toggle, Section, Stat, Insight } from "./ui";
import { CalcChart } from "./CalcChart";
import { DEFAULT_TAX, TaxInputs, SwpYearTable, SwpTaxTable, optionalAge } from "./swp-target-parts";

export function SwpFromLumpsumCalculator() {
  const [clientName, setClientName] = useState("");
  const [currentAge, setCurrentAge] = useState(60);
  const [lumpsum, setLumpsum] = useState(10000000);
  const [defer, setDefer] = useState(false);
  const [deferYears, setDeferYears] = useState(5);
  const [swpYears, setSwpYears] = useState(25);
  const [rate1, setRate1] = useState(9);
  const [useRate2, setUseRate2] = useState(false);
  const [rate2, setRate2] = useState(10);
  const [endBalance, setEndBalance] = useState(10000000);
  const [useInflation, setUseInflation] = useState(true);
  const [inflationPct, setInflationPct] = useState(5);
  const [useTax, setUseTax] = useState(true);
  const [tax, setTax] = useState<SwpTax>(DEFAULT_TAX);

  const age = optionalAge(currentAge);
  const label = age != null ? "age" : "year";

  const scenarios = useMemo(() => {
    const run = (ratePct: number) =>
      swpFromLumpsum({
        lumpsum, deferYears: defer ? deferYears : 0, swpYears, ratePct,
        inflationPct: useInflation ? inflationPct : 0, endBalance, currentAge: age,
        tax: useTax ? tax : null,
      });
    return useRate2 ? [run(rate1), run(rate2)] : [run(rate1)];
  }, [lumpsum, defer, deferYears, swpYears, rate1, useRate2, rate2, useInflation, inflationPct, endBalance, age, useTax, tax]);

  const s1 = scenarios[0];
  const infeasible = scenarios.filter((s) => !s.feasible);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Monthly SWP from a Lumpsum</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Client name (optional)">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <NumberField label="Current age (optional)" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Initial investment (₹)" value={lumpsum} setValue={setLumpsum} step={100000} />
        <NumberField label="SWP period (yrs)" value={swpYears} setValue={setSwpYears} step={1} />
        <NumberField label="Balance required at the end (₹)" value={endBalance} setValue={setEndBalance} step={100000} />
        <NumberField label="Scenario 1 return (%)" value={rate1} setValue={setRate1} step={0.5} />
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Toggle checked={useRate2} onChange={setUseRate2} label="Compare scenario 2" />
          {useRate2 && <NumberField label="Scenario 2 return (%)" value={rate2} setValue={setRate2} step={0.5} />}
        </div>
        <div className="space-y-2">
          <Toggle checked={defer} onChange={setDefer} label="Defer the first withdrawal" />
          {defer && <NumberField label="Deferment (yrs)" value={deferYears} setValue={setDeferYears} step={1} />}
        </div>
        <div className="space-y-2">
          <Toggle checked={useInflation} onChange={setUseInflation} label="Raise the SWP with inflation" />
          {useInflation && <NumberField label="Expected inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />}
        </div>
      </div>

      <TaxInputs enabled={useTax} setEnabled={setUseTax} tax={tax} setTax={setTax} />

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-primary">{clientName}</span> · {inr(lumpsum)} over {swpYears} years
        </div>
      )}

      <div className={`grid gap-3 ${scenarios.length > 1 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}>
        {scenarios.map((s, i) => (
          <Stat
            key={`avg-${i}`}
            label={`${useInflation ? "First-year average SWP" : "Monthly SWP"} @ ${fmtPct(s.ratePct)}`}
            value={inr(s.firstYearAvgSwp)}
            tone={i === 0 ? "cyan" : "emerald"}
          />
        ))}
        {scenarios.map((s, i) => (
          <Stat key={`tot-${i}`} label={`Total withdrawal @ ${fmtPct(s.ratePct)}`} value={inr(s.totalWithdrawal)} />
        ))}
        {scenarios.length === 1 && useInflation && (
          <Stat label="First → last monthly SWP" value={`${inr(s1.firstMonthSwp)} → ${inr(s1.lastMonthSwp)}`} />
        )}
      </div>

      {infeasible.length > 0 ? (
        <Insight tone="rose">
          The balance asked for is more than {inr(lumpsum)} grows to with no withdrawals at{" "}
          {infeasible.map((s) => fmtPct(s.ratePct)).join(" / ")} (at most {inr(infeasible[0].maxEndBalance)}), so the SWP
          works out negative. Lower the balance required or assume a higher return.
        </Insight>
      ) : (
        <Insight tone="cyan">
          {inr(lumpsum)} at {fmtPct(s1.ratePct)} pays <strong>{inr(s1.firstMonthSwp)}</strong> in the first month
          {useInflation ? `, rising every month with ${fmtPct(inflationPct)} inflation to ${inr(s1.lastMonthSwp)} in the last,` : ""}{" "}
          for {swpYears} years and still leaves {inr(endBalance)}.
          {useTax && <> Tax over the period comes to about <strong>{inr(s1.totalTax)}</strong>.</>}
        </Insight>
      )}

      <Section n={1} title="Monthly withdrawal and investment value">
        <CalcChart
          data={s1.rows.map((r, i) => {
            const point: Record<string, number> = { x: r.age ?? r.year, s1: r.yearEndBalance };
            if (scenarios[1]) point.s2 = scenarios[1].rows[i]?.yearEndBalance ?? 0;
            return point;
          })}
          xKey="x"
          xUnit={label === "age" ? "Age" : "Year"}
          series={[
            { key: "s1", name: `Value @ ${fmtPct(rate1)}`, color: "#0ea5e9" },
            ...(scenarios[1] ? [{ key: "s2", name: `Value @ ${fmtPct(rate2)}`, color: "#10b981" }] : []),
          ]}
        />
        <SwpYearTable scenarios={scenarios.map((s) => ({ ratePct: s.ratePct, rows: s.rows }))} firstLabel={label} />
      </Section>

      {useTax &&
        scenarios.map((s, i) => (
          <Section key={i} n={2 + i} title={`Annual tax and post-tax withdrawal @ ${fmtPct(s.ratePct)}`}>
            <SwpTaxTable rows={s.rows} firstLabel={label} />
          </Section>
        ))}

      <p className="text-2xs text-muted-foreground">
        Withdrawals are taken on the last day of each month, starting with month 1 of the SWP · effective monthly rate ·
        the table shows each year&apos;s average monthly withdrawal. Illustration only; returns are not guaranteed.
      </p>
    </div>
  );
}
