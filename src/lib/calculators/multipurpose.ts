/**
 * Cashflow & Corpus Planner — math engine (renamed "Multipurpose Calculator").
 *
 * Combines an accumulation choice (Lumpsum / SIP / Step-up SIP) with two
 * withdrawal lenses:
 *   • Periodic     — year-by-year fund-value projection, no withdrawals.
 *   • Monthly SWP  — the maximum sustainable monthly withdrawal (or a custom
 *                    one) starting at various ages, lasting till the report age.
 *
 * Convention: EFFECTIVE monthly rate ((1+annual)^(1/12)−1). Accumulation SIPs
 * are begin-mode (annuity-due, via the SIP 360° engine). SWP withdrawals are
 * end-of-month (ordinary annuity) — this reproduces the reference Multipurpose
 * Calculator to the rupee (₹1cr @ 12%, age 40→90: ₹289cr fund value; max SWP
 * ₹95,217/mo immediate, ₹1,68,250/mo deferred 5y).
 *
 * Display rules the reference report uses (and this engine reproduces):
 *   • the maximum SWP is TRUNCATED to the rupee (`maxSwpShown` = floor), not
 *     rounded — ₹1,68,250.95 prints as ₹1,68,250;
 *   • SWP start ages run now, +5, +10, … while at least 5 years of
 *     withdrawals remain before the report age;
 *   • the fund-value table is age +1 then every 5 years to the report age
 *     ("Periodic"), or every 5 years from +5 when shown beside the SWP table;
 *     a report age off the 5-year grid gets its own last row.
 */

import { monthlyRate, fvSip, fvLumpsum, fvStepUpSip, stepUpInvested } from "./sip360";

export type CalcType = "lumpsum" | "sip" | "stepup";
export type WithdrawalOption = "periodic" | "swp" | "both";
export type ReportType = "fund_value" | "custom_withdrawal";

export type MultiInput = {
  currentAge: number;
  reportTillAge: number;
  ratePct: number;
  calcType: CalcType;
  /** Lumpsum one-time amount OR monthly SIP amount, depending on calcType. */
  amount: number;
  stepUpPct?: number; // step-up SIP only
  withdrawal: WithdrawalOption;
  reportType: ReportType;
  customMonthly?: number; // custom-withdrawal report only
};

/** Corpus accumulated `years` from now, per the chosen accumulation type. */
export function corpusAfter(input: MultiInput, years: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (input.calcType === "lumpsum") return fvLumpsum(input.amount, input.ratePct, months);
  if (input.calcType === "sip") return fvSip(input.amount, input.ratePct, months);
  return fvStepUpSip(input.amount, input.stepUpPct ?? 0, input.ratePct, Math.max(0, Math.round(years)));
}

/** Total amount actually invested `years` from now. */
export function investedAfter(input: MultiInput, years: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (input.calcType === "lumpsum") return years >= 0 ? input.amount : 0;
  if (input.calcType === "sip") return input.amount * months;
  return stepUpInvested(input.amount, input.stepUpPct ?? 0, Math.max(0, Math.round(years)));
}

/**
 * Maximum sustainable level monthly withdrawal that depletes `corpus` to ~0
 * over `months`, end-of-month withdrawals, effective monthly rate.
 */
export function maxMonthlySwp(corpus: number, ratePct: number, months: number): number {
  if (corpus <= 0 || months <= 0) return 0;
  const m = monthlyRate(ratePct);
  if (m === 0) return corpus / months;
  return (corpus * m) / (1 - Math.pow(1 + m, -months));
}

/** Simulate a fixed monthly withdrawal (grow-then-withdraw at month end). */
export function simulateWithdrawal(
  corpus: number,
  ratePct: number,
  monthly: number,
  months: number
): { endBalance: number; depletedAtMonth: number | null; totalWithdrawn: number } {
  const m = monthlyRate(ratePct);
  let bal = corpus;
  let withdrawn = 0;
  let depletedAtMonth: number | null = null;
  for (let i = 0; i < months; i++) {
    bal = bal * (1 + m);
    if (bal < monthly) {
      withdrawn += bal;
      bal = 0;
      depletedAtMonth = i + 1;
      break;
    }
    bal -= monthly;
    withdrawn += monthly;
  }
  return { endBalance: Math.max(0, bal), depletedAtMonth, totalWithdrawn: withdrawn };
}

