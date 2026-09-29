/**
 * The SEBI rule for failed SIP debits, as pure functions.
 *
 * Since April 2024 a SIP is cancelled automatically after a run of failed
 * debits: THREE in a row for daily / weekly / fortnightly / monthly SIPs, TWO
 * for quarterly and longer. The investor is told after the first failure.
 * (CAMS "FAQ on Uniform SIP Cancellation"; SEBI SIP rationalisation.)
 *
 * A dashboard should therefore warn at the first failure and treat "one more
 * failure cancels it" as critical — by then a call to the client is the only
 * thing that saves the SIP.
 *
 * Plain module: no DB, no React.
 */

/** Frequencies stored on sips.frequency (see db/schema/transactions.ts). */
export type SipFrequency = "weekly" | "fortnightly" | "monthly" | "quarterly" | "half_yearly" | "yearly";

const LONG_CYCLE = new Set(["quarterly", "bi_monthly", "bimonthly", "half_yearly", "semi_annual", "yearly", "annual"]);

/**
 * Consecutive failures that cancel a SIP of this frequency. An unknown or
 * missing frequency is treated as monthly — the common case and the stricter
 * reading for a warning.
 */
export function sebiCancelLimit(frequency: string | null | undefined): 2 | 3 {
  const f = String(frequency ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LONG_CYCLE.has(f) ? 2 : 3;
}

export type DebitOutcome = "debited" | "failed";

/**
 * Failures in a row, counting back from the most recent debit attempt until
 * the first success. `outcomes` is newest first.
 */
export function failuresInRow(outcomes: readonly DebitOutcome[]): number {
  let n = 0;
  for (const o of outcomes) {
    if (o !== "failed") break;
    n++;
  }
  return n;
}

export type CancelRisk = {
  limit: 2 | 3;
  failures: number;
  /** Failures still allowed before the SIP is cancelled (0 = already at the limit). */
  remaining: number;
  /**
   * "critical": the next failure cancels it (or it already reached the limit).
   * "attention": at least one failure in the current run.
   * "none": the last attempt succeeded, or there were none.
   */
  level: "critical" | "attention" | "none";
};

export function sipCancelRisk(frequency: string | null | undefined, failures: number): CancelRisk {
  const limit = sebiCancelLimit(frequency);
  const f = Math.max(0, Math.floor(failures));
  const remaining = Math.max(0, limit - f);
  const level = f === 0 ? "none" : remaining <= 1 ? "critical" : "attention";
  return { limit, failures: f, remaining, level };
}
