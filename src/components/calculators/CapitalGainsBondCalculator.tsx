"use client";

/**
 * Capital Gains Bond (54EC) vs Other Investment — park a long-term capital gain
 * in a 54EC bond, or pay the tax and invest the rest elsewhere; compares the
 * post-tax maturity and post-tax IRR of each choice.
 * Math: src/lib/calculators/capital-gains-bond.ts (verified to the reference
 * case → ₹50 L gain over 5 yrs: bond 3.78%, FD 1.59%, debt 2.32%, equity 7.84%).
 */

import { useMemo, useState } from "react";
import { capitalGainsBondVsOthers, type CgBondColumn } from "@/lib/calculators/capital-gains-bond";
import { inr, NumberField, Toggle, Segmented, Section, Stat, Table, Insight } from "./ui";

type Option = {
  key: string;
  name: string;
  enabled: boolean;
  ratePct: number;
  taxRatePct: number;
  indexation: boolean;
  isEquity?: boolean;
  editableName?: boolean;
};

const DEFAULT_OPTIONS: Option[] = [
  { key: "fd", name: "Fixed Deposit", enabled: true, ratePct: 6, taxRatePct: 30, indexation: false },
  { key: "debt", name: "Debt Fund", enabled: true, ratePct: 7, taxRatePct: 30, indexation: false },
  { key: "equity", name: "Equity Fund", enabled: true, ratePct: 12, taxRatePct: 12.5, indexation: false, isEquity: true },
  { key: "other", name: "Other product", enabled: false, ratePct: 8, taxRatePct: 30, indexation: false, editableName: true },
];

const pct = (n: number) => `${n.toFixed(2)}%`;

