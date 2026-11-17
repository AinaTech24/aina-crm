/**
 * Daily rolling returns on a scheme's real NAV history.
 *
 * Every NAV date d on or after the chosen start begins one window that ends
 * N calendar years later (d + N years; 29 Feb → 28 Feb). The end NAV is the
 * latest one on or before that date (valuation rule, nav.ts). A window whose
 * end is after the scheme's last NAV is not formed. Each window's return is
 * annualised over exactly N years: (NAV_end ÷ NAV_start)^(1/N) − 1.
 *
 * Distribution bands, lower bound inclusive: negative (< 0), 0–8, 8–10,
 * 10–12, 12–15, 15–20 and 20 % or more.
 */

import { type NavSeries, type Outcome, addYears, dmy, fail, lastNav, mean, median, navOnOrBefore } from "./nav";

export const ROLLING_WINDOWS = [1, 2, 3, 5, 7, 10] as const;

export const ROLLING_BANDS = [
  { key: "neg", label: "Below 0%", lo: -Infinity, hi: 0 },
  { key: "b0_8", label: "0–8%", lo: 0, hi: 8 },
  { key: "b8_10", label: "8–10%", lo: 8, hi: 10 },
  { key: "b10_12", label: "10–12%", lo: 10, hi: 12 },
  { key: "b12_15", label: "12–15%", lo: 12, hi: 15 },
  { key: "b15_20", label: "15–20%", lo: 15, hi: 20 },
  { key: "b20", label: "20% and above", lo: 20, hi: Infinity },
] as const;

export type RollingWindow = { start: string; end: string; returnPct: number };

export type RollingReturns = {
  years: number;
  windows: RollingWindow[];
  count: number;
  averagePct: number;
  medianPct: number;
  max: RollingWindow;
  min: RollingWindow;
  negativePct: number;
  /** Share of windows in each band, %, in ROLLING_BANDS order. */
  bands: Array<{ key: string; label: string; count: number; pct: number }>;
};

export function rollingReturns(s: NavSeries, inp: { startDate: string; years: number }): Outcome<RollingReturns> {
  const last = lastNav(s);
  if (!last) return fail("No NAV history for this scheme.");
  const n = inp.years;
  if (!(n > 0)) return fail("Choose a rolling period.");
  const windows: RollingWindow[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const d = s.dates[i];
    if (d < inp.startDate) continue;
    const endDate = addYears(d, n);
    if (endDate > last.date) break;
    const end = navOnOrBefore(s, endDate);
    if (!end || end.index <= i) continue;
    windows.push({ start: d, end: end.date, returnPct: (Math.pow(end.nav / s.navs[i], 1 / n) - 1) * 100 });
  }
  if (!windows.length) {
    return fail(`Not enough history: a ${n}-year window from ${dmy(inp.startDate)} needs NAVs until ${dmy(addYears(inp.startDate, n))} (last NAV ${dmy(last.date)}).`);
  }
  const rs = windows.map((w) => w.returnPct);
  let max = windows[0];
  let min = windows[0];
  for (const w of windows) {
    if (w.returnPct > max.returnPct) max = w;
    if (w.returnPct < min.returnPct) min = w;
  }
  const bands = ROLLING_BANDS.map((b) => {
    const count = rs.filter((r) => r >= b.lo && r < b.hi).length;
    return { key: b.key, label: b.label, count, pct: (count / rs.length) * 100 };
  });
  return {
    ok: true,
    years: n,
    windows,
    count: windows.length,
    averagePct: mean(rs),
    medianPct: median(rs),
    max,
    min,
    negativePct: bands[0].pct,
    bands,
  };
}
