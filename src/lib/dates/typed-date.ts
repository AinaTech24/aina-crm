/**
 * Reading a date someone typed, and showing one back — for the date fields.
 *
 * People in Indian offices type dates day-first, in every separator they know:
 * 30-09-2026, 30/9/26, 30.09.2026, 30092026, 30 Sep 2026. All of those, and
 * the ISO form the fields store (2026-09-30), read as the same day. Month-first
 * US order is NOT accepted: 03/04/2026 is 3 April, never 4 March.
 *
 * Fields show a stored date as "30 Sep 2026" — the month in words, so a
 * day-first reading can't be mistaken for a month-first one.
 *
 * Plain module: no DB, no React. Works in local calendar days.
 */

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** yyyy-mm-dd for a local date. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local Date for a stored yyyy-mm-dd (anything after the day is ignored); null if not a real day. */
export function fromIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return realDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

function realDay(y: number, month: number, day: number): Date | null {
  if (!Number.isInteger(y) || y < 1000 || y > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(y, month - 1, day);
  return d.getFullYear() === y && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/** Two-digit years: within ten years ahead of `now` reads as this century, older as the last. */
function fullYear(y: number, now: Date): number {
  if (y >= 100) return y;
  const pivot = (now.getFullYear() % 100) + 10;
  const century = Math.floor(now.getFullYear() / 100) * 100;
  return y <= pivot ? century + y : century - 100 + y;
}

function monthFromWord(w: string): number | null {
  const k = w.toLowerCase().replace(/\.$/, "");
  if (k.length < 3) return null;
  const i = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(k) || (k === "sept" && n === "September"));
  return i >= 0 ? i + 1 : null;
}

/**
 * The yyyy-mm-dd a person meant, or:
 *   ""   — the text is empty (they cleared the field)
 *   null — it isn't a date we can read
 */
export function parseTypedDate(text: string, now: Date = new Date()): string | null {
  const t = text.trim();
  if (!t) return "";

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(realDay(Number(m[1]), Number(m[2]), Number(m[3])));

  m = /^(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+(\d{2}|\d{4})$/.exec(t);
  if (m) return iso(realDay(fullYear(Number(m[3]), now), Number(m[2]), Number(m[1])));

  m = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (m) return iso(realDay(Number(m[3]), Number(m[2]), Number(m[1])));

  // 30 Sep 2026 · 30-Sept-26 · 30 September, 2026
  m = /^(\d{1,2})[\s./-]*([A-Za-z]{3,9}\.?)[\s.,/-]*(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const month = monthFromWord(m[2]);
    return month ? iso(realDay(fullYear(Number(m[3]), now), month, Number(m[1]))) : null;
  }
  return null;
}

const iso = (d: Date | null) => (d ? toIsoDate(d) : null);

/** "30 Sep 2026" for a stored yyyy-mm-dd; "" when there is none. */
export function formatDateLabel(s: string | null | undefined): string {
  const d = fromIsoDate(s);
  return d ? `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}` : "";
}

/** "Wednesday, 30 September 2026" — the accessible name of a calendar day. */
export function formatDateLong(d: Date): string {
  const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  return `${dow}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Whether a yyyy-mm-dd lies inside optional yyyy-mm-dd bounds (inclusive). */
export function withinBounds(isoDay: string, min?: string | null, max?: string | null): boolean {
  const day = isoDay.slice(0, 10);
  if (min && day < min.slice(0, 10)) return false;
  if (max && day > max.slice(0, 10)) return false;
  return true;
}

/** "9:30 am" for an "HH:MM" time. */
export function formatTimeLabel(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return "";
  const h = Number(m[1]);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}
