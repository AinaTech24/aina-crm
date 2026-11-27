/**
 * When a task is due, in India time — the app's copy of the CRM's rule (src/lib/tasks/due.ts):
 * a task is overdue only once its due DATE has ended in India, and a reminder on a due date with
 * no time counts from 10:00 am that day.
 */
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
export const WORKING_HOUR = 10;

const istDayNumber = (ms: number) => Math.floor((ms + IST_MS) / DAY_MS);

export function isPastDue(due: string | null | undefined, now: number = Date.now()): boolean {
  if (!due) return false;
  const t = Date.parse(due);
  return Number.isFinite(t) && istDayNumber(t) < istDayNumber(now);
}

export function reminderIso(dueIso: string, offsetMinutes: number): string {
  const t = Date.parse(dueIso);
  const base = t % DAY_MS === 0 ? t + WORKING_HOUR * 3_600_000 - IST_MS : t;
  return new Date(base - offsetMinutes * 60_000).toISOString();
}
