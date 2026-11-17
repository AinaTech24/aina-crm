"use client";

/**
 * Pieces shared by the target-SWP calculators (lumpsum needed for an SWP, SWP
 * from a lumpsum, SIP needed for an SWP): the optional-inputs block for tax,
 * the year-wise withdrawal table with one column pair per scenario, and the
 * annual tax table. Presentation only — the math is lib/calculators/swp-target.
 */

import type { SwpTax, SwpYearRow } from "@/lib/calculators/swp-target";
import { inr, fmtPct, NumberField, Table, Toggle } from "./ui";

export const DEFAULT_TAX: SwpTax = { stPct: 20, stUptoYears: 1, ltPct: 12.5, ltFromYear: 2, indexationPct: 0 };

/** Optional age: 0 or blank means "not given". */
export function optionalAge(age: number): number | null {
  return age > 0 ? age : null;
}

export function TaxInputs({
  enabled, setEnabled, tax, setTax,
}: { enabled: boolean; setEnabled: (v: boolean) => void; tax: SwpTax; setTax: (t: SwpTax) => void }) {
  return (
    <div className="rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent space-y-3">
      <Toggle checked={enabled} onChange={setEnabled} label="Include capital-gains tax" />
      {enabled && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <NumberField label="Short-term tax (%)" value={tax.stPct} setValue={(v) => setTax({ ...tax, stPct: v })} step={0.5} />
            <NumberField label="Short term up to (yrs)" value={tax.stUptoYears} setValue={(v) => setTax({ ...tax, stUptoYears: v })} step={1} />
            <NumberField label="Long-term tax (%)" value={tax.ltPct} setValue={(v) => setTax({ ...tax, ltPct: v })} step={0.5} />
            <NumberField label="Long term from year" value={tax.ltFromYear} setValue={(v) => setTax({ ...tax, ltFromYear: v })} step={1} />
            <NumberField label="Indexation inflation (%)" value={tax.indexationPct} setValue={(v) => setTax({ ...tax, indexationPct: v })} step={0.5} />
          </div>
          <p className="text-2xs text-muted-foreground">
            Gains are worked out first-in-first-out from the investment date. No exemption, cess or surcharge is applied.
            Indexation raises the cost of long-term units only; leave it at 0 for equity-style taxation.
          </p>
        </>
      )}
    </div>
  );
}

export type ScenarioRows = { ratePct: number; rows: SwpYearRow[] };

/** Year-wise table: average monthly SWP and year-end balance, one column pair per scenario. */
export function SwpYearTable({ scenarios, firstLabel }: { scenarios: ScenarioRows[]; firstLabel: "age" | "year" }) {
  const base = scenarios[0];
  if (!base || base.rows.length === 0) return null;
  const head = [firstLabel === "age" ? "Age" : "Year"];
  for (const s of scenarios) {
    const tag = scenarios.length > 1 ? ` @ ${fmtPct(s.ratePct)}` : "";
    head.push(`Monthly SWP (avg)${tag}`, `Year-end value${tag}`);
  }
  const rows = base.rows.map((row, i) => {
    const cells: string[] = [firstLabel === "age" && row.age != null ? `${row.age}` : `${row.year}`];
    for (const s of scenarios) {
      const r = s.rows[i];
      cells.push(r && r.annualWithdrawal !== 0 ? inr(r.avgMonthlySwp) : "—", r ? inr(r.yearEndBalance) : "—");
    }
    return cells;
  });
  return (
    <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
      <Table head={head} rows={rows} highlightLastRow />
    </div>
  );
}

/** Annual withdrawal, tax payable and post-tax withdrawal for one scenario. */
export function SwpTaxTable({ rows, firstLabel }: { rows: SwpYearRow[]; firstLabel: "age" | "year" }) {
  const shown = rows.filter((r) => r.annualWithdrawal !== 0);
  if (shown.length === 0) return null;
  return (
    <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
      <Table
        head={[firstLabel === "age" ? "Age" : "Year", "Annual withdrawal", "Tax payable", "Post-tax withdrawal"]}
        rows={shown.map((r) => [
          firstLabel === "age" && r.age != null ? `${r.age}` : `${r.year}`,
          inr(r.annualWithdrawal),
          inr(r.tax),
          inr(r.postTax),
        ])}
      />
    </div>
  );
}
