/**
 * Life-insurance persistency, as pure functions.
 *
 * Persistency at month N is the share of a cohort of policies that paid the
 * premium due in their Nth month. IRDAI reports it at the 13th, 25th, 37th,
 * 49th and 61st month, by policy count and by premium, on rolling
 * twelve-month issue cohorts: measured at 30 June 2025, 13th-month
 * persistency covers policies issued 1 July 2023 – 30 June 2024 (insurer
 * public disclosures, e.g. Kotak Life FY26 Q1). The general rule used here:
 *
 *   cohort for month N at `asOf`  =  policies issued in the twelve months
 *                                   ending (N − 1) months before `asOf`
 *
 * so every policy in it has reached its Nth-month premium by `asOf`.
 * Confirm the boundaries against the IRDAI circular before quoting the
 * figure externally.
 *
 * A policy counts as persisting to month N when it has not lapsed, or lapsed
 * only after its Nth-month premium fell due (issue + N − 1 months). Single-
 * premium policies have no later premiums and are left out by the caller.
 *
 * Plain module: no DB, no React. Dates are compared as calendar days (UTC).
 */

export const PERSISTENCY_MONTHS = [13, 25, 37, 49, 61] as const;
export type PersistencyMonth = (typeof PERSISTENCY_MONTHS)[number];

const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** `d` moved by `months` calendar months, clamped to the month's last day. */
export function addMonths(d: Date, months: number): Date {
  const base = day(d);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return target;
}

/** Inclusive issue-date window of the month-N cohort measured at `asOf`. */
export function persistencyWindow(asOf: Date, month: PersistencyMonth): { from: Date; to: Date } {
  const to = addMonths(day(asOf), -(month - 1));
  const from = addMonths(to, -12);
  from.setUTCDate(from.getUTCDate() + 1);
  return { from, to };
}

export type PersistencyPolicy = {
  issuedOn: Date;
  /** Annualised premium, for the premium-weighted ratio. */
  annualPremium: number;
  /** When the policy lapsed / was surrendered; null if it never did. */
  lapsedOn: Date | null;
  /** Lapsed, but no date is recorded — cannot be placed; reported separately. */
  lapseUndated?: boolean;
};

export type PersistencyResult = {
  month: PersistencyMonth;
  window: { from: Date; to: Date };
  cohortCount: number;
  cohortPremium: number;
  persistedCount: number;
  persistedPremium: number;
  /** Lapsed with no date: left out of both sides of the ratio, and disclosed. */
  undated: number;
  /** % by count / by premium; null when the cohort is too small or too uncertain. */
  byCount: number | null;
  byPremium: number | null;
};

/** Below this many dated policies the ratio says more about luck than service. */
export const MIN_COHORT = 10;
/** Share of undated lapses above which the figure is not shown. */
export const MAX_UNDATED_SHARE = 0.1;

export function persistency(asOf: Date, month: PersistencyMonth, policies: readonly PersistencyPolicy[]): PersistencyResult {
  const window = persistencyWindow(asOf, month);
  const inCohort = policies.filter((p) => {
    const d = day(p.issuedOn).getTime();
    return d >= window.from.getTime() && d <= window.to.getTime();
  });

  let cohortCount = 0, cohortPremium = 0, persistedCount = 0, persistedPremium = 0, undated = 0;
  for (const p of inCohort) {
    if (p.lapseUndated && !p.lapsedOn) {
      undated++;
      continue;
    }
    const premium = Number.isFinite(p.annualPremium) ? Math.max(0, p.annualPremium) : 0;
    cohortCount++;
    cohortPremium += premium;
    const due = addMonths(p.issuedOn, month - 1);
    if (!p.lapsedOn || day(p.lapsedOn).getTime() > due.getTime()) {
      persistedCount++;
      persistedPremium += premium;
    }
  }

  const total = cohortCount + undated;
  const reliable = cohortCount >= MIN_COHORT && (total === 0 || undated / total <= MAX_UNDATED_SHARE);
  return {
    month,
    window,
    cohortCount,
    cohortPremium,
    persistedCount,
    persistedPremium,
    undated,
    byCount: reliable ? (persistedCount / cohortCount) * 100 : null,
    byPremium: reliable && cohortPremium > 0 ? (persistedPremium / cohortPremium) * 100 : null,
  };
}
