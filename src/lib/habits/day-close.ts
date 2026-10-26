/**
 * The evening "close your day" nudge — the rules, kept pure so they are tested
 * (tests/day-close.test.ts) and the worker only gathers counts.
 *
 * A habit needs a cue at a fixed time, not a toggle someone has to remember
 * (the RM desk's "close the day" strip only appears on ?eod=1). So at 6:30 pm
 * IST each working user gets ONE in-app + push notification that opens the
 * Daily Job Tracker, with what they actually did today as the reward.
 *
 * Quiet by default: nobody on approved leave, nobody who had no work at all
 * today, and nobody who has already updated today's tracker this evening.
 */

export type DayCloseCounts = {
  /** Tasks assigned to them and completed today (IST). */
  done: number;
  /** Tasks due today (IST) still open. */
  openToday: number;
  /** Calls, visits and messages they logged today (notes excluded). */
  touches: number;
  /** Today's focus list on the Daily Job Tracker, and how much is ticked. */
  focusTotal: number;
  focusDone: number;
  /** Today's tracker was saved after the evening window opened. */
  closedAlready: boolean;
  /** Approved leave covering today. */
  onLeave: boolean;
};

export const DAY_CLOSE_KIND = "day.close";
export const DAY_CLOSE_LINK = "/dashboard/tasks/daily";
/** 18:30 IST. The worker acts from here until DAY_CLOSE_END_HOUR. */
export const DAY_CLOSE_HOUR = 18;
export const DAY_CLOSE_MINUTE = 30;
export const DAY_CLOSE_END_HOUR = 20;

/** Is this IST wall-clock time inside the evening window? */
export function inDayCloseWindow(istHour: number, istMinute: number): boolean {
  const m = istHour * 60 + istMinute;
  return m >= DAY_CLOSE_HOUR * 60 + DAY_CLOSE_MINUTE && m < DAY_CLOSE_END_HOUR * 60;
}

export function shouldPromptDayClose(c: DayCloseCounts): boolean {
  if (c.onLeave || c.closedAlready) return false;
  return c.done + c.openToday + c.touches + c.focusTotal > 0;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "5 tasks done · 3 client contacts logged · 2 due today still open." + the ask. */
export function dayCloseBody(c: DayCloseCounts): string {
  const parts: string[] = [];
  if (c.done > 0) parts.push(`${plural(c.done, "task")} done`);
  if (c.touches > 0) parts.push(`${plural(c.touches, "client contact")} logged`);
  if (c.focusTotal > 0) parts.push(`${c.focusDone} of ${c.focusTotal} focus items ticked`);
  if (c.openToday > 0) parts.push(`${c.openToday} due today still open`);
  const facts = parts.length ? `${parts.join(" · ")}.` : "";
  const ask =
    c.openToday > 0
      ? "Two minutes: tick what's done, move the rest, note one win."
      : "Two minutes: tick what's done and note one win.";
  return facts ? `${facts} ${ask}` : ask;
}

export function dayCloseTitle(c: DayCloseCounts): string {
  return c.done + c.touches > 0 ? "Good work today — close your day" : "Close your day";
}
