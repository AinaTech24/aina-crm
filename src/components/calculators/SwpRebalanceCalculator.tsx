"use client";

/**
 * SWP Rebalance — a two-fund income plan: withdrawals come only from a debt
 * fund, a balanced-advantage fund compounds untouched, and every few years its
 * gain over the original allocation is switched into the debt fund to refill
 * it. Shows the SWP for each frequency, the total paid, the closing value and
 * the year-wise movement of both funds.
 * Math: src/lib/calculators/swp-rebalance.ts (verified to the rupee — ₹75 L ·
 * 50/50 @ 6% / 9% · 7% a year · 22y · rebalance every 5y → ₹42,406 a month).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeSwpRebalance, type RebalanceFrequency,
} from "@/lib/calculators/swp-rebalance";
import { inr, fmtPct, NumberField, Field, Segmented, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

const FREQ_NAME: Record<RebalanceFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  halfyearly: "Half-yearly",
  yearly: "Yearly",
};

export function SwpRebalanceCalculator() {
  const [clientName, setClientName] = useState("");
  const [currentAge, setCurrentAge] = useState(58);
  const [initial, setInitial] = useState(7500000);
  const [debtReturnPct, setDebtReturnPct] = useState(6);
  const [balancedReturnPct, setBalancedReturnPct] = useState(9);
  const [debtAllocPct, setDebtAllocPct] = useState(50);
  const [annualWithdrawalPct, setAnnualWithdrawalPct] = useState(7);
  const [frequency, setFrequency] = useState<RebalanceFrequency>("monthly");
  const [years, setYears] = useState(22);
  const [rebalanceYears, setRebalanceYears] = useState(5);

  const result = useMemo(
    () =>
      computeSwpRebalance({
        initial, debtAllocPct, debtReturnPct, balancedReturnPct, annualWithdrawalPct,
        frequency, years, rebalanceYears, currentAge: currentAge > 0 ? currentAge : null,
      }),
    [initial, debtAllocPct, debtReturnPct, balancedReturnPct, annualWithdrawalPct, frequency, years, rebalanceYears, currentAge]
  );

  const balancedAllocPct = Math.max(0, 100 - debtAllocPct);
  const limits: string[] = [];
  if (debtAllocPct < 50 || debtAllocPct > 100) limits.push("debt between 50% and 100% of the corpus (balanced fund at most 50%)");
  if (debtReturnPct > 8) limits.push("a debt return of at most 8%");
  if (balancedReturnPct > 10) limits.push("a balanced-fund return of at most 10%");
  if (annualWithdrawalPct > result.portfolioReturnPct) limits.push(`a withdrawal no higher than the ${fmtPct(result.portfolioReturnPct)} expected return`);
  const useAge = currentAge > 0;
  const per = FREQ_NAME[frequency].toLowerCase();

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">SWP Rebalance Calculator</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Client name (optional)">
          <ClientNameField value={clientName} onChange={setClientName} />
        </Field>
        <NumberField label="Current age (optional)" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Initial investment (₹)" value={initial} setValue={setInitial} step={100000} />
        <NumberField label="Debt fund share (%)" value={debtAllocPct} setValue={setDebtAllocPct} step={5} />
        <NumberField label="Debt fund return (%)" value={debtReturnPct} setValue={setDebtReturnPct} step={0.5} />
        <NumberField label="Balanced fund return (%)" value={balancedReturnPct} setValue={setBalancedReturnPct} step={0.5} />
        <NumberField label="Annual withdrawal (% of corpus)" value={annualWithdrawalPct} setValue={setAnnualWithdrawalPct} step={0.5} />
        <NumberField label="SWP period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="Rebalance every (yrs)" value={rebalanceYears} setValue={setRebalanceYears} step={1} />
      </div>

      <Segmented
        label="SWP frequency"
        value={frequency}
        onChange={setFrequency}
        options={(Object.keys(FREQ_NAME) as RebalanceFrequency[]).map((f) => ({
          value: f,
          label: `${FREQ_NAME[f]} · ${inr(result.swpByFrequency[f])}`,
        }))}
      />

      {limits.length > 0 && (
        <Insight tone="amber">Outside the usual limits for this plan — it expects {limits.join(", ")}.</Insight>
      )}

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-primary">{clientName}</span> · {inr(initial)} split {debtAllocPct}% debt / {balancedAllocPct}% balanced
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Expected portfolio return" value={`${result.portfolioReturnPct.toFixed(2)}%`} />
        <Stat label={`${FREQ_NAME[frequency]} SWP`} value={inr(result.perPeriodSwp)} tone="cyan" />
        <Stat label="Total withdrawal" value={inr(result.totalWithdrawal)} tone="emerald" />
        <Stat label="Closing value" value={inr(result.closingValue)} />
      </div>

      {result.debtShortfallYear != null ? (
        <Insight tone="rose">
          The debt fund cannot cover the withdrawals in year {result.debtShortfallYear} before the next rebalance — lower the
          withdrawal, raise the debt share or rebalance more often.
        </Insight>
      ) : (
        <Insight tone="cyan">
          Taking {inr(result.perPeriodSwp)} {per} ({inr(result.annualWithdrawal)} a year) from the debt fund for {years} years pays{" "}
          <strong>{inr(result.totalWithdrawal)}</strong> and still leaves <strong>{inr(result.closingValue)}</strong>, because the
          balanced fund&apos;s gains refill the debt fund every {rebalanceYears} years.
        </Insight>
      )}

      <Section n={1} title="Year-wise fund values">
        <CalcChart
          data={result.rows.map((r) => ({ x: r.age ?? r.year, debt: r.debtEnd, balanced: r.balancedEnd }))}
          xKey="x"
          xUnit={useAge ? "Age" : "Year"}
          series={[
            { key: "debt", name: "Debt fund", color: "#0ea5e9" },
            { key: "balanced", name: "Balanced fund", color: "#10b981" },
          ]}
        />
        <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
          <Table
            head={[useAge ? "Age" : "Year", "Debt — start", "Debt — end", "Balanced — start", "Balanced — end", "Withdrawn", "Total value", "Switched to debt"]}
            rows={result.rows.map((r) => [
              useAge && r.age != null ? `${r.age}` : `${r.year}`,
              inr(r.debtStart),
              inr(r.debtEnd),
              inr(r.balancedStart),
              inr(r.balancedEnd),
              inr(r.annualWithdrawal),
              inr(r.fundValue),
              r.transfer > 0 ? inr(r.transfer) : "—",
            ])}
            highlightLastRow
          />
        </div>
      </Section>

      <p className="text-2xs text-muted-foreground">
        Withdrawals are taken from the debt fund on the last day of each period; the balanced fund compounds yearly and its
        gain is switched to debt at the end of each rebalancing year. Illustration only; returns are not guaranteed.
      </p>
    </div>
  );
}
