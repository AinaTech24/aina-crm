"use client";

/**
 * Business trend — one line per financial year, flows and balances.
 *
 * A client component holding ALL the series, because the server already
 * computed them in one pass. Switching metric is then instant and costs no
 * round trip; making it a URL param would have meant every aggregate
 * re-running to redraw one line.
 *
 * Two kinds of line, and they are read differently:
 *
 *   flows     money that moved in each month. The legend carries the year's
 *             TOTAL, and a missing month is a real zero.
 *   balances  AUM and SIP book at each month's last recorded snapshot. The
 *             legend carries the LATEST value, and a month with no snapshot is
 *             a GAP in the line — balances are recorded forward and cannot be
 *             rebuilt, so an unrecorded month is unknown, never ₹0.
 *
 * Values keep their sign. Net SIP and net business go negative in a bad month,
 * and the first version plotted |value|, so a month that LOST ₹3 L drew exactly
 * like one that gained it. The axis now runs from the lowest value (or zero) to
 * the highest, with a baseline at zero.
 *
 * Drawn with Recharts like the Owner Dashboard's charts, so the six
 * dashboards share one chart grammar (gridlines, tick size, tooltip). It used
 * to be a hand-drawn SVG in a fixed viewBox that the browser scaled to the
 * card, which made the month labels half again as large as every other label
 * on the page. Paints are RESOLVED hex from chart-palette.ts — an unresolved
 * `hsl(var(--token))` in an SVG paint attribute renders black, silently.
 */

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TREND_METRICS, type MyTrend, type TrendMetricKey } from "@/lib/dashboard/my/kpis";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartMount } from "../ChartMount";

type BalanceKey = "aum" | "sip_book";
type MetricKey = TrendMetricKey | BalanceKey;
type Meta = { key: MetricKey; label: string; format: "currency" | "count"; inverse?: boolean; balance?: boolean };

const BALANCE_METRICS: Meta[] = [
  { key: "aum", label: "AUM", format: "currency", balance: true },
  { key: "sip_book", label: "SIP book", format: "currency", balance: true },
];

/**
 * Open on net business — unless net business has nothing in it, in which case
 * open on the first metric that does. A chart whose default view is "Nothing
 * recorded" reads as broken rather than as empty.
 */
function firstMetricWithData(trend: MyTrend): MetricKey {
  const has = (k: TrendMetricKey) =>
    trend.series[k].current.some((v) => v !== 0) || trend.series[k].previous.some((v) => v !== 0);
  if (has("net_business")) return "net_business";
  return TREND_METRICS.find((m) => has(m.key))?.key ?? "net_business";
}

