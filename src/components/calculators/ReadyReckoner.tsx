"use client";

/**
 * Ready Reckoner — one grid component for four calculators (pick with `mode`):
 *   lumpsum_fv   · what a one-time investment grows to
 *   lumpsum_need · one-time investment needed today for a target
 *   sip_fv       · what a monthly SIP grows to
 *   sip_need     · monthly SIP needed for a target
 * Grid = up to 3 return rates (rows) × up to 5 periods (columns), in the order
 * entered. Math: src/lib/calculators/ready-reckoner.ts (verified cell-for-cell
 * against the reference case studies). The thin named wrappers at the bottom
 * give each mode its own catalog entry.
 */

import { useMemo, useState } from "react";
import {
  computeReadyReckoner, displayCell, MAX_PERIODS, MAX_RATES, type ReckonerMode,
} from "@/lib/calculators/ready-reckoner";
import { CHART_SERIES } from "@/lib/dashboard/chart-palette";
import { SchemeAutocomplete } from "../mf/SchemeAutocomplete";
import { CalcChart } from "./CalcChart";
import { inr, fmtPct, Field, NumberField, Toggle, Section, Table, Insight } from "./ui";

type ModeCopy = {
  title: string;
  blurb: string;
  amountLabel: string;
  amountStep: number;
  gridTitle: string;
  defaults: { amount: number; rates: number[]; years: number[] };
};

const COPY: Record<ReckonerMode, ModeCopy> = {
  lumpsum_fv: {
    title: "Lumpsum Growth Reckoner",
    blurb: "What a one-time investment could grow to, across return rates and holding periods.",
    amountLabel: "One-time investment (₹)",
    amountStep: 50000,
    gridTitle: "Projected value of the investment",
    defaults: { amount: 500000, rates: [10, 12, 15], years: [5, 10, 15, 20, 25] },
  },
  lumpsum_need: {
    title: "Lumpsum Needed Reckoner",
    blurb: "The one-time amount to invest today to reach a target, across return rates and periods.",
    amountLabel: "Target amount (₹)",
    amountStep: 100000,
    gridTitle: "One-time investment needed today",
    defaults: { amount: 10000000, rates: [10, 12, 15], years: [5, 10, 15, 20, 25] },
  },
  sip_fv: {
    title: "SIP Growth Reckoner",
    blurb: "What a monthly SIP could grow to, across return rates and SIP periods.",
    amountLabel: "Monthly SIP (₹)",
    amountStep: 500,
    gridTitle: "Projected value of the SIP",
    defaults: { amount: 10000, rates: [10, 12, 15], years: [5, 10, 15, 20, 25] },
  },
  sip_need: {
    title: "SIP Needed Reckoner",
    blurb: "The monthly SIP that would reach a target, across return rates and SIP periods.",
    amountLabel: "Target amount (₹)",
    amountStep: 100000,
    gridTitle: "Monthly SIP needed",
    defaults: { amount: 10000000, rates: [10, 12, 15], years: [10, 15, 20, 25, 30] },
  },
};

