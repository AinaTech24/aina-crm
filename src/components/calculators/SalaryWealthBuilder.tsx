"use client";

/**
 * Salary-Linked Wealth Builder.
 *
 * Invest a % of your monthly salary as a SIP that grows with your annual salary
 * increment. Projects the wealth created by retirement — or, in reverse, the
 * saving rate needed to hit a target wealth.
 *
 * Math lives in @/lib/calculators/salary-wealth (verified to the reference
 * case → total salary ₹13,72,87,915, new investment ₹1,37,28,791, total wealth
 * ₹7,27,62,939; saving mode ₹17,594 = 14.66% of salary). The new-investment
 * figure excludes the existing investment, which has its own return.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeSalaryWealth, type SalaryWealthMode } from "@/lib/calculators/salary-wealth";

const MODES: { value: SalaryWealthMode; label: string }[] = [
  { value: "wealth", label: "Wealth Creation" },
  { value: "saving", label: "Saving Required" },
];

export function SalaryWealthBuilder() {
  const [clientName, setClientName] = useState("");

  const [mode, setMode] = useState<SalaryWealthMode>("wealth");
  const [currentAge, setCurrentAge] = useState(32);
  const [retirementAge, setRetirementAge] = useState(60);
  const [currentMonthlySalary, setCurrentMonthlySalary] = useState(120000);
  const [sipPctOfSalary, setSipPctOfSalary] = useState(10);
  const [annualIncrementPct, setAnnualIncrementPct] = useState(8);
  const [investTillAge, setInvestTillAge] = useState(60);
  const [assumedReturnPct, setAssumedReturnPct] = useState(12);
  const [includeExisting, setIncludeExisting] = useState(true);
  const [existingInvestment, setExistingInvestment] = useState(600000);
  const [existingReturnPct, setExistingReturnPct] = useState(12);
  const [targetWealth, setTargetWealth] = useState(100000000);

  const isSaving = mode === "saving";

  const result = useMemo(
    () =>
      computeSalaryWealth({
        mode,
        currentAge,
        retirementAge,
        currentMonthlySalary,
        sipPctOfSalary,
        annualIncrementPct,
        investTillAge,
        assumedReturnPct,
        includeExisting,
        existingInvestment,
        existingReturnPct,
        targetWealth,
      }),
    [
      mode, currentAge, retirementAge, currentMonthlySalary, sipPctOfSalary,
      annualIncrementPct, investTillAge, assumedReturnPct, includeExisting,
      existingInvestment, existingReturnPct, targetWealth,
    ]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Salary-Linked Wealth Builder</h2>
        
      </div>

      <Segmented label="I want to find" value={mode} onChange={(v) => setMode(v as SalaryWealthMode)} options={MODES} />

      <div className="grid grid-cols-2 gap-3">
        {isSaving && <Num label="Target wealth (₹)" value={targetWealth} setValue={setTargetWealth} />}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Current age (yrs)" value={currentAge} setValue={setCurrentAge} step={1} />
        <Num label="Retirement age (yrs)" value={retirementAge} setValue={setRetirementAge} step={1} />
        <Num label="Current monthly salary (₹)" value={currentMonthlySalary} setValue={setCurrentMonthlySalary} />
        {!isSaving && <Num label="SIP — % of monthly salary" value={sipPctOfSalary} setValue={setSipPctOfSalary} step={1} />}
        <Num label="Annual salary increment (%)" value={annualIncrementPct} setValue={setAnnualIncrementPct} step={1} />
        <Num label="Investment till age (yrs)" value={investTillAge} setValue={setInvestTillAge} step={1} />
        <Num label="Assumed rate of return (%)" value={assumedReturnPct} setValue={setAssumedReturnPct} step={0.5} />
      </div>

      {/* Existing investment toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Include existing investment?</span>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" checked={includeExisting} onChange={() => setIncludeExisting(true)} /> Yes
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" checked={!includeExisting} onChange={() => setIncludeExisting(false)} /> No
        </label>
        {includeExisting && (
          <>
            <div className="w-48">
              <Num label="Existing investment (₹)" value={existingInvestment} setValue={setExistingInvestment} />
            </div>
            <div className="w-48">
              <Num label="Return on it (%)" value={existingReturnPct} setValue={setExistingReturnPct} step={0.5} />
            </div>
          </>
        )}
      </div>

      {/* Headline results */}
      {isSaving ? (
        <>
          <ResultRow
            cells={[
              { label: "Starting monthly SIP needed", value: inr(result.requiredMonthlySip ?? 0), tone: "emerald" },
              { label: "As % of monthly salary", value: Number.isFinite(result.requiredSipPct ?? 0) ? `${(result.requiredSipPct ?? 0).toFixed(2)}%` : "—", tone: "amber" },
              { label: "Target wealth", value: inr(result.targetWealth ?? 0) },
              { label: `New investment till age ${investTillAge}`, value: inr(result.newInvestment) },
            ]}
          />
          <ResultRow
            cells={[
              { label: "Or one-time lumpsum today", value: inr(result.requiredLumpsumToday ?? NaN), tone: "emerald" },
              { label: "Left invested for", value: `${result.totalYears} yrs, till age ${retirementAge}` },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Instead of a starting SIP of {inr(result.requiredMonthlySip ?? NaN)} rising with the salary, a one-time lumpsum of{" "}
            <strong>{inr(result.requiredLumpsumToday ?? NaN)}</strong> invested today at {assumedReturnPct}% reaches the{" "}
            {inr(result.targetWealth ?? 0)} target by age {retirementAge}{includeExisting ? ", together with the existing investment" : ""}.
          </p>
        </>
      ) : (
        <>
          <ResultRow
            cells={[
              { label: "Total salary received", value: inr(result.totalSalaryReceived) },
              { label: "New investment through SIP", value: inr(result.newInvestment) },
              { label: "Wealth from the SIP", value: inr(result.sipWealth), tone: "emerald" },
            ]}
          />
          <ResultRow
            cells={[
              { label: "Wealth from existing investment", value: includeExisting ? inr(result.existingFutureValue) : "—" },
              { label: `Total wealth at ${retirementAge}`, value: inr(result.wealth), tone: "emerald" },
              { label: "Starting monthly SIP", value: inr(result.monthlySip), tone: "amber" },
            ]}
          />
          {Number.isFinite(result.pctToMatchSalary) && result.totalSalaryReceived > 0 && (
            <p className="text-xs text-muted-foreground">
              To build, through the SIP alone, as much as the {inr(result.totalSalaryReceived)} of salary received, invest about{" "}
              <strong>{result.pctToMatchSalary.toFixed(2)}%</strong> of the monthly salary (rising with it) until age {investTillAge}.
            </p>
          )}
        </>
      )}

      {/* Secondary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Investing period" value={`${result.sipYears} yrs${result.holdYears > 0 ? ` + ${result.holdYears}y hold` : ""}`} />
        <Stat label="First → last monthly SIP" value={`${inr(result.monthlySip)} → ${inr(result.lastMonthlySip)}`} />
        {includeExisting && <Stat label="Existing fund grows to" value={inr(result.existingFutureValue)} />}
        <Stat label="SIP corpus alone" value={inr(result.wealth - result.existingFutureValue)} />
      </div>

      {/* Year-by-year schedule */}
      {result.schedule.length > 0 && (
        <details className="border border-border rounded-lg overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-secondary hover:bg-secondary">
            Year-by-year growth ({result.schedule.length} years)
          </summary>
          <div className="max-h-72 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Age</th>
                  <th className="px-4 py-2 font-medium text-right">Monthly SIP</th>
                  <th className="px-4 py-2 font-medium text-right">Invested that year</th>
                  <th className="px-4 py-2 font-medium text-right">Corpus at year end</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.age} className={`border-b border-slate-100 ${row.phase === "hold" ? "text-muted-foreground" : ""}`}>
                    <td className="px-4 py-1.5">{row.age}{row.phase === "hold" ? " (hold)" : ""}</td>
                    <td className="px-4 py-1.5 text-right">{row.monthlySipThatYear > 0 ? inr(row.monthlySipThatYear) : "—"}</td>
                    <td className="px-4 py-1.5 text-right">{row.investedThisYear > 0 ? inr(row.investedThisYear) : "—"}</td>
                    <td className="px-4 py-1.5 text-right font-medium">{inr(row.endCorpus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-muted-foreground px-4 py-2 border-t">
            Corpus shown is the SIP investment only{includeExisting ? "; the existing fund grows separately to the figure above." : "."}
          </p>
        </details>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. Assumes the SIP rises in step with your salary increment and a constant rate of return; actual
        results vary with market performance. Not investment advice.
      </p>
    </div>
  );
}

/* ───────────────────────── bits ───────────────────────── */

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <span className="text-2xs uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      <div className="inline-flex gap-1 rounded-lg bg-secondary p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              value === o.value ? "bg-white shadow-sm font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Num({
  label,
  value,
  setValue,
  step = 1000,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => {
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ResultRow({
  cells,
}: {
  cells: Array<{ label: string; value: string; tone?: "emerald" | "amber" | "rose" }>;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c, i) => {
        const tone =
          c.tone === "emerald"
            ? "border-emerald-200 bg-emerald-50/60"
            : c.tone === "amber"
              ? "border-amber-200 bg-amber-50/60"
              : c.tone === "rose"
                ? "border-rose-200 bg-rose-50/60"
                : "";
        return (
          <div key={i} className={`border rounded-md p-3 ${tone}`}>
            <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">{c.label}</div>
            <div className="text-lg font-semibold mt-0.5">{c.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
