/**
 * Due / follow-up values, in India time (the firm works on IST whatever zone
 * the phone is set to — CLAUDE.md "India dates").
 *
 * A due value is either a DAY ("2026-11-21") or a day and an India wall-clock
 * time ("2026-11-21T17:00"). A form decides what a bare day means when it is
 * sent (a lead follow-up: 10:00 IST; a task's due: the web's UTC midnight), so
 * a day picked from the calendar still sends exactly what it always did — only
 * a quick chip ("Today 5 pm", "Tomorrow 10 am") or a time the person picks
 * carries a time.
 */

export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/;

/** India's calendar day and minutes past midnight at `now`. */
export function istParts(now: number = Date.now()): { day: string; minutes: number } {
  const d = new Date(now + IST_OFFSET_MS);
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** `day` moved by `n` calendar days ("YYYY-MM-DD"). */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return isNaN(t) ? day : new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

/** A due value's day and time ("" when absent). */
export function splitDue(v?: string | null): { day: string; time: string } {
  const m = DAY_RE.exec(String(v ?? ""));
  return m ? { day: m[1], time: m[2] ?? "" } : { day: "", time: "" };
}

/** A day (and optional time) as a due value; "" without a day. */
export function joinDue(day: string, time?: string): string {
  return day ? (time ? `${day}T${time}` : day) : "";
}

/** A due value → ISO instant, its time read as India time; a bare day takes `defaultTime` (IST). */
export function istToIso(v?: string | null, defaultTime = "10:00"): string | undefined {
  const { day, time } = splitDue(v);
  if (!day) return undefined;
  const t = new Date(`${day}T${time || defaultTime}:00+05:30`);
  return isNaN(t.getTime()) ? undefined : t.toISOString();
}

/**
 * A stored instant → a due value: its India day, plus its India time unless
 * that is `defaultTime` (so a follow-up at the CRM's usual 10:00 reads as the
 * plain day it was picked as).
 */
export function dueFromIso(iso?: string | null, defaultTime?: string): string {
  if (!iso) return "";
  const t = new Date(String(iso)).getTime();
  if (isNaN(t)) return splitDue(String(iso)).day;
  const d = new Date(t + IST_OFFSET_MS).toISOString();
  const day = d.slice(0, 10), time = d.slice(11, 16);
  return defaultTime && time === defaultTime ? day : `${day}T${time}`;
}

/** "17:00" → "5:00 pm" (an India wall-clock time, no zone maths). */
export function timeLabel(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

export interface DueChip {
  key: string;
  label: string;
  /** The due value the chip sets: a day with a time, or a bare day. */
  value: string;
}

/** A day-only chip a form adds after the two quick times (e.g. "3 days"). */
export interface ExtraDueChip {
  label: string;
  days: number;
  time?: string;
}

/**
 * The quick chips: "Today 5 pm" (until 5 pm in India — after that it would be
 * in the past), "Tomorrow 10 am", then the form's own (e.g. "3 days").
 */
export function dueChips(now: number = Date.now(), extra: ExtraDueChip[] = []): DueChip[] {
  const { day, minutes } = istParts(now);
  const out: DueChip[] = [];
  if (minutes < 17 * 60) out.push({ key: "today-17", label: "Today 5 pm", value: `${day}T17:00` });
  out.push({ key: "tomorrow-10", label: "Tomorrow 10 am", value: `${addDays(day, 1)}T10:00` });
  for (const e of extra) out.push({ key: `d${e.days}${e.time ?? ""}`, label: e.label, value: joinDue(addDays(day, e.days), e.time) });
  return out;
}

/** Whether `value` is what `chip` sets (a day-only chip matches its day at any time when `anyTime`). */
export function chipSelected(chip: DueChip, value: string, anyTime = false): boolean {
  if (!value) return false;
  if (chip.value === value) return true;
  const c = splitDue(chip.value);
  return anyTime && !c.time && c.day === splitDue(value).day;
}
