/**
 * Chart colours as RESOLVED hex, not CSS variables.
 *
 * Recharts writes colours into SVG presentation attributes (`fill="…"`). A
 * `hsl(var(--chart-2))` there only works if the stylesheet the browser is
 * holding defines that variable at paint time; when it does not — a stale
 * dev stylesheet, a print context, an email screenshot — the attribute fails
 * to parse and SVG falls back to BLACK. That is exactly what shipped: black
 * bars, a black donut. A chart must never depend on the cascade for its ink.
 *
 * These are the reference palette values, fixed by design: indigo donut,
 * blue bars, green line, amber, red, slate.
 */
export const CHART = {
  indigo: "#6366F1",
  blue: "#3B82F6",
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444",
  slate: "#94A3B8",
} as const;

/** Ordered series palette for multi-slice charts. */
export const CHART_SERIES = [CHART.indigo, CHART.blue, CHART.green, CHART.amber, CHART.slate] as const;

/** Chrome around the data: gridlines, tick labels, hover cursor, tooltip. */
export const CHART_INK = {
  grid: "#E5E7EB",
  tick: "#6B7280",
  cursor: "#F3F4F6",
  reference: "#374151",
  tooltipBorder: "#E5E7EB",
  tooltipBg: "#FFFFFF",
} as const;

export const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: `1px solid ${CHART_INK.tooltipBorder}`,
  background: CHART_INK.tooltipBg,
  fontSize: 12,
} as const;
