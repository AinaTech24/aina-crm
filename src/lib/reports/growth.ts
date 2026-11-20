/**
 * Period-on-period growth for a summary report grouped by date first — We Care's
 * "MoM %" (2026-11-20): this month's first total against the month before.
 *
 * Opt-in per report (`summary.growth`). Growth is only stated when it means
 * something: the previous period must be in the result and its value above
 * zero. A missing month, a zero or a negative net reads as "—", never as a
 * percentage of nothing.
 */

import type { DateGrain } from "./grouping";

/** The bucket key just before `key` at this grain, or null when it has none. */
export function previousBucket(grain: DateGrain | null | undefined, key: string): string | null {
  if (grain === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  }
  if (grain === "year") {
    return /^\d{4}$/.test(key) ? String(Number(key) - 1) : null;
  }
  if (grain === "fy") {
    const m = /^FY (\d{4})-\d{2}$/.exec(key);
    if (!m) return null;
    const s = Number(m[1]) - 1;
    return `FY ${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  }
  if (grain === "quarter") {
    const m = /^FY (\d{4})-\d{2} Q([1-4])$/.exec(key);
    if (!m) return null;
    const s = Number(m[1]);
    const q = Number(m[2]);
    if (q > 1) return `FY ${s}-${String((s + 1) % 100).padStart(2, "0")} Q${q - 1}`;
    return `FY ${s - 1}-${String(s % 100).padStart(2, "0")} Q4`;
  }
  return null;
}

/** Growth in percent, one decimal; null when the base is missing, zero or negative. */
export function growthPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Growth of each top-level group's FIRST total against the previous period's, by key. */
export function growthByKey(grain: DateGrain | null | undefined, roots: { key: string; aggregates: number[] }[]): Record<string, number | null> {
  const value = new Map(roots.map((r) => [r.key, r.aggregates[0]]));
  const out: Record<string, number | null> = {};
  for (const r of roots) {
    const prev = previousBucket(grain, r.key);
    out[r.key] = prev == null ? null : growthPct(r.aggregates[0] ?? 0, value.get(prev));
  }
  return out;
}

/** "+12.7%" / "−4.0%" / "—". */
export function formatGrowth(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v === 0) return "0.0%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}
