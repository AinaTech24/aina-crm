/**
 * Calendar-year, quarterly and monthly returns from a scheme's real NAVs.
 *
 * A period's return is NAV at its end ÷ NAV at the previous period's end − 1,
 * each "end" being the latest NAV on or before the last calendar day
 * (valuation rule, nav.ts). Two partial periods are flagged, never hidden:
 *   since_launch — the scheme launched inside the period; it runs from the
 *                  first NAV;
 *   to_date      — the period has not ended; it runs to the latest NAV.
 * A period with no NAV of its own (nothing published since the previous end)
 * has no return (null), not 0.
 */

import { type NavSeries, daysInMonth, firstNav, lastNav, navOnOrBefore } from "./nav";

export type PeriodKind = "year" | "quarter" | "month";

export type PeriodReturn = {
  year: number;
  /** 1–12 for months, 1–4 for quarters, 0 for a year. */
  period: number;
  fromDate: string;
  fromNav: number;
  toDate: string;
  toNav: number;
  returnPct: number;
  partial: "since_launch" | "to_date" | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Last calendar day of (year, period) for the kind. */
function periodEnd(kind: PeriodKind, year: number, period: number): string {
  if (kind === "year") return `${year}-12-31`;
  const month = kind === "quarter" ? period * 3 : period;
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

function prev(kind: PeriodKind, year: number, period: number): [number, number] {
  if (kind === "year") return [year - 1, 0];
  const n = kind === "quarter" ? 4 : 12;
  return period === 1 ? [year - 1, n] : [year, period - 1];
}

function periodOf(kind: PeriodKind, iso: string): [number, number] {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return kind === "year" ? [y, 0] : kind === "quarter" ? [y, Math.ceil(m / 3)] : [y, m];
}

function next(kind: PeriodKind, year: number, period: number): [number, number] {
  if (kind === "year") return [year + 1, 0];
  const n = kind === "quarter" ? 4 : 12;
  return period === n ? [year + 1, 1] : [year, period + 1];
}

/** Every period's return from the scheme's launch to its latest NAV, oldest first. */
export function periodReturns(s: NavSeries, kind: PeriodKind): PeriodReturn[] {
  const first = firstNav(s);
  const last = lastNav(s);
  if (!first || !last) return [];
  const out: PeriodReturn[] = [];
  let [y, p] = periodOf(kind, first.date);
  const [ly, lp] = periodOf(kind, last.date);
  while (y < ly || (y === ly && p <= lp)) {
    const [py, pp] = prev(kind, y, p);
    const startHit = navOnOrBefore(s, periodEnd(kind, py, pp));
    const from = startHit ?? first;
    const endIso = periodEnd(kind, y, p);
    const to = navOnOrBefore(s, endIso);
    if (to && to.index > from.index) {
      out.push({
        year: y,
        period: p,
        fromDate: from.date,
        fromNav: from.nav,
        toDate: to.date,
        toNav: to.nav,
        returnPct: (to.nav / from.nav - 1) * 100,
        partial: !startHit ? "since_launch" : last.date < endIso ? "to_date" : null,
      });
    }
    [y, p] = next(kind, y, p);
  }
  return out;
}

export type ReturnGrid = {
  kind: "month" | "quarter";
  /** Newest year first; `cells[i]` is month / quarter i+1 (null = no return). */
  rows: Array<{ year: number; cells: Array<PeriodReturn | null>; yearReturn: PeriodReturn | null }>;
};

/** Year × month (or quarter) matrix with the calendar-year return beside it. */
export function returnGrid(s: NavSeries, kind: "month" | "quarter"): ReturnGrid {
  const n = kind === "month" ? 12 : 4;
  const per = periodReturns(s, kind);
  const years = periodReturns(s, "year");
  const byYear = new Map<number, Array<PeriodReturn | null>>();
  for (const r of per) {
    if (!byYear.has(r.year)) byYear.set(r.year, Array.from({ length: n }, () => null));
    (byYear.get(r.year) as Array<PeriodReturn | null>)[r.period - 1] = r;
  }
  const rows = [...byYear.keys()].sort((a, b) => b - a).map((year) => ({
    year,
    cells: byYear.get(year) as Array<PeriodReturn | null>,
    yearReturn: years.find((r) => r.year === year) ?? null,
  }));
  return { kind, rows };
}
