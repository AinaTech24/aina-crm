// Copied verbatim from src/lib/fund-research/nav.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Fund Research — the NAV-series core every research tool runs on.
 *
 * Pure: no React, no fetch, no DB. A tool receives a scheme's NAV history
 * (from GET /api/mf/schemes/[schemeCode]/nav, i.e. mfapi.in) and computes from
 * it alone, so every figure can be checked by hand against a synthetic series.
 *
 * THE NAV RULES (stated once, used by every tool):
 *
 *   • A TRANSACTION (purchase, SIP instalment, STP transfer out AND in, SWP
 *     withdrawal) dated on a holiday — a date with no NAV — is processed at the
 *     NEXT available NAV (`navOnOrAfter`), as an AMC processes it on the next
 *     business day. The row shows the NAV date actually used.
 *   • A VALUATION ("value as on") uses the LATEST NAV on or before the date
 *     (`navOnOrBefore`) — the last price published by then.
 *   • A scheduled transaction before the scheme's first NAV is skipped (the
 *     scheme did not exist), and one whose next NAV falls after the period's
 *     end date is not counted.
 *   • Units are kept unrounded (a statement rounds to 3 decimals; the UI does
 *     too) and stamp duty / exit loads / taxes are not deducted.
 *
 * Years for CAGR are calendar days ÷ 365 between the two NAV dates used; a
 * period under one year has no CAGR (annualising a few months misleads) — the
 * absolute return is the figure there.
 */

export type NavPoint = { date: string; nav: number };

/** Ascending, de-duplicated, positive NAVs with day numbers for binary search. */
export type NavSeries = {
  dates: string[];
  days: number[];
  navs: number[];
};

export type NavHit = { date: string; nav: number; index: number };

export type Frequency = "weekly" | "fortnightly" | "monthly" | "quarterly";

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DAY = 86_400_000;

/** Days since 1970-01-01 (UTC) for an ISO yyyy-mm-dd date; NaN when malformed. */
export function dayNum(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DAY;
}

export function isoFromDay(day: number): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return isoFromDay(dayNum(iso) + n);
}

export function daysBetween(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The date `n` months after (year, month1), on `day` clamped to the month's length. */
export function monthDate(year: number, month1: number, n: number, day: number): string {
  const total = year * 12 + (month1 - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `iso` plus `n` months (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const m = ISO.exec(iso);
  if (!m) return iso;
  return monthDate(Number(m[1]), Number(m[2]), n, Number(m[3]));
}

/** `iso` plus `n` calendar years (29 Feb + 1 year = 28 Feb). */
export function addYears(iso: string, n: number): string {
  return addMonths(iso, 12 * n);
}

/** Whole calendar years from `a` to `b` (anniversary counting). */
export function fullYearsBetween(a: string, b: string): number {
  let y = 0;
  while (addYears(a, y + 1) <= b) y++;
  return y;
}

/** Build a series from raw points: drops bad rows, sorts ascending, keeps the last NAV per date. */
export function navSeries(points: ReadonlyArray<NavPoint>): NavSeries {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (!p || !ISO.test(p.date) || !Number.isFinite(p.nav) || p.nav <= 0) continue;
    byDate.set(p.date, p.nav);
  }
  const dates = [...byDate.keys()].sort();
  return { dates, days: dates.map(dayNum), navs: dates.map((d) => byDate.get(d) as number) };
}

export function firstNav(s: NavSeries): NavHit | null {
  return s.dates.length ? { date: s.dates[0], nav: s.navs[0], index: 0 } : null;
}

export function lastNav(s: NavSeries): NavHit | null {
  const i = s.dates.length - 1;
  return i >= 0 ? { date: s.dates[i], nav: s.navs[i], index: i } : null;
}

/** Index of the first NAV dated on or after `day` (length when none). */
function lowerBound(s: NavSeries, day: number): number {
  let lo = 0;
  let hi = s.days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.days[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Transaction NAV: the NAV of `iso`, else the NEXT available one. */
export function navOnOrAfter(s: NavSeries, iso: string): NavHit | null {
  const i = lowerBound(s, dayNum(iso));
  return i < s.dates.length ? { date: s.dates[i], nav: s.navs[i], index: i } : null;
}

/** Valuation NAV: the NAV of `iso`, else the latest one before it. */
export function navOnOrBefore(s: NavSeries, iso: string): NavHit | null {
  const day = dayNum(iso);
  const i = lowerBound(s, day);
  if (i < s.dates.length && s.days[i] === day) return { date: s.dates[i], nav: s.navs[i], index: i };
  return i > 0 ? { date: s.dates[i - 1], nav: s.navs[i - 1], index: i - 1 } : null;
}

/** Units bought (or redeemed) for `amount` at `nav`. */
export function unitsFor(amount: number, nav: number): number {
  return nav > 0 ? amount / nav : 0;
}

/** Absolute return in %: (end ÷ begin − 1) × 100; null when begin ≤ 0. */
export function absoluteReturnPct(begin: number, end: number): number | null {
  return begin > 0 ? (end / begin - 1) * 100 : null;
}

/**
 * CAGR in %, years = days ÷ 365. Null under one year (use the absolute
 * return) or when either value is not positive.
 */
export function cagrPct(begin: number, end: number, days: number): number | null {
  if (!(begin > 0) || !(end > 0) || days < 365) return null;
  return (Math.pow(end / begin, 365 / days) - 1) * 100;
}

/**
 * Scheduled dates from `start` to `end` inclusive.
 *   monthly / quarterly — on `day` of the month (clamped to short months),
 *     the first one on or after `start`, then every 1 / 3 months;
 *   weekly / fortnightly — `start`, then every 7 / 14 days.
 */
export function scheduleDates(freq: Frequency, start: string, end: string, day?: number): string[] {
  const out: string[] = [];
  if (!ISO.test(start) || !ISO.test(end) || start > end) return out;
  if (freq === "weekly" || freq === "fortnightly") {
    const step = freq === "weekly" ? 7 : 14;
    for (let d = dayNum(start); d <= dayNum(end) && out.length < 5000; d += step) out.push(isoFromDay(d));
    return out;
  }
  const step = freq === "monthly" ? 1 : 3;
  const m = ISO.exec(start) as RegExpExecArray;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Math.min(Math.max(Math.round(day ?? Number(m[3])), 1), 31);
  const k = monthDate(y, mo, 0, dd) < start ? 1 : 0;
  for (let n = 0; out.length < 2000; n++) {
    const d = monthDate(y, mo, k + n * step, dd);
    if (d > end) break;
    out.push(d);
  }
  return out;
}

/** A scheduled transaction resolved to the NAV it executes at, or why it does not. */
export type Execution =
  | { ok: true; scheduled: string; hit: NavHit }
  | { ok: false; scheduled: string; reason: "before_launch" | "after_end" };

/** Resolve a scheduled date under the transaction rule, bounded by `end`. */
export function execute(s: NavSeries, scheduled: string, end: string): Execution {
  const first = firstNav(s);
  if (!first || scheduled < first.date) return { ok: false, scheduled, reason: "before_launch" };
  const hit = navOnOrAfter(s, scheduled);
  if (!hit || hit.date > end) return { ok: false, scheduled, reason: "after_end" };
  return { ok: true, scheduled, hit };
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Sample standard deviation (n − 1). NaN with fewer than two values. */
export function sampleStd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** A tool's outcome: the figures, or one sentence saying why there are none. */
export type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** "dd-mm-yyyy" for messages (the UI formats with formatDate). */
export function dmy(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
