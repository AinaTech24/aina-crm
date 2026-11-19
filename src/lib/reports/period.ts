/**
 * The Period filter on reports — pure and client-safe (no DB, no "use client").
 *
 * The dashboards' list (lib/dashboards/system/period.ts: Today … This FY,
 * Last FY, All time, Custom, resolved in INDIA time) plus the rolling windows
 * the standard reports were hard-coded to before they had a filter: last 30 /
 * 90 days and the last 6 / 12 months (from the 1st of the month). Each report
 * opens on the window it always showed, so nothing changes until someone
 * picks another period.
 */

import { ALL_TIME_FROM, formatRange, indiaToday, resolvePeriod, isPeriodKey as isDashPeriod } from "@/lib/dashboards/system/period";

export const REPORT_PERIOD_KEYS = [
  "today",
  "week",
  "month",
  "last_month",
  "last_30",
  "last_90",
  "quarter",
  "last_6m",
  "last_12m",
  "fy",
  "last_fy",
  "all",
  "custom",
] as const;
export type ReportPeriodKey = (typeof REPORT_PERIOD_KEYS)[number];

export const REPORT_PERIOD_NAMES: Record<ReportPeriodKey, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  quarter: "This quarter",
  last_6m: "Last 6 months",
  last_12m: "Last 12 months",
  fy: "This FY",
  last_fy: "Last FY",
  all: "All time",
  custom: "Custom range",
};

export type ReportPeriod = {
  key: ReportPeriodKey;
  /** Inclusive India dates, yyyy-mm-dd. */
  from: string;
  to: string;
  /** "Last 30 days" */
  name: string;
  /** "Last 30 days (21 Oct – 19 Nov 2026)"; "All time" alone. */
  label: string;
  /** True for "All time": the report applies no date condition at all. */
  unbounded: boolean;
};

export function isReportPeriodKey(v: unknown): v is ReportPeriodKey {
  return typeof v === "string" && (REPORT_PERIOD_KEYS as readonly string[]).includes(v);
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 864e5));
/** The 1st of the month `back` months before the month `s` falls in. */
const monthStartBack = (s: string, back: number) => {
  const d = day(s);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)));
};

/**
 * Resolve a report period against today in India. An unknown key falls back
 * to the report's own default; a custom range with a bad date falls back too,
 * dates picked backwards are swapped and the end never passes today.
 */
export function resolveReportPeriod(
  key: string | undefined | null,
  opts: { from?: string | null; to?: string | null; today?: string; fallback: ReportPeriodKey },
): ReportPeriod {
  const today = opts.today ?? indiaToday();
  const k: ReportPeriodKey = isReportPeriodKey(key) ? key : opts.fallback;
  const done = (key: ReportPeriodKey, from: string, to: string): ReportPeriod => {
    const name = REPORT_PERIOD_NAMES[key];
    if (key === "all") return { key, from, to, name, label: name, unbounded: true };
    return { key, from, to, name, label: `${name} (${formatRange(from, to)})`, unbounded: false };
  };

  switch (k) {
    case "all":
      return done("all", ALL_TIME_FROM, today);
    case "last_30":
      return done(k, addDays(today, -29), today);
    case "last_90":
      return done(k, addDays(today, -89), today);
    case "last_6m":
      return done(k, monthStartBack(today, 5), today);
    case "last_12m":
      return done(k, monthStartBack(today, 11), today);
    case "custom": {
      const ok = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(day(v).getTime());
      if (!ok(opts.from) || !ok(opts.to)) {
        return resolveReportPeriod(opts.fallback === "custom" ? "last_30" : opts.fallback, { today, fallback: "last_30" });
      }
      let [from, to] = opts.from <= opts.to ? [opts.from, opts.to] : [opts.to, opts.from];
      if (to > today) to = today;
      if (from > to) from = to;
      return done("custom", from, to);
    }
    default: {
      // today · week · month · last_month · quarter · fy · last_fy — the dashboards' own maths.
      const p = resolvePeriod(isDashPeriod(k) ? k : "month", { today });
      return done(k, p.from, p.to);
    }
  }
}
