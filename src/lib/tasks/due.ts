/**
 * When a task is due, in India time — the ONE rule for screens, servers and reminders (2026-11-27).
 *
 *   · A task has a due DATE. It is overdue only once that date has ENDED in India: it stays "due
 *     today" all day. (It used to turn overdue at 5:30 am, because a date with no time is stored at
 *     midnight UTC.) The SQL twins are in ./due-sql.ts.
 *   · A reminder worked out from a due date with no time counts from WORKING_HOUR (10:00 am) that
 *     day, not from midnight UTC.
 *
 * Pure — safe in the browser.
 */

/** The India clock hour date-based reminders and overdue alerts go out at. */
export const WORKING_HOUR = 10;

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Midnight at the start of today, India time. */
export function startOfTodayIst(now: Date = new Date()): Date {
  return new Date(Math.floor((now.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS);
}

/** The due date has ended in India. (Whether the task is still open is the caller's question.) */
export function isPastDue(due: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false;
  const t = new Date(due).getTime();
  return Number.isFinite(t) && t < startOfTodayIst(now).getTime();
}

/** A due date picked without a time: stored at midnight UTC. */
export function isDateOnlyDue(due: Date): boolean {
  return due.getTime() % DAY_MS === 0;
}

/**
 * When to remind, `offsetMinutes` before the task is due. A date-only due counts from WORKING_HOUR
 * India time on that date ("on the due date" = 10:00 am; "1 day before" = 10:00 am the day before);
 * a due with its own time counts from that time.
 */
export function reminderInstant(due: Date | string, offsetMinutes: number): Date {
  const d = new Date(due);
  const base = isDateOnlyDue(d) ? d.getTime() + WORKING_HOUR * 3_600_000 - IST_MS : d.getTime();
  return new Date(base - offsetMinutes * 60_000);
}

/** Has the India working day begun? Alerts about lateness wait for it. */
export function workingDayStarted(now: Date = new Date()): boolean {
  return new Date(now.getTime() + IST_MS).getUTCHours() >= WORKING_HOUR;
}
