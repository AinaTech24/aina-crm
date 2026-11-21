/** The swipe Snooze's date — pure, so it is tested without the gesture stack. */

const IST = 330 * 60_000;
const DAY = 86_400_000;

/**
 * Snooze to tomorrow (India), keeping the task's time of day (10:00 when it has
 * none). A task already due after tomorrow moves a further day.
 */
export function snoozeTarget(dueAt: string | null | undefined, now = Date.now()): string {
  const due = dueAt ? new Date(dueAt).getTime() : NaN;
  const todayIst = Math.floor((now + IST) / DAY) * DAY; // midnight IST, in IST-shifted ms
  const tomorrowStart = todayIst + DAY - IST; // real instant of tomorrow 00:00 IST
  const timeOfDay = Number.isFinite(due) ? (((due + IST) % DAY) + DAY) % DAY : 10 * 3_600_000;
  if (Number.isFinite(due) && due >= tomorrowStart) return new Date(due + DAY).toISOString();
  return new Date(tomorrowStart + timeOfDay).toISOString();
}
