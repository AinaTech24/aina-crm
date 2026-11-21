// Copied verbatim from src/lib/calculators/swp-rebalance.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * SWP Rebalance — math engine.
 *
 * A two-fund withdrawal plan: the corpus is split between a DEBT fund and a
 * BALANCED-ADVANTAGE fund. Every withdrawal comes out of the debt fund; the
 * balanced fund is left to compound, and every `rebalanceYears` its gain over
 * the original allocation is switched into the debt fund, which refills it.
 *
 * CONVENTION — each fund has its own timing, stated because it differs from
 * the rest of the suite:
 *   Withdrawal : W = initial × ((1 + w)^(1/f) − 1) per period, where w is the
 *                annual withdrawal % and f the periods a year — the EFFECTIVE
 *                per-period equivalent on the INITIAL corpus, level for the
 *                whole term (not w/f).
 *   Debt fund  : effective per-period rate (1+d)^(1/f) − 1; each period it grows,
 *                then W is taken at the period END.
 *   Balanced   : compounds ANNUALLY at its own return; never withdrawn from.
 *   Rebalance  : at the end of every year that is a multiple of the rebalance
 *                period, after that year's growth, (balanced − its original
 *                amount) moves to debt and the balanced fund resets.
 *
 * Reference case reproduced to the rupee (tests/ms-calc-c.test.ts): ₹75 L at
 * 58 · 50% debt @ 6% · 50% balanced @ 9% · 7% a year withdrawn monthly · 22y ·
 * rebalance every 5y → monthly SWP ₹42,406, total ₹1,11,95,208, closing
 * ₹1,00,96,496, transfer ₹20,19,840 at ages 63/68/73/78.
 * Quarterly / half-yearly / yearly frequencies use the same rule per period;
 * the reference case only exercised monthly.
 */

export type RebalanceFrequency = "monthly" | "quarterly" | "halfyearly" | "yearly";

export const REBAL_PER_YEAR: Record<RebalanceFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  halfyearly: 2,
  yearly: 1,
};

export type SwpRebalanceInput = {
  initial: number;
  /** Share of the corpus in the debt fund (%); the rest is in the balanced fund. */
  debtAllocPct: number;
  debtReturnPct: number;
  balancedReturnPct: number;
  /** Annual withdrawal as % of the initial corpus. */
  annualWithdrawalPct: number;
  frequency: RebalanceFrequency;
  years: number;
  rebalanceYears: number;
  currentAge: number | null;
};

export type SwpRebalanceRow = {
  year: number;
  age: number | null;
  debtStart: number;
  debtEnd: number;
  balancedStart: number;
  balancedEnd: number;
  annualWithdrawal: number;
  fundValue: number;
  transfer: number;
};

export type SwpRebalanceResult = {
  portfolioReturnPct: number;
  perPeriodSwp: number;
  /** Withdrawal per period for each frequency, for display. */
  swpByFrequency: Record<RebalanceFrequency, number>;
  annualWithdrawal: number;
  totalWithdrawal: number;
  closingValue: number;
  /** First year in which the debt fund could not pay a withdrawal, or null. */
  debtShortfallYear: number | null;
  rows: SwpRebalanceRow[];
};

/** Allocation-weighted expected return of the two funds. */
export function portfolioReturn(debtAllocPct: number, debtReturnPct: number, balancedReturnPct: number): number {
  const d = Math.min(100, Math.max(0, debtAllocPct));
  return (d * debtReturnPct + (100 - d) * balancedReturnPct) / 100;
}

/** Per-period withdrawal: the effective per-period equivalent of the annual %. */
export function rebalanceSwpAmount(initial: number, annualWithdrawalPct: number, perYear: number): number {
  return initial * (Math.pow(1 + annualWithdrawalPct / 100, 1 / perYear) - 1);
}

export function computeSwpRebalance(input: SwpRebalanceInput): SwpRebalanceResult {
  const f = REBAL_PER_YEAR[input.frequency];
  const years = Math.max(0, Math.round(input.years));
  const rebalance = Math.max(0, Math.round(input.rebalanceYears));
  const initial = Math.max(0, input.initial);
  const debtShare = Math.min(100, Math.max(0, input.debtAllocPct)) / 100;
  const balancedInitial = initial * (1 - debtShare);
  const pd = Math.pow(1 + input.debtReturnPct / 100, 1 / f) - 1;
  const W = rebalanceSwpAmount(initial, input.annualWithdrawalPct, f);

  const swpByFrequency = {
    monthly: rebalanceSwpAmount(initial, input.annualWithdrawalPct, 12),
    quarterly: rebalanceSwpAmount(initial, input.annualWithdrawalPct, 4),
    halfyearly: rebalanceSwpAmount(initial, input.annualWithdrawalPct, 2),
    yearly: rebalanceSwpAmount(initial, input.annualWithdrawalPct, 1),
  };

  let debt = initial * debtShare;
  let balanced = balancedInitial;
  let debtShortfallYear: number | null = null;
  const rows: SwpRebalanceRow[] = [];

  for (let y = 1; y <= years; y++) {
    const debtStart = debt;
    const balancedStart = balanced;
    for (let p = 0; p < f; p++) {
      debt = debt * (1 + pd) - W;
      if (debt < 0 && debtShortfallYear === null) debtShortfallYear = y;
    }
    balanced *= 1 + input.balancedReturnPct / 100;
    let transfer = 0;
    if (rebalance > 0 && y % rebalance === 0) {
      transfer = Math.max(0, balanced - balancedInitial);
      balanced -= transfer;
      debt += transfer;
    }
    rows.push({
      year: y,
      age: input.currentAge != null ? input.currentAge + y : null,
      debtStart,
      debtEnd: debt,
      balancedStart,
      balancedEnd: balanced,
      annualWithdrawal: W * f,
      fundValue: debt + balanced,
      transfer,
    });
  }

  return {
    portfolioReturnPct: portfolioReturn(input.debtAllocPct, input.debtReturnPct, input.balancedReturnPct),
    perPeriodSwp: W,
    swpByFrequency,
    annualWithdrawal: W * f,
    totalWithdrawal: W * f * years,
    closingValue: rows.length ? rows[rows.length - 1].fundValue : initial,
    debtShortfallYear,
    rows,
  };
}