export function MyTrendChart({
  trend,
  title = "My business trend",
  showBalances = false,
}: {
  trend: MyTrend;
  title?: string;
  /** Offer AUM and SIP book as well as the flows (the branch brief asks for both). */
  showBalances?: boolean;
}) {
  const metrics: Meta[] = [...(showBalances ? BALANCE_METRICS : []), ...(TREND_METRICS as readonly Meta[])];
  const [metric, setMetric] = useState<MetricKey>(() => firstMetricWithData(trend));
  const [showPrev, setShowPrev] = useState(true);

  const meta = metrics.find((m) => m.key === metric) ?? metrics[0];
  const isBalance = !!meta.balance;
  const cur: Array<number | null> = isBalance
    ? trend.balances[meta.key as BalanceKey].current
    : trend.series[meta.key as TrendMetricKey].current;
  const prev: Array<number | null> = isBalance
    ? trend.balances[meta.key as BalanceKey].previous
    : trend.series[meta.key as TrendMetricKey].previous;
  const fmt = (n: number) => (meta.format === "count" ? formatCount(n) : formatMoney(n));

  const shown = (showPrev ? [...cur, ...prev] : cur).filter((v): v is number => v != null);
  const data = trend.months.map((m, i) => ({ m, cur: cur[i], prev: showPrev ? prev[i] : null }));
  const short = (n: number) => (meta.format === "count" ? formatCount(n) : formatMoney(n, { decimals: 1 }));

  // The legend figure: a year's TOTAL for a flow, the LATEST value for a balance.
  const lastOf = (xs: Array<number | null>) => {
    for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return { v: xs[i] as number, i };
    return null;
  };
  const curLast = lastOf(cur);
  // Like for like. A flow compares the same months of each year (April to the
  // current month); a balance compares the same month-end. The dashed line
  // still shows the whole of last year for context.
  const elapsed = Math.min(12, Math.max(1, trend.monthsElapsed ?? 12));
  const sameMonths = `Apr–${trend.months[elapsed - 1]}`;
  const curFig = isBalance ? curLast?.v ?? null : cur.slice(0, elapsed).reduce<number>((s, v) => s + (v ?? 0), 0);
  const prevFig = isBalance
    ? curLast ? prev[curLast.i] ?? null : null
    : prev.slice(0, elapsed).reduce<number>((s, v) => s + (v ?? 0), 0);
  const noBalances = isBalance && !trend.balancesSince;
  const everything = shown.length === 0 || shown.every((v) => v === 0);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <TrendingUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {title}
          </h2>
          <p className="section-subtitle mt-1">
            {meta.label} {isBalance ? "at each month-end" : "month by month"}, {trend.fyLabel} against {trend.prevFyLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              aria-pressed={m.key === metric}
              className={cn(
                "inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                m.key === metric
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-primary" aria-hidden />
          <span className="text-muted-foreground">{trend.fyLabel} · {isBalance ? "latest" : sameMonths}</span>
          <span className="font-semibold tabular-nums text-foreground">{curFig == null ? "—" : fmt(curFig)}</span>
        </span>
        <button
          type="button"
          onClick={() => setShowPrev((v) => !v)}
          aria-pressed={showPrev}
          className="inline-flex min-h-6 items-center gap-1.5 rounded px-1 hover:bg-accent"
        >
          <span className={cn("h-0.5 w-5 rounded", showPrev ? "bg-muted-foreground" : "bg-border")} aria-hidden />
          <span className="text-muted-foreground">{trend.prevFyLabel} · {isBalance ? "same month" : sameMonths}</span>
          <span className="font-semibold tabular-nums text-foreground">{prevFig == null ? "—" : fmt(prevFig)}</span>
        </button>
        {curFig != null && prevFig != null && prevFig !== 0 && (
          <span
            className={cn(
              "font-medium tabular-nums",
              // Up is not always good — for redemption and stopped SIPs it is
              // the wrong direction, so the tone follows the metric.
              (curFig >= prevFig) === !meta.inverse ? "text-success" : "text-destructive",
            )}
          >
            {curFig >= prevFig ? "+" : "−"}
            {(Math.abs((curFig - prevFig) / prevFig) * 100).toFixed(1)}% on the same months last year
          </span>
        )}
      </div>

      {noBalances ? (
        <p className="dash-empty">
          No month-end balance has been recorded for this book yet. {meta.label} history is
          recorded nightly from now on — it cannot be rebuilt for months already gone, so the line
          fills in as the months pass.
        </p>
      ) : everything ? (
        <p className="dash-empty">
          Nothing recorded for {meta.label.toLowerCase()} in either year.
        </p>
      ) : (
        <ChartMount className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="my-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={CHART.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_INK.grid} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} width={76} tickFormatter={short} />
              <ReferenceLine y={0} stroke={CHART_INK.reference} strokeOpacity={0.35} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ stroke: CHART_INK.grid }}
                formatter={(v, name) => [v == null ? "—" : fmt(Number(v)), name === "cur" ? trend.fyLabel : trend.prevFyLabel]}
              />
              {showPrev && (
                <Line dataKey="prev" name="prev" type="monotone" stroke={CHART.slate} strokeWidth={1.5} strokeDasharray="4 3"
                      dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
              )}
              <Area dataKey="cur" name="cur" type="monotone" stroke={CHART.blue} strokeWidth={2.5} fill="url(#my-trend-fill)"
                    baseValue={0} dot={{ r: 3, fill: "#FFFFFF", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartMount>
      )}

      <p className="mt-3 text-2xs text-muted-foreground">
        The axis is always April to March, so the same month sits in the same place every year.
        Hover a point for its value.
        {isBalance && trend.balancesSince && ` Balances recorded since ${formatDate(trend.balancesSince)}; months before that are gaps, not zeros.`}
      </p>
    </section>
  );
}
