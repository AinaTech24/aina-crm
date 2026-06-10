"use client";

/**
 * SIP 360° Planner — a comprehensive single-SIP analysis for client meetings.
 *
 * From one monthly amount + horizon it shows, across up to two return
 * scenarios: normal vs step-up future value, the effect of investing for a
 * limited number of years, the inflation-adjusted (real) corpus, and the
 * higher SIP needed if the client delays starting. Math lives in
 * src/lib/calculators/sip360.ts (effective monthly rate, begin-mode), and is
 * verified to the rupee against the reference case study.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeSip360, type Sip360Scenario } from "@/lib/calculators/sip360";

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

export function Sip360Planner() {
  // Core inputs
  const [monthly, setMonthly] = useState(10000);
  const [years, setYears] = useState(20);
  const [rate1, setRate1] = useState(12);
  const [useRate2, setUseRate2] = useState(true);
  const [rate2, setRate2] = useState(15);

  // Optional comparisons
  const [stepEnabled, setStepEnabled] = useState(true);
  const [stepPct, setStepPct] = useState(10);

  const [limitedEnabled, setLimitedEnabled] = useState(false);
  const [limitedDurs, setLimitedDurs] = useState<[number, number, number]>([5, 10, 15]);

  const [inflationEnabled, setInflationEnabled] = useState(false);
  const [inflationPct, setInflationPct] = useState(6);

  const [delayEnabled, setDelayEnabled] = useState(false);
  const [delayPeriods, setDelayPeriods] = useState<[number, number, number]>([2, 5, 7]);

  // Personalisation
  const [clientName, setClientName] = useState("");
  const [comments, setComments] = useState("");
  const [schemes, setSchemes] = useState("");

  const scenarios: Sip360Scenario[] = useMemo(() => {
    const s: Sip360Scenario[] = [{ key: "s1", ratePct: rate1 }];
    if (useRate2) s.push({ key: "s2", ratePct: rate2 });
    return s;
  }, [rate1, rate2, useRate2]);

  const result = useMemo(
    () =>
      computeSip360({
        monthly,
        years,
        scenarios,
        stepUp: { enabled: stepEnabled, pct: stepPct },
        limited: { enabled: limitedEnabled, durations: limitedDurs },
        inflation: { enabled: inflationEnabled, pct: inflationPct },
        delay: { enabled: delayEnabled, periods: delayPeriods },
      }),
    [
      monthly, years, scenarios, stepEnabled, stepPct, limitedEnabled, limitedDurs,
      inflationEnabled, inflationPct, delayEnabled, delayPeriods,
    ]
  );

  const rates = scenarios.map((s) => s.ratePct);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">SIP 360° Planner</h2>
        <p className="text-xs text-muted-foreground">
          A complete 360° view of a SIP: normal vs step-up growth, limited-period
          investing, inflation-adjusted value and the cost of delaying — across two
          return scenarios.
        </p>
      </div>

      {/* ─────────── Core inputs ─────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Monthly SIP (₹)" value={monthly} setValue={setMonthly} step={500} />
        <NumberField label="SIP period (years)" value={years} setValue={setYears} step={1} />
        <NumberField label="Return — Scenario 1 (%)" value={rate1} setValue={setRate1} step={0.5} />
        <div>
          <Toggle checked={useRate2} onChange={setUseRate2} label="Return — Scenario 2" />
          {useRate2 && (
            <input
              type="number"
              value={rate2}
              step={0.5}
              min={0}
              onChange={(e) => setRate2(clampNum(e.target.value))}
              className="input-base text-sm w-full mt-1"
            />
          )}
        </div>
      </div>

      {/* ─────────── Optional comparisons ─────────── */}
      <div className="rounded-lg border border-border/70 p-4 space-y-4 bg-secondary/20 print:bg-transparent">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Optional comparisons
        </div>

        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
          {/* Step-up */}
          <div className="space-y-2">
            <Toggle checked={stepEnabled} onChange={setStepEnabled} label="Step-up SIP comparison" />
            {stepEnabled && (
              <NumberField label="Step-up every year (%)" value={stepPct} setValue={setStepPct} step={1} />
            )}
          </div>

          {/* Inflation */}
          <div className="space-y-2">
            <Toggle checked={inflationEnabled} onChange={setInflationEnabled} label="Inflation-adjusted value" />
            {inflationEnabled && (
              <NumberField label="Expected inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />
            )}
          </div>

          {/* Limited period */}
          <div className="space-y-2">
            <Toggle checked={limitedEnabled} onChange={setLimitedEnabled} label="Limited-period SIP" />
            {limitedEnabled && (
              <div className="grid grid-cols-3 gap-2">
                {limitedDurs.map((d, i) => (
                  <SmallNum
                    key={i}
                    label={`SIP ${i + 1} (yrs)`}
                    value={d}
                    onChange={(v) => setLimitedDurs((p) => triReplace(p, i, v))}
                  />
                ))}
              </div>
            )}
            {limitedEnabled && (
              <p className="text-[10px] text-muted-foreground">Each must be shorter than the {years}-year horizon.</p>
            )}
          </div>

          {/* Cost of delay */}
          <div className="space-y-2">
            <Toggle checked={delayEnabled} onChange={setDelayEnabled} label="Cost of delay" />
            {delayEnabled && (
              <div className="grid grid-cols-3 gap-2">
                {delayPeriods.map((d, i) => (
                  <SmallNum
                    key={i}
                    label={`Delay ${i + 1} (yrs)`}
                    value={d}
                    onChange={(v) => setDelayPeriods((p) => triReplace(p, i, v))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─────────── Personalisation ─────────── */}
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Client name">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <Field label="Suggested schemes (optional)">
          <input value={schemes} onChange={(e) => setSchemes(e.target.value)} className="input-base text-sm w-full" placeholder="e.g. Flexi-cap + Mid-cap" />
        </Field>
        <Field label="Comments (optional)">
          <input value={comments} onChange={(e) => setComments(e.target.value)} className="input-base text-sm w-full" placeholder="Notes for the client" />
        </Field>
      </div>

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-brand-cyan-deep">{clientName}</span>
        </div>
      )}

      {/* ═══════════ OUTPUTS ═══════════ */}

      {/* 1. Total investment */}
      <Section n={1} title="Total investment">
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Stat label="Normal SIP" value={inr(result.normalInvested)} />
          {result.stepUpInvested != null ? (
            <Stat label="Step-up SIP" value={inr(result.stepUpInvested)} tone="cyan" />
          ) : (
            <Stat label="Step-up SIP" value="—" />
          )}
        </div>
      </Section>

      {/* 2. Expected future value */}
      <Section n={2} title="Expected future value">
        <Table
          head={["Mode", ...rates.map((r) => `@ ${fmtPct(r)} return`)]}
          rows={[
            ["Normal SIP", ...result.futureValue.map((f) => inr(f.normal))],
            ...(result.stepUpInvested != null
              ? [["Step-up SIP", ...result.futureValue.map((f) => (f.stepUp != null ? inr(f.stepUp) : "—"))]]
              : []),
          ]}
          highlightLastRow={result.stepUpInvested != null}
        />
        {result.stepUpInvested != null && (
          <Insight>Step-up SIP has the potential to create significantly higher wealth.</Insight>
        )}
      </Section>

      {/* 3. Limited period SIP */}
      {result.limited && result.limited.length > 0 && (
        <Section n={3} title="Limited-period SIP impact">
          <Table
            head={["SIP duration", "Investment", ...rates.map((r) => `Value @ ${fmtPct(r)}`)]}
            rows={result.limited.map((row) => [
              `${row.years} years`,
              inr(row.invested),
              ...row.values.map((v) => inr(v.value)),
            ])}
          />
          <Insight>
            Even shorter SIP periods grow through compounding, but end up well below the full {years}-year tenure.
          </Insight>
        </Section>
      )}

      {/* 4. Inflation-adjusted value */}
      {result.inflationAdjusted && result.inflationAdjusted.length > 0 && (
        <Section n={4} title={`Inflation-adjusted value (@ ${fmtPct(inflationPct)} inflation)`}>
          <Table
            head={["Scenario", "Nominal value", "Real value"]}
            rows={result.inflationAdjusted.map((r) => [
              `@ ${fmtPct(r.ratePct)} return`,
              inr(r.nominal),
              inr(r.real),
            ])}
          />
          <Insight tone="amber">Real purchasing power is much lower once inflation is accounted for.</Insight>
        </Section>
      )}

      {/* 5. Cost of delay */}
      {result.costOfDelay && result.costOfDelay.length > 0 && (
        <Section n={5} title="Cost of delay">
          <Table
            head={["If you delay", ...rates.map((r) => `SIP needed @ ${fmtPct(r)}`)]}
            rows={result.costOfDelay.map((row) => [
              `${row.delayYears} years`,
              ...row.required.map((q) => inr(q.sip)),
            ])}
          />
          <Insight tone="rose">
            Delaying drastically increases the SIP required to reach the same goal — starting early costs the least.
          </Insight>
        </Section>
      )}

      {(schemes || comments) && (
        <div className="grid md:grid-cols-2 gap-3 text-sm border-t pt-3">
          {schemes && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Suggested schemes</div>
              <div>{schemes}</div>
            </div>
          )}
          {comments && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Comments</div>
              <div>{comments}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── small helpers ───────────────────────── */

function clampNum(raw: string): number {
  const n = raw === "" ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function triReplace(arr: [number, number, number], i: number, v: number): [number, number, number] {
  const next = [...arr] as [number, number, number];
  next[i] = v;
  return next;
}

function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label, value, setValue, step = 1000,
}: { label: string; value: number; setValue: (v: number) => void; step?: number }) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => setValue(clampNum(e.target.value))}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function SmallNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-muted-foreground block mb-0.5">{label}</span>
      <input
        type="number"
        value={value}
        step={1}
        min={0}
        onChange={(e) => onChange(clampNum(e.target.value))}
        className="input-base text-sm w-full"
      />
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border accent-brand-cyan"
      />
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
    </label>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 break-inside-avoid">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <span className="inline-grid place-items-center size-5 rounded-md bg-brand-cyan-light text-brand-cyan-deep text-[11px] font-bold">{n}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "cyan" }) {
  return (
    <div className={`border rounded-md p-3 ${tone === "cyan" ? "border-brand-cyan/30 bg-brand-cyan-light/30" : ""}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function Table({
  head, rows, highlightLastRow,
}: { head: string[]; rows: (string | number)[][]; highlightLastRow?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left">
            {head.map((h, i) => (
              <th
                key={i}
                className={`py-1.5 px-3 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border ${i > 0 ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isLast = ri === rows.length - 1;
            return (
              <tr key={ri} className={highlightLastRow && isLast ? "bg-emerald-50/50 font-medium" : ""}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-1.5 px-3 border-b border-border/50 ${ci > 0 ? "text-right tabular-nums" : "font-medium"}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Insight({ children, tone = "emerald" }: { children: React.ReactNode; tone?: "emerald" | "amber" | "rose" }) {
  const cls =
    tone === "amber"
      ? "text-amber-800 bg-amber-50/70 border-amber-200"
      : tone === "rose"
        ? "text-rose-800 bg-rose-50/70 border-rose-200"
        : "text-emerald-800 bg-emerald-50/70 border-emerald-200";
  return <div className={`text-xs rounded-md border px-3 py-2 ${cls}`}>{children}</div>;
}
