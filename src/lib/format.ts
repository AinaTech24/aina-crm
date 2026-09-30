/**
 * The app's number and date formatting, in one place.
 *
 * The audit found the same value printed three ways on one screen. Money:
 * `₹16.23 Cr`, `₹90,000` and `₹8.93 Lakh` sat side by side in a single KPI row,
 * because `formatINRShort` chooses its unit per value — so a row of tiles could
 * not be compared at a glance. Elsewhere the same figure appears as `₹3.2Cr`
 * (no space) and `₹32,00,000` (every digit). Dates were worse: twelve distinct
 * option shapes, mixing `7 Sept 2026`, `07 Sept 2026` and `30 Jun 26`, with 107
 * raw `toLocaleDateString` calls bypassing the helper entirely.
 *
 * Rules this module enforces:
 *
 *   · A GROUP of money values shares one unit. Call `pickMoneyScale(values)`
 *     once for the row, pass the result to every tile in it.
 *   · Dates never zero-pad and never abbreviate the year. One shape per style.
 *   · Nothing renders `NaN`, `Invalid Date` or `undefined` — absent data is an
 *     em dash, everywhere.
 */

/* ────────────────────────────── money ────────────────────────────── */

/**
 * `auto` picks per value and is what the old `formatINRShort` did — kept for
 * single figures that stand alone. For anything that sits in a row, pick the
 * scale once with `pickMoneyScale` and pass it explicitly.
 */
export type MoneyScale = "auto" | "cr" | "lakh" | "full";

const CRORE = 1e7;
const LAKH = 1e5;

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * The unit that suits a whole set of figures: the one the LARGEST of them
 * needs, so no tile in the row is left printing raw digits next to a `Cr`.
 */
export function pickMoneyScale(values: Array<number | string | null | undefined>): MoneyScale {
  const max = values.reduce<number>((acc, v) => {
    const n = toNumber(v);
    return n == null ? acc : Math.max(acc, Math.abs(n));
  }, 0);
  if (max >= CRORE) return "cr";
  if (max >= LAKH) return "lakh";
  return "full";
}

export function formatMoney(
  value: number | string | null | undefined,
  { scale = "auto", decimals = 2 }: { scale?: MoneyScale; decimals?: number } = {},
): string {
  const n = toNumber(value);
  if (n == null) return "—";

  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const resolved: MoneyScale =
    scale !== "auto" ? scale : abs >= CRORE ? "cr" : abs >= LAKH ? "lakh" : "full";

  if (resolved === "cr") return `${sign}₹${(abs / CRORE).toFixed(decimals)} Cr`;
  if (resolved === "lakh") return `${sign}₹${(abs / LAKH).toFixed(decimals)} Lakh`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Every digit, for tables read a row at a time. `₹32,00,000`. */
export function formatMoneyFull(value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** A plain count. `1,24,500`. */
export function formatCount(value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (n == null) return "—";
  return n.toLocaleString("en-IN");
}

/** `12.4%`. Pass the percentage itself, not a 0–1 fraction. */
export function formatPercent(
  value: number | string | null | undefined,
  decimals = 1,
): string {
  const n = toNumber(value);
  if (n == null) return "—";
  return `${n.toFixed(decimals)}%`;
}

/* ────────────────────────────── dates ────────────────────────────── */

/**
 * `date`      7 Sep 2026         the default — use unless you have a reason
 * `dayMonth`  7 Sep              inside a column already scoped to one year
 * `monthYear` September 2026     period headers
 * `dateTime`  7 Sep 2026, 4:30 PM
 * `weekday`   Mon, 7 Sep
 * `time`      5:21 PM
 *
 * Always India time, whatever the server's clock zone: production once ran
 * UTC and every timestamp before 05:30 IST printed as the previous day.
 *
 * Month names are spelled out here rather than taken from the `en-IN` locale,
 * which abbreviates September as "Sept" — the only four-letter month, so a
 * column of dates never lined up and the style guide says "Sep".
 */
export type DateStyle = "date" | "dayMonth" | "monthYear" | "dateTime" | "weekday" | "time";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const IST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  hour: "numeric", minute: "2-digit", hourCycle: "h23",
});

/** The date and time a moment reads in India. */
function istParts(d: Date): { y: number; m: number; d: number; wd: number; h: number; min: string } {
  const p: Record<string, string> = {};
  for (const part of IST_PARTS.formatToParts(d)) p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), wd, h: Number(p.hour) % 24, min: p.minute };
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  // A bare yyyy-mm-dd is a calendar date, not a UTC midnight: read it as noon
  // India time so no zone can push it onto the neighbouring day.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `5:21 PM`. */
function clock(h: number, min: string): string {
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? "AM" : "PM"}`;
}

export function formatDate(
  value: Date | string | number | null | undefined,
  style: DateStyle = "date",
): string {
  const d = toDate(value);
  if (!d) return "—";
  const p = istParts(d);
  switch (style) {
    case "dayMonth": return `${p.d} ${MONTH_SHORT[p.m]}`;
    case "monthYear": return `${MONTH_LONG[p.m]} ${p.y}`;
    case "dateTime": return `${p.d} ${MONTH_SHORT[p.m]} ${p.y}, ${clock(p.h, p.min)}`;
    case "weekday": return `${WEEKDAY_SHORT[p.wd]}, ${p.d} ${MONTH_SHORT[p.m]}`;
    case "time": return clock(p.h, p.min);
    default: return `${p.d} ${MONTH_SHORT[p.m]} ${p.y}`;
  }
}

/**
 * `just now` · `4m ago` · `3h ago` · `6d ago`, then falls back to a real date.
 *
 * A date still ahead prints as a date — unless `future` is set, when it reads
 * `in 4m` · `in 3h` · `in 6d` the same way. Opt-in because most callers pass
 * past times, and the few future ones were written expecting a date.
 */
export function formatRelative(
  value: Date | string | number | null | undefined,
  opts?: { future?: boolean },
): string {
  const d = toDate(value);
  if (!d) return "—";
  const seconds = (Date.now() - d.getTime()) / 1000;
  if (seconds < 0) {
    const ahead = -seconds;
    if (!opts?.future || ahead >= 604800) return formatDate(d);
    if (ahead < 60) return "in under a minute";
    if (ahead < 3600) return `in ${Math.floor(ahead / 60)}m`;
    if (ahead < 86400) return `in ${Math.floor(ahead / 3600)}h`;
    return `in ${Math.floor(ahead / 86400)}d`;
  }
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(d);
}

/**
 * Days between a due date and today, as a phrase a person would say.
 * Replaces the bare `83d` chips, which never said what the number counted.
 */
export function formatDueIn(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `due in ${days} days`;
}


/* ────────────────────────────── labels ────────────────────────────── */

/**
 * Enum slug → human label. `sip_rejected` → `Sip rejected`.
 *
 * Lives here rather than in Badge.tsx because that file is `"use client"`, and
 * a server component calling into it fails at runtime with "Attempted to call
 * humanise() from the server". This module has no client dependency, so both
 * sides can use it.
 *
 * ALL-CAPS input is deliberately down-cased — shouting is not a severity level,
 * and the audit found it applied inconsistently (`UTILITY` beside `Approved`).
 */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  if (!spaced) return spaced;
  const base = spaced === spaced.toUpperCase() ? spaced.toLowerCase() : spaced;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * `1 day` / `3 days`. A count with its unit, pluralised.
 *
 * Trivial, and it earns its place because "1 days overdue" shipped on the
 * action centre — the singular case is easy to miss when the sample data
 * happens not to contain it.
 */
export function pluralDays(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? "day" : "days"}`;
}