/* ───────────────────────── Aggregate ───────────────────────── */

export type FundRow = { age: number; years: number; invested: number; fundValue: number };
export type SwpRow = {
  startAge: number;
  deferYears: number;
  corpus: number;
  /** Unrounded maximum level monthly SWP. */
  maxSwp: number;
  /** The figure to print: truncated to the rupee, as the reference report does. */
  maxSwpShown: number;
  totalWithdrawn: number;
};
export type CustomRow = {
  startAge: number;
  deferYears: number;
  corpus: number;
  monthly: number;
  sustained: boolean;
  lastsTillAge: number | null; // age the corpus runs out (null = sustains)
  endBalance: number;
};

export type MultiResult = {
  totalYears: number;
  finalFundValue: number;
  finalInvested: number;
  fundProjection: FundRow[] | null;
  swpTable: SwpRow[] | null;
  customTable: CustomRow[] | null;
};

/**
 * Year offsets for the fund-value table: 1, 5, 10, … (Periodic alone) or
 * 5, 10, … (beside the SWP table), always ending on the report age.
 */
export function milestoneOffsets(totalYears: number, withSwp: boolean): number[] {
  const out: number[] = [];
  if (totalYears <= 0) return out;
  if (!withSwp) out.push(1);
  for (let y = 5; y <= totalYears; y += 5) out.push(y);
  if (out.length === 0 || out[out.length - 1] !== totalYears) out.push(totalYears);
  return out;
}

/** SWP start offsets: 0, 5, 10, … while the start age ≤ report age − 5. */
export function swpStartOffsets(currentAge: number, reportTillAge: number): number[] {
  const out: number[] = [];
  for (let d = 0; currentAge + d <= reportTillAge - 5; d += 5) out.push(d);
  return out;
}

export function computeMultipurpose(input: MultiInput): MultiResult {
  const totalYears = Math.max(0, Math.round(input.reportTillAge - input.currentAge));
  const showFund = input.withdrawal === "periodic" || input.withdrawal === "both";
  const showSwp = input.withdrawal === "swp" || input.withdrawal === "both";

  const finalFundValue = corpusAfter(input, totalYears);
  const finalInvested = investedAfter(input, totalYears);

  let fundProjection: FundRow[] | null = null;
  if (showFund && totalYears > 0) {
    fundProjection = milestoneOffsets(totalYears, showSwp).map((y) => ({
      age: input.currentAge + y,
      years: y,
      invested: investedAfter(input, y),
      fundValue: corpusAfter(input, y),
    }));
  }

  // Withdrawal start ages: now, +5, +10, … up to the report age − 5.
  const deferrals = swpStartOffsets(input.currentAge, input.reportTillAge);

  let swpTable: SwpRow[] | null = null;
  let customTable: CustomRow[] | null = null;

  if (showSwp && deferrals.length) {
    if (input.reportType === "custom_withdrawal") {
      const monthly = Math.max(0, input.customMonthly ?? 0);
      customTable = deferrals.map((d) => {
        const startAge = input.currentAge + d;
        const corpus = corpusAfter(input, d);
        const months = (input.reportTillAge - startAge) * 12;
        const sim = simulateWithdrawal(corpus, input.ratePct, monthly, months);
        const sustained = sim.depletedAtMonth === null;
        return {
          startAge,
          deferYears: d,
          corpus,
          monthly,
          sustained,
          lastsTillAge: sustained ? null : startAge + Math.floor((sim.depletedAtMonth ?? 0) / 12),
          endBalance: sim.endBalance,
        };
      });
    } else {
      swpTable = deferrals.map((d) => {
        const startAge = input.currentAge + d;
        const corpus = corpusAfter(input, d);
        const months = (input.reportTillAge - startAge) * 12;
        const maxSwp = maxMonthlySwp(corpus, input.ratePct, months);
        return { startAge, deferYears: d, corpus, maxSwp, maxSwpShown: Math.floor(maxSwp), totalWithdrawn: maxSwp * months };
      });
    }
  }

  return { totalYears, finalFundValue, finalInvested, fundProjection, swpTable, customTable };
}
