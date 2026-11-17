"use client";

/**
 * Child Education / Marriage need based — inflate today's cost to the age the
 * money is needed, set the earmarked savings (growing at their own return)
 * against it, and show four ways to fund the balance — SIP till then, SIP for 5
 * or 10 years then hold, or a lumpsum today — under one or two return scenarios.
 * One goal by default; more milestones can be added.
 * Math: src/lib/calculators/child-education.ts (verified to the reference case →
 * ₹2,69,27,728 needed, balance ₹2,34,94,707, SIP ₹37,647 / ₹27,871).
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { computeChildEducation, type EduMilestone } from "@/lib/calculators/child-education";
import { isDueNow } from "@/lib/calculators/goal-collision";
import { inr, fmtPct, clampNum, NumberField, TextField, Toggle, Segmented, Section, Stat, Table, Insight } from "./ui";

type Purpose = "education" | "marriage" | "investment";
const PURPOSE_LABEL: Record<Purpose, string> = { education: "Education", marriage: "Marriage", investment: "Investment" };

let nextId = 1;
type Row = EduMilestone & { id: number };
const mk = (name: string, age: number, cost: number): Row => ({ id: nextId++, name, childAgeAtStart: age, currentCost: cost });

export function ChildEducationProjector() {
  const [childName, setChildName] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("education");
  const [childCurrentAge, setChildCurrentAge] = useState(4);
  const [inflationPct, setInflationPct] = useState(6);
  const [existingSavings, setExistingSavings] = useState(500000);
  const [savingsReturnPct, setSavingsReturnPct] = useState(12);
  const [scenario1Pct, setScenario1Pct] = useState(12);
  const [useScenario2, setUseScenario2] = useState(true);
  const [scenario2Pct, setScenario2Pct] = useState(15);
  const [rows, setRows] = useState<Row[]>(() => [mk("Education", 21, 10000000)]);

  const result = useMemo(
    () =>
      computeChildEducation({
        childCurrentAge,
        eduInflationPct: inflationPct,
        expectedReturnPct: scenario1Pct,
        existingSavings,
        currentInvestmentReturnPct: savingsReturnPct,
        scenario2Pct: useScenario2 ? scenario2Pct : null,
        milestones: rows,
      }),
    [childCurrentAge, inflationPct, scenario1Pct, existingSavings, savingsReturnPct, useScenario2, scenario2Pct, rows]
  );

  function update(id: number, patch: Partial<Row>) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function add() { setRows((prev) => [...prev, mk("Next milestone", 24, 1000000)]); }
  function remove(id: number) { setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id))); }

  const single = result.milestones.length === 1;
  const who = childName.trim() || "the child";
  const rateHead = (ratePct: number) => `@ ${fmtPct(ratePct)}`;
  const opt = (v: number | null) => (v == null ? "—" : inr(v));

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Child Education &amp; Marriage Planner</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <TextField label="Child's name" value={childName} setValue={setChildName} />
        <NumberField label="Child's current age (yrs)" value={childCurrentAge} setValue={setChildCurrentAge} step={1} />
      </div>

      <Segmented
        label="Money needed for"
        value={purpose}
        onChange={setPurpose}
        options={(Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => ({ value: p, label: PURPOSE_LABEL[p] }))}
      />

      <div>
        <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium mb-1.5">When and how much (today&apos;s cost)</div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-end gap-2 flex-wrap">
              <label className="block"><span className="text-2xs text-muted-foreground block mb-0.5">Need</span>
                <input value={row.name} onChange={(e) => update(row.id, { name: e.target.value })} className="input-base text-sm w-40" /></label>
              <label className="block"><span className="text-2xs text-muted-foreground block mb-0.5">Needed at child&apos;s age</span>
                <input type="number" value={row.childAgeAtStart} step={1} onChange={(e) => update(row.id, { childAgeAtStart: clampNum(e.target.value) })} className="input-base text-sm w-32" /></label>
              <label className="block"><span className="text-2xs text-muted-foreground block mb-0.5">Cost today (₹)</span>
                <input type="number" value={row.currentCost} step={100000} onChange={(e) => update(row.id, { currentCost: clampNum(e.target.value) })} className="input-base text-sm w-36" /></label>
              {rows.length > 1 && (
                <button type="button" onClick={() => remove(row.id)} className="btn-icon text-muted-foreground hover:text-foreground print:hidden" aria-label="Remove milestone"><Trash2 className="size-4" /></button>
              )}
            </div>
          ))}
          <button type="button" onClick={add} className="btn-ghost text-xs print:hidden">+ Add another milestone</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Expected inflation (%)" value={inflationPct} setValue={setInflationPct} step={0.5} />
        <NumberField label="Savings already set aside (₹)" value={existingSavings} setValue={setExistingSavings} step={100000} />
        <NumberField label="Return on those savings (%)" value={savingsReturnPct} setValue={setSavingsReturnPct} step={0.5} />
        <NumberField label="Return on new investment — scenario 1 (%)" value={scenario1Pct} setValue={setScenario1Pct} step={0.5} />
        <div className="flex flex-col justify-end gap-1">
          <Toggle checked={useScenario2} onChange={setUseScenario2} label="Compare scenario 2" />
          {useScenario2 && <NumberField label="Scenario 2 return (%)" value={scenario2Pct} setValue={setScenario2Pct} step={0.5} />}
        </div>
      </div>


      {result.milestones.map((m, i) => (
        <Section key={i} n={i + 1} title={`${m.name || PURPOSE_LABEL[purpose]} for ${who} — in ${m.yearsAway} years`}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label="Cost when needed" value={inr(m.futureCost)} tone="cyan" />
            <Stat label="Savings will cover" value={inr(m.savingsApplied)} />
            <Stat label="Balance to fund" value={inr(m.balance)} tone={m.balance > 0 ? "amber" : "emerald"} />
          </div>
          {m.balance <= 0 ? (
            <Insight>The savings already set aside cover this need — nothing more to invest.</Insight>
          ) : isDueNow(m.yearsAway) ? (
            <Insight tone="amber">This need is due now — only a lumpsum ({inr(m.balance)}) can meet it.</Insight>
          ) : (
            <Table
              head={["Way to fund the balance", ...m.options.map((o) => rateHead(o.ratePct))]}
              rows={[
                [`Monthly SIP till age ${childCurrentAge + m.yearsAway}`, ...m.options.map((o) => inr(o.sipTillGoal))],
                ["Monthly SIP for 5 years, then hold", ...m.options.map((o) => opt(o.sip5y))],
                ["Monthly SIP for 10 years, then hold", ...m.options.map((o) => opt(o.sip10y))],
                ["Lumpsum today", ...m.options.map((o) => inr(o.lumpsum))],
              ]}
            />
          )}
        </Section>
      ))}

      {!single && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="All needs — future cost" value={inr(result.totalFutureCost)} tone="cyan" />
          <Stat label={`All needs — monthly SIP ${rateHead(scenario1Pct)}`} value={inr(result.totalMonthlySip)} tone="emerald" />
          <Stat label={`All needs — lumpsum ${rateHead(scenario1Pct)}`} value={inr(result.totalLumpsum)} />
        </div>
      )}

      {result.milestones[0] && result.milestones[0].balance > 0 && !isDueNow(result.milestones[0].yearsAway) && (
        <Insight tone="cyan">
          At {fmtPct(inflationPct)} inflation, today&apos;s {inr(rows[0]?.currentCost ?? 0)} becomes{" "}
          <strong>{inr(result.milestones[0].futureCost)}</strong> in {result.milestones[0].yearsAway} years. Starting now,{" "}
          <strong>{inr(result.milestones[0].options[0].sipTillGoal)}/month</strong> {rateHead(scenario1Pct)} closes the gap — a
          shorter SIP needs more each month, and waiting raises every figure.
        </Insight>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. SIPs are invested at the start of each month at the effective monthly equivalent of the yearly
        return; a 5- or 10-year SIP stays invested until the money is needed. Savings already set aside grow yearly at their own
        return. Returns are neither indicative nor guaranteed. Not investment advice.
      </p>
    </div>
  );
}