/** Fixed number of boxes; "" = a blank box (skipped). */
function boxes(values: number[], n: number): string[] {
  return Array.from({ length: n }, (_, i) => (values[i] != null ? String(values[i]) : ""));
}
function parseBox(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function lakh(v: number): string {
  return displayCell(v, "lakh").toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BoxRow({
  label, values, onChange, suffix,
}: { label: string; values: string[]; onChange: (next: string[]) => void; suffix: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium mb-1">{label}</div>
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <label key={i} className="block">
            <span className="sr-only">{`${label} ${i + 1}`}</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={suffix === "%" ? 0.5 : 1}
                value={v}
                onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
                className="input-base text-sm w-20"
              />
              <span className="text-2xs text-muted-foreground">{suffix}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ReadyReckoner({ mode }: { mode: ReckonerMode }) {
  const copy = COPY[mode];
  const [amount, setAmount] = useState(copy.defaults.amount);
  const [rateBoxes, setRateBoxes] = useState<string[]>(() => boxes(copy.defaults.rates, MAX_RATES));
  const [yearBoxes, setYearBoxes] = useState<string[]>(() => boxes(copy.defaults.years, MAX_PERIODS));
  const [exact, setExact] = useState(false);
  const [schemes, setSchemes] = useState("");

  const result = useMemo(
    () =>
      computeReadyReckoner({
        mode,
        amount,
        ratesPct: rateBoxes.map(parseBox),
        years: yearBoxes.map(parseBox),
      }),
    [mode, amount, rateBoxes, yearBoxes]
  );

  const isLakh = result.unit === "lakh";
  const fmt = (v: number) => (isLakh && !exact ? lakh(v) : inr(displayCell(v, "rupee")));
  const isNeed = mode === "lumpsum_need" || mode === "sip_need";

  const head = ["Return (p.a.)", ...result.years.map((y) => `${y} yrs`)];
  const rows = result.rates.map((r, ri) => [
    `${r.toFixed(2)}%`,
    ...result.cells[ri].map((v) => fmt(v)),
  ]);

  const chartData = result.years.map((y, yi) => {
    const point: Record<string, number> = { year: y };
    result.rates.forEach((_, ri) => { point[`r${ri}`] = result.cells[ri][yi]; });
    return point;
  });
  const series = result.rates.map((r, ri) => ({
    key: `r${ri}`, name: `@ ${fmtPct(r)}`, color: CHART_SERIES[ri % CHART_SERIES.length],
  }));

  // One worked reading of the grid for the insight line: first rate, longest period.
  const firstRate = result.rates[0];
  const lastYi = result.years.length - 1;
  const lastYear = result.years[lastYi];
  const sample = result.valid ? result.cells[0][lastYi] : NaN;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">{copy.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{copy.blurb}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <NumberField label={copy.amountLabel} value={amount} setValue={setAmount} step={copy.amountStep} />
        <BoxRow label={`Return rates (up to ${MAX_RATES})`} values={rateBoxes} onChange={setRateBoxes} suffix="%" />
        <BoxRow label={`Periods (up to ${MAX_PERIODS})`} values={yearBoxes} onChange={setYearBoxes} suffix="yrs" />
      </div>
      <p className="text-2xs text-muted-foreground -mt-3">
        Leave a box empty to drop it. Rows and columns follow the order you type them in.
      </p>

      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Suggested schemes (optional)">
          <SchemeAutocomplete
            size="sm"
            placeholder="Search your Scheme Master to add…"
            onSelect={(s) => setSchemes(schemes ? `${schemes}, ${s.schemeName}` : s.schemeName)}
          />
          {schemes && (
            <div className="mt-1 flex items-start gap-1.5 text-2xs text-muted-foreground">
              <span className="flex-1">{schemes}</span>
              <button type="button" onClick={() => setSchemes("")} className="text-rose-600 hover:underline shrink-0">clear</button>
            </div>
          )}
        </Field>
        {isLakh && (
          <div className="flex items-end pb-2">
            <Toggle checked={exact} onChange={setExact} label="Show exact rupees" />
          </div>
        )}
      </div>

      {!result.valid ? (
        <Insight tone="amber">
          Enter an amount above zero, at least one return rate and at least one period.
        </Insight>
      ) : (
        <>
          <Section n={1} title={`${copy.gridTitle} — ${isNeed ? "target" : mode === "sip_fv" ? "monthly SIP" : "invested"} ${inr(amount)}`}>
            <Table head={head} rows={rows} />
            <p className="text-2xs text-muted-foreground">
              {isLakh && !exact ? "Figures in ₹ lakh (1 lakh = ₹1,00,000), rounded to 2 decimals." : "Figures in ₹, rounded to the rupee."}
              {mode === "sip_fv" || mode === "sip_need"
                ? " SIP paid at the start of every month; the annual return is converted to an equivalent monthly rate."
                : " Returns compound once a year."}
            </p>
            {Number.isFinite(sample) && (
              <Insight tone="cyan">
                {mode === "lumpsum_fv" && (
                  <>At {fmtPct(firstRate)} a year, {inr(amount)} invested once could become about <strong>{inr(sample)}</strong> in {lastYear} years.</>
                )}
                {mode === "sip_fv" && (
                  <>At {fmtPct(firstRate)} a year, a {inr(amount)} monthly SIP for {lastYear} years could grow to about <strong>{inr(sample)}</strong>, against {inr(amount * Math.round(lastYear * 12))} paid in.</>
                )}
                {mode === "lumpsum_need" && (
                  <>To have {inr(amount)} in {lastYear} years at {fmtPct(firstRate)} a year, about <strong>{inr(sample)}</strong> invested today is enough — the longer the runway, the smaller the cheque.</>
                )}
                {mode === "sip_need" && (
                  <>To build {inr(amount)} in {lastYear} years at {fmtPct(firstRate)} a year, a monthly SIP of about <strong>{inr(sample)}</strong> is needed — starting earlier lowers it sharply.</>
                )}
              </Insight>
            )}
          </Section>

          {result.years.length >= 2 && (
            <Section n={2} title={isNeed ? "How the requirement falls with time" : "How the value builds with time"}>
              <CalcChart data={chartData} xKey="year" series={series} />
            </Section>
          )}
        </>
      )}

      {schemes && (
        <div className="text-sm border-t pt-3">
          <div className="text-2xs uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Suggested schemes</div>
          <div>{schemes}</div>
        </div>
      )}
    </div>
  );
}

/* Thin wrappers — one per catalog entry. */
export function LumpsumFvReckoner() { return <ReadyReckoner mode="lumpsum_fv" />; }
export function LumpsumNeedReckoner() { return <ReadyReckoner mode="lumpsum_need" />; }
export function SipFvReckoner() { return <ReadyReckoner mode="sip_fv" />; }
export function SipNeedReckoner() { return <ReadyReckoner mode="sip_need" />; }
