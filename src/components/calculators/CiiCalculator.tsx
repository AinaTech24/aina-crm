"use client";

/**
 * Cost Inflation Index — the notified CII for every financial year from
 * 2001-02, and a cost converted from one year to its indexed value in another.
 * Math: src/lib/calculators/cii.ts over the CII table in capital-gains.ts.
 */

import { useMemo, useState } from "react";
import { ciiTable, fyLabel, indexCost, latestCiiYear } from "@/lib/calculators/cii";
import { inr, NumberField, Stat, Table, Insight, Section, Field } from "./ui";
import { ClientField, PreparedFor, YearTableWrap } from "./sip-suite-ui";

export function CiiCalculator() {
  const rows = useMemo(() => ciiTable(), []);
  const latest = latestCiiYear();
  const [clientName, setClientName] = useState("");
  const [cost, setCost] = useState(1000000);
  const [fromFy, setFromFy] = useState(2010);
  const [toFy, setToFy] = useState(latest);

  const res = useMemo(() => indexCost(cost, fromFy, toFy), [cost, fromFy, toFy]);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Cost Inflation Index</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Cost (₹)" value={cost} setValue={setCost} step={10000} />
        <Field label="Bought / improved in FY">
          <select value={fromFy} onChange={(e) => setFromFy(Number(e.target.value))} className="input-base text-sm w-full">
            {rows.map((r) => <option key={r.fyStart} value={r.fyStart}>{r.label} (CII {r.cii})</option>)}
          </select>
        </Field>
        <Field label="Index it to FY">
          <select value={toFy} onChange={(e) => setToFy(Number(e.target.value))} className="input-base text-sm w-full">
            {rows.map((r) => <option key={r.fyStart} value={r.fyStart}>{r.label} (CII {r.cii})</option>)}
          </select>
        </Field>
      </div>

      <PreparedFor name={clientName}>{inr(cost)} from FY {fyLabel(fromFy)} to FY {fyLabel(toFy)}</PreparedFor>

      {res.error ? (
        <Insight tone="amber">{res.error}</Insight>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Original cost" value={inr(cost)} />
            <Stat label={`CII ${fyLabel(res.fromFy)} → ${fyLabel(res.toFy)}`} value={`${res.ciiFrom} → ${res.ciiTo}`} />
            <Stat label="Indexation factor" value={`${res.factor.toFixed(4)}×`} />
            <Stat label="Indexed cost" value={inr(res.indexedCost)} tone="cyan" />
          </div>
          <Insight tone="cyan">
            {inr(cost)} spent in FY {fyLabel(res.fromFy)} is worth <strong>{inr(res.indexedCost)}</strong> in FY{" "}
            {fyLabel(res.toFy)} terms ({inr(cost)} × {res.ciiTo} ÷ {res.ciiFrom}) — {inr(res.inflationUplift)} more cost to
            set against the sale price where indexation is allowed.
          </Insight>
        </>
      )}

      <Section n={1} title="Cost Inflation Index, FY 2001-02 onwards">
        <YearTableWrap>
          <Table
            head={["Financial year", "CII", "Change on the year"]}
            rows={rows.map((r, i) => [
              r.label,
              `${r.cii}`,
              i === 0 ? "Base year" : `${(((r.cii - rows[i - 1].cii) / rows[i - 1].cii) * 100).toFixed(1)}%`,
            ])}
          />
        </YearTableWrap>
        <p className="text-xs text-muted-foreground">
          Notified by CBDT under Section 48 of the Income-tax Act; base FY 2001-02 = 100. An asset bought before
          1 April 2001 takes its cost or fair market value as on that date, indexed from 2001-02. Since 23 July 2024
          indexation applies only to land and buildings bought before that date by resident individuals and HUFs.
          Latest year in this table: FY {fyLabel(latest)}.
        </p>
      </Section>
    </div>
  );
}
