/**
 * Credential and declaration deadlines for a distributor's people, as pure
 * functions.
 *
 * - ARN and EUIN are valid for three years and expire with the NISM Series
 *   V-A certificate. NISM can be renewed up to 12 months early, ARN/EUIN up to
 *   6. With a lapsed ARN, new business is routed to Direct plans and trail
 *   stops (AMFI ARN renewal circulars).
 * - The annual Declaration of Self-Certification is due 30 June. Commission
 *   is withheld from 1 July and forfeited if it is still missing on 30
 *   September (AMFI, via Cafemutual). workers/dsc-reminder.ts dates the task
 *   on 30 June too.
 *
 * Buckets follow the dashboard severity budget: red only once something has
 * actually lapsed or money is being withheld, amber inside 30 days, neutral
 * further out.
 *
 * Plain module: no DB, no React. Dates are compared as calendar days (UTC).
 */

export type ExpiryBucket = "expired" | "d30" | "d90" | "d180" | "later" | "not_recorded";

export const EXPIRY_BUCKET_LABEL: Record<ExpiryBucket, string> = {
  expired: "Expired",
  d30: "Within 30 days",
  d90: "31–90 days",
  d180: "91–180 days",
  later: "More than 180 days",
  not_recorded: "No expiry recorded",
};

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Whole days from `today` until `expiry` (negative once past). */
export function daysUntil(expiry: Date, today: Date): number {
  return Math.round((utcDay(expiry) - utcDay(today)) / DAY_MS);
}

/** An expiry that falls on today is still valid today; it is expired tomorrow. */
export function expiryBucket(expiry: Date | null | undefined, today: Date): ExpiryBucket {
  if (!expiry || Number.isNaN(expiry.getTime())) return "not_recorded";
  const d = daysUntil(expiry, today);
  if (d < 0) return "expired";
  if (d <= 30) return "d30";
  if (d <= 90) return "d90";
  if (d <= 180) return "d180";
  return "later";
}

/** Tone for a bucket under the severity budget. */
export function expiryTone(b: ExpiryBucket): "red" | "amber" | "neutral" {
  return b === "expired" ? "red" : b === "d30" ? "amber" : "neutral";
}

export type DscState = "filed" | "due" | "withheld" | "forfeited";

/**
 * Where this year's self-declaration stands on `today`. The declaration for
 * the financial year that started in April of `fyStartYear` is due 30 June
 * of that year.
 *
 *  filed     — submitted (any date)
 *  due       — not yet submitted, on or before 30 June
 *  withheld  — 1 July – 30 September: commission is being withheld
 *  forfeited — after 30 September: withheld commission is lost
 */
export function dscState(fyStartYear: number, filedOn: Date | null | undefined, today: Date): DscState {
  if (filedOn && !Number.isNaN(filedOn.getTime())) return "filed";
  const t = utcDay(today);
  if (t <= Date.UTC(fyStartYear, 5, 30)) return "due";
  if (t <= Date.UTC(fyStartYear, 8, 30)) return "withheld";
  return "forfeited";
}

/** Indian financial year (April–March) that `d` falls in, by its starting year. */
export function fyStartYearOf(d: Date): number {
  return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}
