"use client";

/**
 * Loan EMI — home, personal, car and education loans on the standard
 * reducing-balance formula, with the interest / principal split, a yearly and
 * a monthly amortisation schedule and an optional part-prepayment.
 * Math: src/lib/calculators/loan-emi.ts (₹10,00,000 at 10% for 20 years →
 * EMI ₹9,650).
 */

import { useMemo, useState } from "react";
import { LOAN_PRESETS, loanEmi, type LoanType, type PrepayMode } from "@/lib/calculators/loan-emi";
import { CHART_SERIES } from "@/lib/dashboard/chart-palette";
import { inr, fmtPct, NumberField, Stat, Table, Insight, Section, Segmented, Toggle } from "./ui";
import { CalcChart } from "./CalcChart";
import { ClientField, PreparedFor, YearTableWrap } from "./sip-suite-ui";

const PRINCIPAL_COLOR = CHART_SERIES[1];
const INTEREST_COLOR = CHART_SERIES[3];

/** One bar split into principal and interest, with a legend underneath. */
function SplitBar({ principal, interest }: { principal: number; interest: number }) {
  const total = principal + interest;
  if (total <= 0) return null;
  const pShare = (principal / total) * 100;
  return (
    <div className="space-y-1.5">
      <div
        className="flex h-4 w-full overflow-hidden rounded-md bg-secondary"
        role="img"
        aria-label={`Principal ${pShare.toFixed(0)}%, interest ${(100 - pShare).toFixed(0)}%`}
      >
        <div style={{ width: `${pShare}%`, background: PRINCIPAL_COLOR }} />
        <div style={{ width: `${100 - pShare}%`, background: INTEREST_COLOR }} />
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: PRINCIPAL_COLOR }} />
          Principal {inr(principal)} ({pShare.toFixed(1)}%)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: INTEREST_COLOR }} />
          Interest {inr(interest)} ({(100 - pShare).toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

function tenureText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 ? `${y} yr${y === 1 ? "" : "s"}` : "", m > 0 ? `${m} mo` : ""].filter(Boolean).join(" ") || "0 mo";
}

