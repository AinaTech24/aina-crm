/**
 * The pure half of the calculator growth chart: the one place a chart spec is
 * checked, the y-axis scale, the Indian axis labels (₹ L / ₹ Cr), the end-label
 * layout and the series colours. GrowthChart.tsx only draws what this returns,
 * so all of it is testable without a renderer.
 */

import type { ChartLine, ChartSpec, ResultBlock } from "./types";

/**
 * Series colours — the web calculators' CalcChart suite (lib/dashboard/chart-palette
 * CHART_SERIES: blue, green, amber, then purple), as resolved hex. Mid-tones, so a
 * line reads on a white card and on a dark one. Invested is the web's slate.
 */
export const CHART_COLORS = {
  value: ["#3B82F6", "#22C55E", "#F59E0B", "#A855F7"],
  invested: ["#94A3B8", "#64748B"],
} as const;

/** The most lines one phone-width chart carries before it stops being readable. */
export const MAX_LINES = 4;

/**
 * A chart block for a compute, or nothing. Dropped (never drawn wrong) when it
 * has fewer than two points, x that does not rise, a line whose length differs
 * from x, any value that is not finite, or nothing but zeros. All-zero lines
 * are left out.
 */
export function chartBlock(xLabel: string, x: number[], lines: ChartLine[]): ResultBlock[] {
  if (x.length < 2 || x.some((n, i) => !Number.isFinite(n) || (i > 0 && n <= x[i - 1]))) return [];
  const kept: ChartLine[] = [];
  for (const l of lines) {
    if (l.values.length !== x.length) return [];
    if (l.values.some((n) => !Number.isFinite(n))) return [];
    if (l.values.some((n) => n !== 0)) kept.push({ ...l, role: l.role ?? "value" });
  }
  if (!kept.some((l) => l.role === "value")) return [];
  const chart: ChartSpec = { xLabel, x, lines: kept.slice(0, MAX_LINES) };
  return [{ type: "chart", chart }];
}

/** Running total: [a, b, c] → [a, a+b, a+b+c]. */
export function cumulative(values: number[]): number[] {
  let s = 0;
  return values.map((v) => (s += v));
}

/** 2.50 → "2.5", 3.00 → "3", 1.234 → "1.23". */
const trim = (n: number, d: number): string => {
  const t = n.toFixed(d);
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
};

/** Indian compact rupees for an axis or an end label: ₹0 · ₹850 · ₹45k · ₹12.5 L · ₹1.25 Cr. */
export function axisInr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7, 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5, 2)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3, 1)}k`;
  return `${sign}₹${Math.round(a)}`;
}

/** A 1 / 2 / 2.5 / 5 × 10ⁿ step that splits `span` into about `count` parts. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

/** Y-axis ticks from a round floor (0 unless a value is negative) to a round ceiling above the max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (!(hi > lo)) return [0, 1];
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  return ticks;
}

/** About `count` evenly spaced x values to label, always the first and the last. */
export function xTickIndexes(n: number, count = 5): number[] {
  if (n <= 0) return [];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (count - 1);
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(Math.round(k * step));
  return [...out].sort((a, b) => a - b);
}

/**
 * Vertical positions for the end labels: each wants to sit at its line's last
 * point; overlapping ones are pushed apart by `gap`, then the whole stack is
 * kept inside [top, bottom].
 */
export function spreadLabels(wanted: number[], gap: number, top: number, bottom: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const o of order) {
    const prev = placed.length ? placed[placed.length - 1] : -Infinity;
    placed.push(Math.max(o.y, prev + gap));
  }
  // Then up from the bottom: nothing below `bottom`, each still `gap` above the next.
  for (let k = placed.length - 1; k >= 0; k--) {
    const cap = k === placed.length - 1 ? bottom : placed[k + 1] - gap;
    placed[k] = Math.min(placed[k], cap);
  }
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k], top + k * gap);
  const out = new Array<number>(wanted.length);
  order.forEach((o, k) => { out[o.i] = placed[k]; });
  return out;
}

/** The colour of every line, in order: value lines take the value palette, invested lines the slate pair. */
export function lineColors(lines: ChartLine[]): string[] {
  let v = 0, inv = 0;
  return lines.map((l) => (l.role === "invested"
    ? CHART_COLORS.invested[inv++ % CHART_COLORS.invested.length]
    : CHART_COLORS.value[v++ % CHART_COLORS.value.length]));
}

/** An x value as printed: 7 → "7", 7.27 → "7.3". */
export const fmtX = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** What a screen reader says for the chart: each line from its first to its last value. */
export function chartSummary(spec: ChartSpec): string {
  const first = fmtX(spec.x[0]);
  const last = fmtX(spec.x[spec.x.length - 1]);
  const parts = spec.lines.map((l) => `${l.label}: ${axisInr(l.values[0])} at ${spec.xLabel.toLowerCase()} ${first}, ${axisInr(l.values[l.values.length - 1])} at ${spec.xLabel.toLowerCase()} ${last}`);
  return `Chart. ${parts.join("; ")}.`;
}
