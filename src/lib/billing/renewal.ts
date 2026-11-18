/**
 * Renewal, grace and late payment — the owner's rule A of 2026-11-18. Pure.
 *
 *  - The paid-through date (`subscriptions.license_end_at`) is the renewal's
 *    DUE date. Days are counted on India calendar dates: the due date is day 0.
 *  - Days 0 … graceDays (7): GRACE — full access, a banner, paying costs
 *    nothing extra and the new cycle runs from the ORIGINAL due date.
 *  - Day graceDays + 1 onwards: LAPSED — the license gate restricts the firm to
 *    Billing and Support. Paying now adds the grace days pro-rata (monthly base
 *    ÷ day basis × grace days, + GST) and the new cycle starts on the payment date.
 *
 * A failed auto-debit, a cancelled mandate and a plain unpaid renewal are the
 * same thing here: what matters is the date the firm is paid up to.
 */

import { addMonths } from "./aum-pricing";

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** India calendar day number (days since epoch, IST). */
export function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_MS) / DAY_MS);
}

/** "2026-11-18" — the India calendar date of an instant. */
export function istDate(d: Date): string {
  return new Date(istDayNumber(d) * DAY_MS).toISOString().slice(0, 10);
}

export type RenewalPhase = "current" | "grace" | "lapsed";

export type RenewalState = {
  phase: RenewalPhase;
  dueAt: Date;
  /** Calendar days past the due date (0 on the due date itself); negative before it. */
  daysOverdue: number;
  /** Grace days left after today (0 on the last grace day); null outside grace. */
  daysLeft: number | null;
  /** The last day of full access, India date. */
  graceEndsOn: string;
};

export function renewalState(dueAt: Date, now: Date, graceDays: number): RenewalState {
  const lastGraceDay = istDayNumber(dueAt) + graceDays;
  const graceEndsOn = new Date(lastGraceDay * DAY_MS).toISOString().slice(0, 10);
  if (now.getTime() < dueAt.getTime()) {
    return { phase: "current", dueAt, daysOverdue: istDayNumber(now) - istDayNumber(dueAt), daysLeft: null, graceEndsOn };
  }
  const daysOverdue = istDayNumber(now) - istDayNumber(dueAt);
  if (daysOverdue <= graceDays) {
    return { phase: "grace", dueAt, daysOverdue, daysLeft: graceDays - daysOverdue, graceEndsOn };
  }
  return { phase: "lapsed", dueAt, daysOverdue, daysLeft: null, graceEndsOn };
}

/** What a renewal payment made at `paidAt` buys: the period, and whether it is late. */
export function renewalPeriod(
  dueAt: Date,
  paidAt: Date,
  months: number,
  graceDays: number
): { late: boolean; start: Date; end: Date } {
  const s = renewalState(dueAt, paidAt, graceDays);
  if (s.phase === "lapsed") return { late: true, start: paidAt, end: addMonths(paidAt, months) };
  // Paid early or within grace: the cycle continues from the original due date.
  return { late: false, start: dueAt, end: addMonths(dueAt, months) };
}

/**
 * The license gate's view of an AUM-priced subscription. Statuses that only
 * describe the mandate (a failed debit, a cancelled mandate) do not end paid
 * time — the dates do.
 */
export function aumLicenseView(
  sub: { status: string; licenseEndAt: Date | null },
  now: Date,
  graceDays: number
): { status: "pending" | "active" | "past_due" | "expired" | "suspended" | "cancelled"; isRestricted: boolean; renewal: RenewalState | null } {
  if (sub.status === "pending") return { status: "pending", isRestricted: true, renewal: null };
  // A firm AINA suspended or cancelled by hand stays that way.
  if (sub.status === "suspended" || sub.status === "cancelled") {
    return { status: sub.status, isRestricted: true, renewal: null };
  }
  if (!sub.licenseEndAt) return { status: "active", isRestricted: false, renewal: null };
  const r = renewalState(sub.licenseEndAt, now, graceDays);
  if (r.phase === "current") return { status: "active", isRestricted: false, renewal: r };
  if (r.phase === "grace") return { status: "past_due", isRestricted: false, renewal: r };
  return { status: "expired", isRestricted: true, renewal: r };
}
