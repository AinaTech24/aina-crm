/**
 * Cell parsers for the Excel imports of Tasks, Meetings and Service Requests
 * (2026-11-24). Pure. A cell reaches here as TEXT: the sheet reader (read.ts)
 * already turns real Excel dates / times into ISO text, so these also accept the
 * ways people TYPE a date in India — day first (24/11/2026, 24-11-2026), with a
 * month name (24 Nov 2026), or ISO.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
export const bad = <T = never>(error: string): Parsed<T> => ({ ok: false, error });

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");

function realDay(y: number, m: number, d: number): Parsed<string> {
  if (!(y >= 1990 && y <= 2100) || m < 1 || m > 12 || d < 1 || d > 31) return bad("not a valid date");
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return bad("not a valid date");
  return ok(`${y}-${pad(m)}-${pad(d)}`);
}

/** → "YYYY-MM-DD". Day first for numeric dates (India), as every other date in the CRM. */
export function parseDay(raw: string): Parsed<string> {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s);
  if (m) return realDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(s);
  if (m) {
    const yy = +m[3];
    return realDay(m[3].length === 2 ? (yy < 70 ? 2000 + yy : 1900 + yy) : yy, +m[2], +m[1]);
  }
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    return mon ? realDay(+m[3], mon, +m[1]) : bad("not a valid date");
  }
  // An Excel serial that arrived as a bare number.
  if (/^\d{5}$/.test(s) && +s > 20000 && +s < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + +s * 86_400_000);
    return realDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return bad("not a date — write it as 24-11-2026 or 24 Nov 2026");
}

/** → "HH:MM" (24 hour). Accepts 14:30, 2:30 pm, 2.30PM, 14:30:00. */
export function parseTime(raw: string): Parsed<string> {
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(raw.trim());
  if (!m) return bad("not a time — write it as 14:30 or 2:30 pm");
  let h = +m[1];
  const min = +m[2];
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59) return bad("not a valid time");
  if (ap) {
    if (h < 1 || h > 12) return bad("not a valid time");
    h = (h % 12) + (ap === "pm" ? 12 : 0);
  } else if (h > 23) {
    return bad("not a valid time");
  }
  return ok(`${pad(h)}:${pad(min)}`);
}

/** A date with an optional time, in one cell ("24-11-2026 14:30", "2026-11-24T14:30", "24 Nov 2026"). */
export function parseDayTime(raw: string): Parsed<{ day: string; time: string | null }> {
  const s = raw.trim();
  const m = /^(.*?)(?:[T\s]+(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?))?$/i.exec(s);
  if (!m) return bad("not a date");
  const day = parseDay(m[1]);
  if (!day.ok) return bad(day.error);
  if (m[2] === undefined) return ok({ day: day.value, time: null });
  const time = parseTime(m[2]);
  return time.ok ? ok({ day: day.value, time: time.value }) : bad(time.error);
}

export function parseInteger(raw: string, min: number, max: number): Parsed<number> {
  const s = raw.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.0+)?$/.test(s)) return bad("not a whole number");
  const n = Math.round(Number(s));
  return n < min || n > max ? bad(`must be between ${min} and ${max}`) : ok(n);
}

const YES = new Set(["yes", "y", "true", "1", "required"]);
const NO = new Set(["no", "n", "false", "0", ""]);
export function parseBool(raw: string): Parsed<boolean> {
  const s = raw.trim().toLowerCase();
  if (YES.has(s)) return ok(true);
  if (NO.has(s)) return ok(false);
  return bad("write Yes or No");
}

export type Option = { value: string; label: string };
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** An allowed value by its stored key OR its label, ignoring case, spaces and underscores. */
export function parseEnum(raw: string, options: Option[]): Parsed<string> {
  const k = key(raw);
  const hit = options.find((o) => key(o.value) === k || key(o.label) === k);
  if (hit) return ok(hit.value);
  const shown = options.slice(0, 8).map((o) => o.label).join(", ");
  return bad(`“${raw.trim().slice(0, 40)}” is not one of: ${shown}${options.length > 8 ? ", …" : ""}`);
}

/** "a; b, c" or one per line → trimmed, de-duplicated, capped. */
export function parseList(raw: string, max = 100, sep = /[;\n|]+/): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(sep)) {
    const t = part.trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    if (out.length >= max) break;
  }
  return out;
}

/** A date picked without a time is stored the way the task screen stores it: midnight UTC. */
export const dayToUtcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** A date and time typed in India time → the instant. */
export const istInstant = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);

/** Today in India, "YYYY-MM-DD". */
export function indiaToday(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p; // en-CA → 2026-11-24
}

export const humanise = (v: string) => {
  const s = v.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

/** A phone number reduced to its last 10 digits, for matching. */
export const phoneKey = (v: string) => v.replace(/\D/g, "").slice(-10);