export function CapitalGainsBondCalculator() {
  const [gain, setGain] = useState(5000000);
  const [ltcgRatePct, setLtcgRatePct] = useState(12.5);
  const [years, setYears] = useState(5);
  const [bondRatePct, setBondRatePct] = useState(5.25);
  const [indexationPct, setIndexationPct] = useState(5);
  const [slabPct, setSlabPct] = useState(30);
  const [options, setOptions] = useState<Option[]>(DEFAULT_OPTIONS);
  const [addCess, setAddCess] = useState(false);
  const [useExemption, setUseExemption] = useState(false);
  const [exemption, setExemption] = useState(125000);

  const cols = useMemo(
    () =>
      capitalGainsBondVsOthers({
        gain, ltcgRatePct, years, bondRatePct, slabPct, indexationPct,
        cessPct: addCess ? 4 : 0,
        options: options.filter((o) => o.enabled).map((o) => ({
          name: o.name || "Other product",
          ratePct: o.ratePct,
          taxRatePct: o.taxRatePct,
          indexation: o.indexation,
          exemption: useExemption && o.isEquity ? exemption : 0,
        })),
      }),
    [gain, ltcgRatePct, years, bondRatePct, slabPct, indexationPct, addCess, useExemption, exemption, options]
  );

  function patch(key: string, p: Partial<Option>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...p } : o)));
  }

  const usesIndexation = options.some((o) => o.enabled && o.indexation);
  const best = cols.reduce<CgBondColumn | null>(
    (b, c) => (c.postTaxIrrPct != null && (b == null || (b.postTaxIrrPct ?? -Infinity) < c.postTaxIrrPct) ? c : b),
    null
  );
  const bond = cols[0];
  const row = (label: string, f: (c: CgBondColumn) => string) => [label, ...cols.map(f)];

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Capital Gains Bond (54EC) vs Other Investment</h2>
      </div>


      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Long-term capital gain (₹)" value={gain} setValue={setGain} step={100000} />
        <NumberField label="LTCG tax rate (%)" value={ltcgRatePct} setValue={setLtcgRatePct} step={0.5} />
        <NumberField label="Bond lock-in / period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="54EC bond interest (%)" value={bondRatePct} setValue={setBondRatePct} step={0.25} />
        <NumberField label="Your income-tax slab (%)" value={slabPct} setValue={setSlabPct} step={5} />
        <NumberField label="Assumed yearly rise in CII (%)" value={indexationPct} setValue={setIndexationPct} step={0.5} />
      </div>

      <div>
        <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Compare the bond with</div>
        <div className="space-y-2">
          {options.map((o) => (
            <div key={o.key} className="flex flex-wrap items-end gap-3 rounded-md border border-border/70 p-3">
              <div className="w-40">
                <Toggle checked={o.enabled} onChange={(v) => patch(o.key, { enabled: v })} label={o.editableName ? "Add a product" : o.name} />
                {o.editableName && o.enabled && (
                  <input value={o.name} onChange={(e) => patch(o.key, { name: e.target.value })} className="input-base text-sm w-full mt-1" aria-label="Product name" />
                )}
              </div>
              {o.enabled && (
                <>
                  <div className="w-32"><NumberField label="Return (%)" value={o.ratePct} setValue={(v) => patch(o.key, { ratePct: v })} step={0.25} /></div>
                  <div className="w-32"><NumberField label="Tax rate (%)" value={o.taxRatePct} setValue={(v) => patch(o.key, { taxRatePct: v })} step={0.5} /></div>
                  <Segmented
                    label="Indexation"
                    value={o.indexation ? "yes" : "no"}
                    onChange={(v) => patch(o.key, { indexation: v === "yes" })}
                    options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes (estimate)" }]}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 items-end rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent">
        <Toggle checked={addCess} onChange={setAddCess} label="Add 4% health & education cess" />
        <Toggle checked={useExemption} onChange={setUseExemption} label="Deduct equity LTCG exemption" />
        {useExemption && <NumberField label="Exemption amount (₹)" value={exemption} setValue={setExemption} step={25000} />}
        <p className="text-2xs text-muted-foreground md:col-span-3">
          Both are off by default — the standard illustration taxes the whole gain at the rate entered, with no cess and no exemption.
        </p>
      </div>


      <div className={`grid gap-3 grid-cols-2 ${cols.length > 3 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {cols.map((c) => (
          <Stat
            key={c.name}
            label={`${c.name} · post-tax IRR`}
            value={c.postTaxIrrPct == null ? "—" : pct(c.postTaxIrrPct)}
            tone={best && c.name === best.name ? "emerald" : c.isBond ? "cyan" : undefined}
          />
        ))}
      </div>

      <Section n={1} title="Side-by-side comparison">
        <Table
          head={["", ...cols.map((c) => c.name)]}
          rows={[
            row("Capital gain", (c) => inr(c.gain)),
            row("LTCG tax paid now", (c) => inr(c.ltcgTax)),
            row("Amount invested", (c) => inr(c.netInvestment)),
            row("Assumed return", (c) => pct(c.ratePct)),
            row("Period (yrs)", (c) => `${c.years}`),
            row("Indexation", (c) => (c.indexation ? "Yes" : "No")),
            row("Maturity value", (c) => inr(c.maturity)),
            row("Indexation rate", (c) => pct(c.indexationPct)),
            row("Cost for tax (indexed)", (c) => inr(c.indexedCost)),
            row("Taxable income", (c) => inr(c.taxableIncome)),
            row("Tax rate", (c) => pct(c.taxRatePct)),
            row(addCess ? "Tax (incl. cess)" : "Tax", (c) => inr(c.tax)),
            row("Maturity after tax", (c) => inr(c.postTaxMaturity)),
            row("Post-tax IRR (on the full gain)", (c) => (c.postTaxIrrPct == null ? "—" : pct(c.postTaxIrrPct))),
          ]}
          highlightLastRow
        />
      </Section>

      {best && bond.postTaxIrrPct != null && (
        <Insight tone={best.isBond ? "cyan" : "emerald"}>
          After tax, <strong>{best.name}</strong> leaves the most: <strong>{inr(best.postTaxMaturity)}</strong> after {bond.years} years,
          a post-tax return of <strong>{pct(best.postTaxIrrPct ?? 0)}</strong> on the original {inr(gain)} gain.
          {!best.isBond && <> The 54EC bond would leave {inr(bond.postTaxMaturity)} ({pct(bond.postTaxIrrPct)}).</>}
        </Insight>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. Interest or gains are assumed reinvested at the same rate and taxed once, at maturity. The IRR is
        measured on the full capital gain, so tax paid up front lowers it. 54EC bonds carry a 5-year lock-in and a yearly
        investment limit; their interest is taxed at your slab.
        {usesIndexation && " Indexation “Yes” is an estimate: the cost is raised by the assumed yearly rise in the Cost Inflation Index, compounded."}
        {" "}Not tax or investment advice.
      </p>
    </div>
  );
}
