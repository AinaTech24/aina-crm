"use client";

/**
 * SIP–SWP Ready Reckoner — build a corpus with a yearly top-up SIP, a
 * salary-linked SIP (a share of a rising salary), a lumpsum or both; let it
 * grow through any waiting years; then draw a month-end SWP that rises every
 * month with inflation and leaves a chosen balance. Solves either the monthly
 * SWP the plan supports or the investment a target SWP needs, and shows the
 * largest balance the plan could leave ("Max").
 * Math: src/lib/calculators/income-bridge.ts (verified to the rupee — salary
 * ₹1,00,000 · 25% · +8%/yr · 35→50, held to 60 @12%; SWP to 80 @8%, 5%
 * inflation, leave ₹1 cr → corpus ₹5,70,32,643, first-month SWP ₹3,00,712).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeIncomeBridge, type CalcType, type InvestMode, type PlanningType,
} from "@/lib/calculators/income-bridge";
import { inr, fmtPct, NumberField, Field, Segmented, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

export function SipSwpReckoner() {
  const [clientName, setClientName] = useState("");
  const [calcType, setCalcType] = useState<CalcType>("monthly_swp");
  const [investMode, setInvestMode] = useState<InvestMode>("salary");
  const [planningType, setPlanningType] = useState<PlanningType>("retirement");

  const [startAge, setStartAge] = useState(35);
  const [sipTillAge, setSipTillAge] = useState(50);
  const [retirementAge, setRetirementAge] = useState(60);
  const [monthlySip, setMonthlySip] = useState(25000);
  const [topUpPct, setTopUpPct] = useState(5);
  const [lumpsum, setLumpsum] = useState(1000000);
  const [monthlySalary, setMonthlySalary] = useState(100000);
  const [savingsPct, setSavingsPct] = useState(25);
  const [salaryGrowthPct, setSalaryGrowthPct] = useState(8);
  const [accumReturnPct, setAccumReturnPct] = useState(12);

  const [swpTillAge, setSwpTillAge] = useState(80);
  const [distReturnPct, setDistReturnPct] = useState(8);
  const [distInflationPct, setDistInflationPct] = useState(5);
  const [endBalance, setEndBalance] = useState(10000000);
  const [desiredMonthlySwp, setDesiredMonthlySwp] = useState(300000);

  const isSalary = investMode === "salary";
  const usesSip = investMode === "sip" || investMode === "lumpsum_sip" || isSalary;
  const usesLump = investMode === "lumpsum" || investMode === "lumpsum_sip";
  const isReverse = calcType === "investment_need";
  const startLabel = planningType === "retirement" ? "Retirement age (SWP starts)" : "SWP start age";

  const result = useMemo(
    () =>
      computeIncomeBridge({
        calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge,
        monthlySip, topUpPct, lumpsum, monthlySalary, savingsPct, salaryGrowthPct, accumReturnPct,
        distReturnPct, distInflationPct, endBalance, desiredMonthlySwp,
      }),
    [calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge, monthlySip, topUpPct, lumpsum,
      monthlySalary, savingsPct, salaryGrowthPct, accumReturnPct, distReturnPct, distInflationPct, endBalance, desiredMonthlySwp]
  );

  const ageProblems: string[] = [];
  if (usesSip && sipTillAge <= startAge) ageProblems.push("the SIP must end after the start age");
  if (usesSip && retirementAge < sipTillAge) ageProblems.push("withdrawals cannot start before the SIP ends");
  if (swpTillAge <= retirementAge) ageProblems.push("the SWP must end after it starts");
  const waitYears = usesSip ? Math.max(0, retirementAge - sipTillAge) : Math.max(0, retirementAge - startAge);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">SIP–SWP Ready Reckoner</h2>
      </div>

      <div className="flex flex-wrap gap-4">
        <Segmented
          label="Solve for"
          value={calcType}
          onChange={setCalcType}
          options={[
            { value: "monthly_swp", label: "Monthly SWP" },
            { value: "investment_need", label: "Investment needed" },
          ]}
        />
        <Segmented
          label="Invest through"
          value={investMode}
          onChange={setInvestMode}
          options={[
            { value: "sip", label: "SIP" },
            { value: "lumpsum", label: "Lumpsum" },
            { value: "lumpsum_sip", label: "Lumpsum + SIP" },
            { value: "salary", label: "Salary-linked SIP" },
          ]}
        />
        <Segmented
          label="Plan"
          value={planningType}
          onChange={setPlanningType}
          options={[
            { value: "retirement", label: "Retirement" },
            { value: "invest_now_withdraw_later", label: "SIP now, SWP later" },
          ]}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/70 p-4 space-y-3">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Building the corpus</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client name (optional)">
              <ClientNameField value={clientName} onChange={setClientName} />
            </Field>
            <NumberField label="Investment start age" value={startAge} setValue={setStartAge} step={1} />
            {isSalary && (
              <>
                <NumberField label="Monthly salary (₹)" value={monthlySalary} setValue={setMonthlySalary} step={5000} />
                {!isReverse && <NumberField label="SIP as % of salary" value={savingsPct} setValue={setSavingsPct} step={1} />}
                <NumberField label="Salary rise per year (%)" value={salaryGrowthPct} setValue={setSalaryGrowthPct} step={0.5} />
              </>
            )}
            {(investMode === "sip" || investMode === "lumpsum_sip") && (
              <>
                {!isReverse && <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />}
                <NumberField label="SIP top-up every year (%)" value={topUpPct} setValue={setTopUpPct} step={1} />
              </>
            )}
            {usesLump && (investMode === "lumpsum_sip" || !isReverse) && (
              <NumberField label="Lumpsum today (₹)" value={lumpsum} setValue={setLumpsum} step={100000} />
            )}
            {usesSip && <NumberField label="SIP till age" value={sipTillAge} setValue={setSipTillAge} step={1} />}
            <NumberField label={startLabel} value={retirementAge} setValue={setRetirementAge} step={1} />
            <NumberField label="Return while building (%)" value={accumReturnPct} setValue={setAccumReturnPct} step={0.5} />
          </div>
        </div>

        <div className="rounded-lg border border-border/70 p-4 space-y-3">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Drawing the income</div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="SWP till age" value={swpTillAge} setValue={setSwpTillAge} step={1} />
            <NumberField label="Return while withdrawing (%)" value={distReturnPct} setValue={setDistReturnPct} step={0.5} />
            <NumberField label="Inflation while withdrawing (%)" value={distInflationPct} setValue={setDistInflationPct} step={0.5} />
            {isReverse && (
              <NumberField label="Monthly SWP wanted (₹, first month)" value={desiredMonthlySwp} setValue={setDesiredMonthlySwp} step={5000} />
            )}
            <div className="col-span-2">
              <NumberField label="Balance to leave at the end (₹)" value={endBalance} setValue={setEndBalance} step={100000} />
              {!isReverse && (
                <p className="text-2xs text-muted-foreground mt-1">
                  Max {inr(result.maxEndBalance)} — what the corpus grows to if nothing is withdrawn.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {ageProblems.length > 0 && <Insight tone="rose">Check the ages: {ageProblems.join("; ")}.</Insight>}
      {result.warning && <Insight tone="rose">{result.warning}</Insight>}

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-primary">{clientName}</span> · income from age {retirementAge} to {swpTillAge}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label={isReverse ? "Corpus needed at SWP start" : "Total accumulated"} value={inr(result.corpus)} tone="amber" />
        {isReverse ? (
          investMode === "lumpsum" ? (
            <Stat label="Lumpsum needed today" value={inr(result.requiredLumpsum ?? NaN)} tone="cyan" />
          ) : (
            <>
              <Stat
                label={isSalary ? "Monthly SIP needed (first year)" : "Monthly SIP needed"}
                value={inr(result.requiredMonthlySip ?? NaN)}
                tone="cyan"
              />
              <Stat
                label={investMode === "lumpsum_sip" ? "Or extra lumpsum today, no SIP" : "Or one-time lumpsum today"}
                value={inr(result.lumpsumInsteadOfSip ?? NaN)}
              />
            </>
          )
        ) : (
          <Stat label={distInflationPct > 0 ? "Monthly SWP (first month)" : "Monthly SWP"} value={inr(result.monthlySwp)} tone="cyan" />
        )}
        {isReverse && isSalary && result.requiredSavingsPct != null && (
          <Stat label="SIP as % of salary needed" value={`${result.requiredSavingsPct.toFixed(1)}%`} />
        )}
        <Stat label="Total investment" value={inr(result.totalInvested)} />
        <Stat label="Total withdrawal" value={inr(result.totalWithdrawn)} tone="emerald" />
        <Stat label="Balance at the end" value={inr(result.endBalanceActual)} />
      </div>

      <Insight tone="cyan">
        {isSalary ? `${fmtPct(isReverse ? result.requiredSavingsPct ?? 0 : savingsPct)} of a ${inr(monthlySalary)} salary rising ${fmtPct(salaryGrowthPct)} a year` : "The plan"}
        {" "}builds <strong>{inr(result.corpus)}</strong> by age {retirementAge}
        {waitYears > 0 ? ` (including ${waitYears} years of waiting with no new money)` : ""}. That pays{" "}
        <strong>{inr(result.monthlySwp)}</strong> in the first month
        {distInflationPct > 0 ? `, rising every month to ${inr(result.lastMonthlySwp)}` : ""}, until age {swpTillAge}, and leaves{" "}
        {inr(result.endBalanceActual)}.
        {isReverse && investMode !== "lumpsum" && (
          <>
            {" "}Instead of the {inr(result.requiredMonthlySip ?? NaN)}/month {isSalary ? "salary-linked SIP" : "SIP"},{" "}
            {investMode === "lumpsum_sip" ? <>one more lumpsum of</> : <>a one-time lumpsum of</>}{" "}
            <strong>{inr(result.lumpsumInsteadOfSip ?? NaN)}</strong> invested today at {fmtPct(accumReturnPct)} builds the same corpus.
          </>
        )}
      </Insight>

      {result.accSchedule.length > 0 && (
        <Section n={1} title="Building the corpus — year by year">
          <CalcChart
            data={[...result.accSchedule.map((r) => ({ age: r.age, value: r.value })), ...result.schedule.map((r) => ({ age: r.age, value: r.endCorpus }))]}
            xKey="age"
            xUnit="Age"
            series={[{ key: "value", name: "Corpus", color: "#0ea5e9" }]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Age", "Invested that year", "Year-end value"]}
              rows={result.accSchedule.map((r) => [`${r.age}`, r.invested > 0 ? inr(r.invested) : "—", inr(r.value)])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      {result.schedule.length > 0 && (
        <Section n={2} title="Drawing the income — year by year">
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Age", "Monthly SWP (first month)", "Monthly SWP (average)", "Withdrawn that year", "Year-end balance"]}
              rows={result.schedule.map((r) => [
                `${r.age}`,
                inr(r.monthlyWithdrawalThatYear),
                inr(r.avgMonthlyWithdrawal),
                inr(r.withdrawnThisYear),
                inr(r.endCorpus),
              ])}
              highlightLastRow
            />
          </div>
        </Section>
      )}

      <p className="text-2xs text-muted-foreground">
        SIP paid at the start of each month and raised once a year; withdrawals taken on the last day of each month and
        raised every month with inflation · effective monthly rates. Illustration only; returns are not guaranteed.
      </p>
    </div>
  );
}