export function LoanEmiCalculator() {
  const [clientName, setClientName] = useState("");
  const [loanType, setLoanType] = useState<LoanType>("home");
  const [amount, setAmount] = useState(LOAN_PRESETS.home.amount);
  const [rate, setRate] = useState(LOAN_PRESETS.home.ratePct);
  const [years, setYears] = useState(LOAN_PRESETS.home.years);
  const [months, setMonths] = useState(LOAN_PRESETS.home.months);
  const [moratorium, setMoratorium] = useState(LOAN_PRESETS.education.moratoriumMonths);
  const [usePrepay, setUsePrepay] = useState(false);
  const [prepayAmt, setPrepayAmt] = useState(500000);
  const [prepayMonth, setPrepayMonth] = useState(24);
  const [prepayMode, setPrepayMode] = useState<PrepayMode>("reduce_tenure");
  const [schedule, setSchedule] = useState<"yearly" | "monthly">("yearly");

  function applyPreset(t: LoanType) {
    const p = LOAN_PRESETS[t];
    setLoanType(t);
    setAmount(p.amount);
    setRate(p.ratePct);
    setYears(p.years);
    setMonths(p.months);
    setMoratorium(p.moratoriumMonths);
    setPrepayAmt(Math.round(p.amount / 10));
  }

  const isEdu = loanType === "education";
  const res = useMemo(
    () =>
      loanEmi({
        amount,
        annualRatePct: rate,
        years,
        months,
        moratoriumMonths: isEdu ? moratorium : 0,
        prepayment: usePrepay ? { amount: prepayAmt, month: prepayMonth, mode: prepayMode } : null,
      }),
    [amount, rate, years, months, isEdu, moratorium, usePrepay, prepayAmt, prepayMonth, prepayMode],
  );
  const s = res.schedule;
  const prepayOutOfRange = usePrepay && prepayAmt > 0 && (prepayMonth < 1 || prepayMonth > res.tenureMonths);

  return (
    <div className="card-surface p-5 space-y-5">
      <h2 className="text-base font-semibold">Loan EMI</h2>

      <Segmented
        label="Loan type"
        value={loanType}
        onChange={applyPreset}
        options={(Object.keys(LOAN_PRESETS) as LoanType[]).map((t) => ({ value: t, label: LOAN_PRESETS[t].label }))}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ClientField value={clientName} onChange={setClientName} />
        <NumberField label="Loan amount (₹)" value={amount} setValue={setAmount} step={50000} />
        <NumberField label="Interest rate (% a year)" value={rate} setValue={setRate} step={0.05} />
        <NumberField label="Tenure (years)" value={years} setValue={setYears} step={1} />
        <NumberField label="Tenure (months)" value={months} setValue={(v) => setMonths(Math.min(11, Math.round(v)))} step={1} />
        {isEdu && <NumberField label="Moratorium (months)" value={moratorium} setValue={(v) => setMoratorium(Math.round(v))} step={6} />}
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <Toggle checked={usePrepay} onChange={setUsePrepay} label="Add a part-prepayment" />
        {usePrepay && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <NumberField label="Prepayment (₹)" value={prepayAmt} setValue={setPrepayAmt} step={25000} />
            <NumberField label="Paid with EMI number" value={prepayMonth} setValue={(v) => setPrepayMonth(Math.round(v))} step={1} />
            <Segmented
              label="After the prepayment"
              value={prepayMode}
              onChange={setPrepayMode}
              options={[
                { value: "reduce_tenure", label: "Keep EMI, shorter loan" },
                { value: "reduce_emi", label: "Keep tenure, lower EMI" },
              ]}
            />
          </div>
        )}
        {prepayOutOfRange && (
          <Insight tone="amber">The prepayment must be paid with an EMI between 1 and {res.tenureMonths}.</Insight>
        )}
      </div>

      <PreparedFor name={clientName}>{LOAN_PRESETS[loanType].label} of {inr(amount)}</PreparedFor>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Monthly EMI" value={inr(res.emi)} tone="cyan" />
        <Stat label="Total interest" value={inr(res.totalInterest)} tone="amber" />
        <Stat label="Total payment" value={inr(res.totalPayment)} />
        <Stat label="Repayment period" value={tenureText(res.tenureMonths)} />
        {res.moratoriumInterest > 0 && (
          <>
            <Stat label="Interest during moratorium" value={inr(res.moratoriumInterest)} />
            <Stat label="Owed when EMIs start" value={inr(res.repayPrincipal)} />
          </>
        )}
        {res.prepay && (
          <>
            <Stat label="Interest saved" value={inr(res.prepay.interestSaved)} tone="emerald" />
            {res.prepay.mode === "reduce_tenure" ? (
              <Stat label="Loan ends sooner by" value={tenureText(res.prepay.monthsSaved)} tone="emerald" />
            ) : (
              <Stat label="New EMI" value={res.prepay.newEmi > 0 ? inr(res.prepay.newEmi) : "Loan closed"} tone="emerald" />
            )}
          </>
        )}
      </div>

      {res.tenureMonths > 0 && amount > 0 && (
        <Insight tone="cyan">
          An EMI of <strong>{inr(res.emi)}</strong> for {tenureText(res.tenureMonths)} at {fmtPct(rate)} repays{" "}
          {inr(res.repayPrincipal)} with <strong>{inr(res.totalInterest)}</strong> of interest
          {res.moratoriumInterest > 0 && <> (including {inr(res.moratoriumInterest)} of simple interest over the {moratorium}-month moratorium, added to the loan when EMIs start)</>}
          {" "}— every ₹1 borrowed costs ₹{(res.totalPayment / amount).toFixed(2)} in all.
          {res.prepay && res.prepay.interestSaved > 0 && (
            <> Prepaying {inr(res.prepay.amount)} with EMI {res.prepay.month} saves <strong>{inr(res.prepay.interestSaved)}</strong> of interest
              {res.prepay.mode === "reduce_tenure"
                ? <> and closes the loan {tenureText(res.prepay.monthsSaved)} early.</>
                : res.prepay.newEmi > 0 ? <> and lowers the EMI to {inr(res.prepay.newEmi)}.</> : <> and closes the loan.</>}
            </>
          )}
        </Insight>
      )}

      {s.months > 0 && (
        <>
          <Section n={1} title="Where the money goes">
            <SplitBar principal={res.amount} interest={res.totalInterest} />
            <CalcChart
              data={s.yearly.map((y) => ({ year: y.year, principal: y.principal + y.prepayment, interest: y.interest }))}
              xKey="year"
              series={[
                { key: "principal", name: "Principal repaid", color: PRINCIPAL_COLOR },
                { key: "interest", name: "Interest paid", color: INTEREST_COLOR },
              ]}
            />
          </Section>

          <Section n={2} title="Amortisation schedule">
            <Segmented
              value={schedule}
              onChange={setSchedule}
              options={[
                { value: "yearly", label: "Year by year" },
                { value: "monthly", label: "Month by month" },
              ]}
            />
            <YearTableWrap>
              {schedule === "yearly" ? (
                <Table
                  head={["Year", "Opening balance", "EMIs paid", "Interest", "Principal", ...(res.prepay ? ["Prepayment"] : []), "Closing balance"]}
                  rows={s.yearly.map((y) => [
                    `${y.year}`,
                    inr(y.opening),
                    inr(y.emiPaid),
                    inr(y.interest),
                    inr(y.principal),
                    ...(res.prepay ? [y.prepayment > 0 ? inr(y.prepayment) : "—"] : []),
                    inr(y.closing),
                  ])}
                />
              ) : (
                <Table
                  head={["EMI no.", "Opening balance", "EMI", "Interest", "Principal", ...(res.prepay ? ["Prepayment"] : []), "Closing balance"]}
                  rows={s.monthly.map((m) => [
                    `${m.month}`,
                    inr(m.opening),
                    inr(m.emi),
                    inr(m.interest),
                    inr(m.principal),
                    ...(res.prepay ? [m.prepayment > 0 ? inr(m.prepayment) : "—"] : []),
                    inr(m.closing),
                  ])}
                />
              )}
            </YearTableWrap>
            <p className="text-xs text-muted-foreground">
              Reducing-balance method: each month&apos;s interest is the balance × {fmtPct(rate)} ÷ 12. Year 1 is the
              first 12 EMIs. Lenders round each EMI to the rupee, so their statements can differ by a few rupees.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
