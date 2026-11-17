"use client";

/**
 * Term Insurance + SIP — three views of "buy pure cover, invest the rest":
 *   • From a budget  — a yearly outlay pays the term premium; the rest is a
 *                      monthly SIP. What is the fund, and the family's payout?
 *   • For a goal     — the monthly SIP that grows to the cover amount by the end
 *                      of the term (cover + SIP = a guaranteed-minimum outcome).
 *   • Vs a policy    — the same premium in a traditional policy vs a term plan
 *                      plus a monthly SIP of the difference.
 * Math: src/lib/calculators/term-plus-sip.ts (sip360 effective-rate, month-start
 * SIP; verified to the reference cases → ₹10,01,31,629 · ₹3,246/month ·
 * ₹2,19,32,588 vs ₹3,71,77,568). Pre-tax figures.
 */

import { useMemo, useState } from "react";
import { termPlusSip, termPlusSipGoal, insuranceVsTermSip } from "@/lib/calculators/term-plus-sip";
import { inr, fmtPct, NumberField, Segmented, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

type Mode = "budget" | "goal" | "policy";

export function TermPlusSipCalculator({ initialMode = "budget" }: { initialMode?: Mode } = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  // Budget + goal views
  const [age, setAge] = useState(30);
  const [annualOutlay, setAnnualOutlay] = useState(400000);
  const [sumAssured, setSumAssured] = useState(10000000);
  const [termYears, setTermYears] = useState(30);
  const [premium, setPremium] = useState(10000);
  const [returnPct, setReturnPct] = useState(12);

  // Policy view
  const [policyPremium, setPolicyPremium] = useState(500000);
  const [policyCover, setPolicyCover] = useState(5000000);
  const [policyYears, setPolicyYears] = useState(20);
  const [policyRatePct, setPolicyRatePct] = useState(7);
  const [termPremium, setTermPremium] = useState(15000);
  const [sipRatePct, setSipRatePct] = useState(12);

  const budget = useMemo(
    () => termPlusSip({ age, annualOutlay, sumAssured, termYears, premium, returnPct }),
    [age, annualOutlay, sumAssured, termYears, premium, returnPct]
  );
  const goal = useMemo(
    () => termPlusSipGoal({ age, goal: sumAssured, termYears, premium, returnPct }),
    [age, sumAssured, termYears, premium, returnPct]
  );
  const policy = useMemo(
    () =>
      insuranceVsTermSip({
        premium: policyPremium, sumAssured: policyCover, years: policyYears,
        termPremium, sipRatePct, insuranceRatePct: policyRatePct,
      }),
    [policyPremium, policyCover, policyYears, termPremium, sipRatePct, policyRatePct]
  );

  const rows = mode === "goal" ? goal.rows : budget.rows;
  const finalAge = mode === "goal" ? goal.finalAge : budget.finalAge;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Term Insurance + SIP</h2>
      </div>

      <Segmented
        label="Start from"
        value={mode}
        onChange={setMode}
        options={[
          { value: "budget", label: "A yearly budget" },
          { value: "goal", label: "A goal (need based)" },
          { value: "policy", label: "Compare with a policy" },
        ]}
      />

      {mode !== "policy" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumberField label="Current age (yrs)" value={age} setValue={setAge} step={1} />
          {mode === "budget" && (
            <NumberField label="Yearly budget — premium + SIP (₹)" value={annualOutlay} setValue={setAnnualOutlay} step={10000} />
          )}
          <NumberField
            label={mode === "goal" ? "Cover = goal amount (₹)" : "Term cover (₹)"}
            value={sumAssured}
            setValue={setSumAssured}
            step={500000}
          />
          <NumberField label="Term period (yrs)" value={termYears} setValue={setTermYears} step={1} />
          <NumberField label="Term premium per year (₹)" value={premium} setValue={setPremium} step={1000} />
          <NumberField label="Expected SIP return (%)" value={returnPct} setValue={setReturnPct} step={0.5} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumberField label="Policy premium per year (₹)" value={policyPremium} setValue={setPolicyPremium} step={10000} />
          <NumberField label="Sum assured / death benefit (₹)" value={policyCover} setValue={setPolicyCover} step={500000} />
          <NumberField label="Policy term (yrs)" value={policyYears} setValue={setPolicyYears} step={1} />
          <NumberField label="Expected return on the policy (%)" value={policyRatePct} setValue={setPolicyRatePct} step={0.25} />
          <NumberField label="Term premium for the same cover (₹/yr)" value={termPremium} setValue={setTermPremium} step={1000} />
          <NumberField label="Expected SIP return (%)" value={sipRatePct} setValue={setSipRatePct} step={0.5} />
        </div>
      )}


      {mode === "budget" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Left for SIP each year" value={inr(budget.balanceForSip)} />
            <Stat label="Monthly SIP" value={inr(budget.sipMonthly)} tone="cyan" />
            <Stat label={`Fund at age ${budget.finalAge}`} value={inr(budget.finalValue)} tone="emerald" />
            <Stat label="Cover throughout" value={inr(sumAssured)} />
          </div>
          {premium >= annualOutlay && (
            <Insight tone="amber">The premium uses the whole budget, so nothing is left to invest.</Insight>
          )}
          {budget.finalValue > 0 && (
            <Insight tone="cyan">
              Of the {inr(annualOutlay)} a year, {inr(premium)} buys {inr(sumAssured)} of cover and{" "}
              <strong>{inr(budget.sipMonthly)}/month</strong> goes into a SIP that could reach{" "}
              <strong>{inr(budget.finalValue)}</strong> by age {budget.finalAge} at {fmtPct(returnPct)}. If the worst happens
              in between, the family receives the cover plus the fund built so far.
            </Insight>
          )}
        </>
      )}

      {mode === "goal" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label={`Monthly SIP needed @ ${fmtPct(returnPct)}`} value={inr(goal.sipMonthly)} tone="cyan" />
            <Stat label="Yearly outlay (premium + SIP)" value={inr(goal.annualOutlay)} />
            <Stat label={`Minimum payout, alive at ${goal.finalAge} or not`} value={inr(sumAssured)} tone="emerald" />
          </div>
          {goal.sipMonthly > 0 && (
            <Insight tone="cyan">
              A {inr(sumAssured)} term plan plus a SIP of <strong>{inr(goal.sipMonthly)}/month</strong> means at least{" "}
              <strong>{inr(sumAssured)}</strong> for the family either way: as the SIP fund at age {goal.finalAge}, or as the
              cover (plus whatever the SIP has built) earlier — subject to the SIP earning {fmtPct(returnPct)}.
            </Insight>
          )}
        </>
      )}

      {mode !== "policy" && rows.length > 0 && (
        <Section n={1} title={`Year by year to age ${finalAge}`}>
          <CalcChart
            data={rows.map((r) => ({ age: r.age, fund: r.sipValue, payout: r.payout }))}
            xKey="age"
            xUnit="Age"
            series={[
              { key: "payout", name: "Payout on death", color: "#f59e0b" },
              { key: "fund", name: "SIP fund", color: "#0ea5e9" },
            ]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Age", mode === "goal" ? "Yearly investment" : "Yearly budget", "Life cover", "SIP fund at year end", "Payout on death"]}
              rows={rows.map((r) => [`${r.age}`, inr(r.annualOutlay), inr(r.cover), inr(r.sipValue), inr(r.payout)])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      {mode === "policy" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Policy maturity value" value={inr(policy.maturity)} tone="amber" />
            <Stat label="Monthly SIP (premium − term) ÷ 12" value={inr(policy.monthlySip)} tone="cyan" />
            <Stat label="Term + SIP fund value" value={inr(policy.fundValue)} tone="emerald" />
            <Stat label="Difference" value={inr(policy.difference)} />
          </div>
          <Section n={1} title="The two routes, same yearly outlay">
            <Table
              head={["", "Traditional policy", "Term cover + SIP"]}
              rows={[
                ["Yearly outlay", inr(policyPremium), inr(policyPremium)],
                ["Life cover", inr(policyCover), inr(policyCover)],
                ["Term premium", "—", inr(termPremium)],
                ["Monthly SIP", "—", inr(policy.monthlySip)],
                ["Period (yrs)", `${policyYears}`, `${policyYears}`],
                ["Assumed return", fmtPct(policyRatePct), fmtPct(sipRatePct)],
                ["Expected value at the end", inr(policy.maturity), inr(policy.fundValue)],
              ]}
              highlightLastRow
            />
            {policy.rows.length > 1 && (
              <CalcChart
                data={policy.rows.map((r) => ({ year: r.year, policy: r.policyValue, sip: r.sipValue }))}
                xKey="year"
                series={[
                  { key: "sip", name: "Term + SIP", color: "#10b981" },
                  { key: "policy", name: "Policy", color: "#f59e0b" },
                ]}
              />
            )}
          </Section>
          {policy.difference !== 0 && (
            <Insight tone={policy.difference > 0 ? "emerald" : "amber"}>
              For the same {inr(policyPremium)} a year and the same {inr(policyCover)} of cover, the term-plus-SIP route could end
              with <strong>{inr(Math.abs(policy.difference))}</strong> {policy.difference > 0 ? "more" : "less"} than the policy after{" "}
              {policyYears} years.
            </Insight>
          )}
        </>
      )}

      <p className="text-2xs text-muted-foreground border-t pt-3">
        * Illustration only. The SIP is invested at the start of each month and compounds at the assumed yearly return; the
        premium stays level for the term. Figures are before tax. Returns are neither indicative nor guaranteed. Not investment advice.
      </p>
    </div>
  );
}
