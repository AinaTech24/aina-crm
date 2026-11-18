"use client";

/**
 * EPF — the Provident Fund corpus at retirement from monthly employee and
 * employer contributions on a rising salary, with interest on the monthly
 * running balance credited once a year (EPFO method).
 * Math: src/lib/calculators/epf.ts.
 */

import { useMemo, useState } from "react";
import {
  EPF_DEFAULT_RATE_PCT, EPF_EMPLOYEE_PCT, EPF_EMPLOYER_SHARE_PCT, EPF_RETIREMENT_AGE, EPS_WAGE_CEILING,
  epfCalc, type EpfEmployerMode,
} from "@/lib/calculators/epf";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section, Segmented } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, SUITE_COLORS, YearTableWrap } from "./sip-suite-ui";

export function EpfCalculator() {
  const [clientName, setClientName] = useState("");
  const [age, setAge] = useState(30);
  const [retireAge, setRetireAge] = useState(EPF_RETIREMENT_AGE);
  const [wage, setWage] = useState(40000);
  const [increase, setIncrease] = useState(6);
  const [employeePct, setEmployeePct] = useState(EPF_EMPLOYEE_PCT);
  const [employerPct, setEmployerPct] = useState(EPF_EMPLOYER_SHARE_PCT);
  const [employerMode, setEmployerMode] = useState<EpfEmployerMode>("fixed_share");
  const [balance, setBalance] = useState(300000);
  const [rate, setRate] = useState(EPF_DEFAULT_RATE_PCT);

  const res = useMemo(
    () =>
      epfCalc({
        currentAge: age,
        retirementAge: retireAge,
        monthlyWage: wage,
        salaryIncreasePct: increase,
        employeePct,
        employerPct,
        employerMode,
        currentBalance: balance,
        ratePct: rate,
      }),
    [age, retireAge, wage, increase, employeePct, employerPct, employerMode, balance, rate],
  );
  const first = res.rows[0];

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">EPF Corpus at Retirement</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Current age" value={age} setValue={setAge} step={1} />
        <NumberField label="Retirement age" value={retireAge} setValue={setRetireAge} step={1} />
        <NumberField label="Monthly basic + DA (₹)" value={wage} setValue={setWage} step={1000} />
        <NumberField label="Yearly salary increase (%)" value={increase} setValue={setIncrease} step={0.5} />
        <NumberField label="Current EPF balance (₹)" value={balance} setValue={setBalance} step={10000} />
        <NumberField label="Your contribution (% of basic + DA)" value={employeePct} setValue={setEmployeePct} step={1} />
        <Segmented
          label="Employer's share to EPF"
          value={employerMode}
          onChange={setEmployerMode}
          options={[
            { value: "fixed_share", label: "A fixed %" },
            { value: "full_wage", label: "12% of full pay less pension" },
          ]}
        />
        {employerMode === "fixed_share" && (
          <NumberField label="Employer's EPF share (%)" value={employerPct} setValue={setEmployerPct} step={0.01} />
        )}
        <NumberField label="EPF interest rate (% a year)" value={rate} setValue={setRate} step={0.05} />
      </div>

      <PreparedFor name={clientName}>EPF from age {age} to {retireAge}</PreparedFor>

      {res.years <= 0 ? (
        <Insight tone="amber">Retirement age must be later than the current age.</Insight>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={`Corpus at ${retireAge}`} value={inr(res.corpus)} tone="cyan" />
            <Stat label="Your contributions" value={inr(res.totalEmployee)} />
            <Stat label="Employer's EPF share" value={inr(res.totalEmployer)} />
            <Stat label="Interest earned" value={inr(res.totalInterest)} tone="emerald" />
          </div>

          {first && (
            <Insight tone="cyan">
              In the first year {inr(first.employee / 12)} a month comes from salary and {inr(first.employer / 12)} from
              the employer. Over {res.years} years these, the {inr(balance)} already in the account and{" "}
              <strong>{inr(res.totalInterest)}</strong> of interest at {fmtPct(rate)} build a corpus of{" "}
              <strong>{inr(res.corpus)}</strong> at {retireAge}.
            </Insight>
          )}

          <Insight tone="amber">
            The employer&apos;s 12% is split: 8.33% goes to the Employees&apos; Pension Scheme (EPS), worked out on pay up
            to {inr(EPS_WAGE_CEILING)} — at most {inr(1250)} a month — and only the rest reaches EPF. The pension
            ({inr(res.totalEps)} over these years) pays a monthly pension, not part of this corpus.
            {employerMode === "full_wage" && <> With an employer paying 12% on the full salary, everything above the {inr(1250)} EPS share goes to EPF.</>}
          </Insight>

          <Section n={1} title="EPF balance year by year">
            <CalcChart
              data={res.rows.map((r) => ({ year: r.age, balance: r.closing }))}
              xKey="year"
              xUnit="Age"
              series={[{ key: "balance", name: "EPF balance", color: SUITE_COLORS[0] }]}
            />
            <YearTableWrap>
              <Table
                head={["Year", "Age", "Monthly basic + DA", "Opening balance", "Your share", "Employer's share", "Interest", "Closing balance"]}
                rows={res.rows.map((r) => [
                  `${r.year}`,
                  `${r.age}`,
                  inr(r.monthlyWage),
                  inr(r.opening),
                  inr(r.employee),
                  inr(r.employer),
                  inr(r.interest),
                  inr(r.closing),
                ])}
                highlightLastRow
              />
            </YearTableWrap>
            <p className="text-xs text-muted-foreground">
              Contributions are credited monthly; each month&apos;s interest is {fmtPct(rate)} ÷ 12 of the balance after
              that month&apos;s contribution, and the year&apos;s interest is added at the year end. Salary rises once a
              year. EPFO declares the rate each year — one rate is applied throughout.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
