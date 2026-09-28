/**
 * When an ACTIVE SIP next debits — never a date in the past.
 *
 * `sips.next_installment_at` is written once (at creation, or from an RTA feed
 * that carries a next-debit date) and nothing moves it on, so a live SIP read
 * "Next due 4 Jul" in September. This derives the next debit from what the
 * SIP record does know:
 *
 *   1. A stored next date that is still today or later wins — the RTA knows
 *      about skipped or shifted debits that the SIP day alone cannot.
 *   2. Monthly: the next occurrence of the SIP day on or after today (a 31st
 *      falls on the month's last day in shorter months).
 *   3. Quarterly / yearly: the same, stepping 3 / 12 months from the phase of
 *      the stored date (or the start date), so a March–June–Sept SIP stays on
 *      that cycle.
 *   4. Weekly / fortnightly: 7 / 14-day steps from the stored or start date.
 *
 * Never before the start date (a SIP registered for next month is due then).
 * If the next debit would fall after the end date, there is none: `ended`.
 * With no SIP day and no dates at all the answer is unknown (null) — a record
 * gap, not a fact about the SIP.
 *
 * Non-active SIPs keep their stored date: a stopped SIP's last due date is
 * history, not a promise.
 *
 * Plain module (no DB, no React). Dates are ISO yyyy-mm-dd, compared as India
 * calendar days.
 */

export type SipDueInput = {
  status: string;
  frequency: string | null;
  sipDate: string | number | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
  nextInstallmentAt: string | Date | null;
};

export type SipNextDue = { date: string | null; ended: boolean };

const DAY_MS = 86_400_000;

/** Today's date in India, yyyy-mm-dd. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

function isoDay(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** `day` of month (year, month0 may overflow), clamped to the month's length. */
function onDay(year: number, month0: number, day: number): Date {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

export function sipNextDue(s: SipDueInput, today: string = indiaToday()): SipNextDue {
  const stored = isoDay(s.nextInstallmentAt);
  if (s.status !== "active") return { date: stored, ended: false };

  const start = isoDay(s.startDate);
  const end = isoDay(s.endDate);
  const floor = start && start > today ? start : today;
  const done = (date: string | null): SipNextDue =>
    date && end && date > end ? { date: null, ended: true } : { date, ended: false };

  if (stored && stored >= floor) return done(stored);

  // A real debit date (stored, else the start) fixes the cycle's phase.
  const anchor = stored ?? start;
  const freq = s.frequency ?? "monthly";

  if (freq === "weekly" || freq === "fortnightly") {
    if (!anchor) return { date: null, ended: false };
    const step = (freq === "weekly" ? 7 : 14) * DAY_MS;
    const a = utc(anchor).getTime();
    const f = utc(floor).getTime();
    const n = a >= f ? 0 : Math.ceil((f - a) / step);
    return done(toIso(new Date(a + n * step)));
  }

  const dayNum = Number(s.sipDate);
  const day =
    Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31 ? dayNum : anchor ? utc(anchor).getUTCDate() : null;
  if (day == null) return { date: null, ended: false };

  const stepMonths = freq === "quarterly" ? 3 : freq === "yearly" ? 12 : 1;
  const f = utc(floor);
  let year = f.getUTCFullYear();
  let month = f.getUTCMonth();
  if (stepMonths > 1 && anchor) {
    // Walk the anchor's cycle to the last step at or before the floor's month.
    const a = utc(anchor);
    const diff = (year - a.getUTCFullYear()) * 12 + (month - a.getUTCMonth());
    year = a.getUTCFullYear();
    month = a.getUTCMonth() + Math.floor(diff / stepMonths) * stepMonths;
  }
  let d = onDay(year, month, day);
  // At most two steps: the walk above lands in or just before the floor's month.
  while (toIso(d) < floor) {
    month += stepMonths;
    d = onDay(year, month, day);
  }
  return done(toIso(d));
}
