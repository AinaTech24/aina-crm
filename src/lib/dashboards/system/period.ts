/**
 * The dashboard Period filter — pure and client-safe (no DB, no "use client").
 *
 * One list for every dashboard: Today, This week, This month, Last month,
 * This quarter, This FY, Last FY, Custom range. Resolved in INDIA time,
 * explicitly, whatever the server's clock zone is — production once ran UTC
 * and every "today" before 05:30 IST was yesterday.
 *
 * The button shows the resolved range ("This FY (1 Apr – 29 Sep 2026)") and
 * every card compares with the SAME period last year, which the dropdown says
 * once ("compared with same period last year") instead of a second date line
 * on the page.
 */

export const PERIOD_KEYS = ["today", "week", "month", "last_month", "quarter", "fy", "last_fy", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_NAMES: Record<PeriodKey, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  last_month: "Last month",
  quarter: "This quarter",
  fy: "This FY",
  last_fy: "Last FY",
  custom: "Custom range",
};

export type ResolvedPeriod = {
  key: PeriodKey;
  /** Inclusive India dates, yyyy-mm-dd. */
  from: string;
  to: string;
  /** "This FY" */
  name: string;
  /** "1 Apr – 29 Sep 2026" */
  range: string;
  /** "This FY (1 Apr – 29 Sep 2026)" */
  label: string;
  /** The same dates a year earlier. */
  prev: { from: string; to: string };
  /** 1 April of the FY the period ends in. */
  fyStart: string;
  /** 'YYYY-YY', the key FY targets are stored under. */
  fiscalYear: string;
  /** 0..1 through that FY at the period's end. */
  fyPace: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in India, yyyy-mm-dd. */
export function indiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A calendar day as a UTC-midnight Date — arithmetic only, never displayed raw. */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 864e5));
const ymd = (y: number, m: number, d: number) => iso(new Date(Date.UTC(y, m, d)));
const lastOfMonth = (y: number, m: number) => ymd(y, m + 1, 0);

/** The same calendar date a year earlier (29 Feb → 28 Feb). */
export function minusYear(s: string): string {
  const d = day(s);
  const y = d.getUTCFullYear() - 1;
  const m = d.getUTCMonth();
  const dd = Math.min(d.getUTCDate(), day(lastOfMonth(y, m)).getUTCDate());
  return ymd(y, m, dd);
}

/** 1 April of the FY a date falls in. */
export function fyStartOf(s: string): string {
  const d = day(s);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return ymd(y, 3, 1);
}

/** 'YYYY-YY' for the FY starting on `start`. */
export function fiscalYearKey(start: string): string {
  const y = Number(start.slice(0, 4));
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** "1 Apr – 29 Sep 2026"; one date when from = to; both years when they differ. */
export function formatRange(from: string, to: string): string {
  const a = day(from);
  const b = day(to);
  const f = (d: Date, withYear: boolean) =>
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
  if (from === to) return f(b, true);
  return `${f(a, a.getUTCFullYear() !== b.getUTCFullYear())} – ${f(b, true)}`;
}

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && (PERIOD_KEYS as readonly string[]).includes(v);
}

/**
 * Resolve a period key (and, for Custom, its dates) against today in India.
 * An unknown key or a bad custom range falls back to `fallback`.
 */
export function resolvePeriod(
  key: string | undefined | null,
  opts: { from?: string | null; to?: string | null; today?: string; fallback?: PeriodKey } = {},
): ResolvedPeriod {
  const today = opts.today ?? indiaToday();
  const k: PeriodKey = isPeriodKey(key) ? key : opts.fallback ?? "fy";
  const t = day(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  let from = today;
  let to = today;
  switch (k) {
    case "today":
      break;
    case "week": {
      // Monday-start working week.
      const dow = (t.getUTCDay() + 6) % 7;
      from = addDays(today, -dow);
      break;
    }
    case "month":
      from = ymd(y, m, 1);
      break;
    case "last_month":
      from = ymd(y, m - 1, 1);
      to = lastOfMonth(y, m - 1);
      break;
    case "quarter": {
      // India FY quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
      const qStartMonth = Math.floor(m / 3) * 3;
      from = ymd(y, qStartMonth, 1);
      break;
    }
    case "fy":
      from = fyStartOf(today);
      break;
    case "last_fy": {
      const start = fyStartOf(today);
      from = minusYear(start);
      to = addDays(start, -1);
      break;
    }
    case "custom": {
      let f = opts.from && ISO.test(opts.from) ? opts.from : null;
      let tt = opts.to && ISO.test(opts.to) ? opts.to : null;
      // Picked backwards, it is still the range meant; it cannot run past
      // today (there is nothing to count), and one that has not started yet
      // is no range at all.
      if (f && tt && tt < f) [f, tt] = [tt, f];
      if (!f || f > today) return resolvePeriod(opts.fallback ?? "fy", { today });
      from = f;
      to = tt && tt <= today ? tt : today;
      break;
    }
  }
  const fyStart = fyStartOf(to);
  const fyEnd = addDays(ymd(Number(fyStart.slice(0, 4)) + 1, 3, 1), -1); // 31 March
  const fyDays = (day(fyEnd).getTime() - day(fyStart).getTime()) / 864e5 + 1;
  const elapsed = (day(to).getTime() - day(fyStart).getTime()) / 864e5 + 1;
  const name = PERIOD_NAMES[k];
  const range = formatRange(from, to);
  return {
    key: k,
    from,
    to,
    name,
    range,
    label: k === "custom" ? range : `${name} (${range})`,
    prev: { from: minusYear(from), to: minusYear(to) },
    fyStart,
    fiscalYear: fiscalYearKey(fyStart),
    fyPace: Math.min(1, Math.max(0, elapsed / fyDays)),
  };
}
