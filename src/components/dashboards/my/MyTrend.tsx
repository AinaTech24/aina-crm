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
 * Drawn as an inline SVG rather than with Recharts: two polylines and twelve
 * labels. The one rule this inherits from the repo either way: SVG geometry
 * takes RESOLVED colours, never `hsl(var(--token))` — an unresolved custom
 * property in a `stroke` paints black, silently. Here the paints are Tailwind
 * classes on `currentColor`, which resolve normally.
 */

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { TREND_METRICS, type MyTrend, type TrendMetricKey } from "@/lib/dashboard/my/kpis";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const W = 720;
const H = 190;
const PAD = { top: 14, right: 12, bottom: 24, left: 8 };

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
  const lo = Math.min(0, ...shown);
  const hi0 = Math.max(0, ...shown);
  const hi = hi0 === lo ? lo + 1 : hi0;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / 11) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  /** A polyline that lifts the pen over unrecorded months. */
  const path = (data: Array<number | null>) => {
    let d = "";
    let pen = false;
    data.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

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
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          No month-end balance has been recorded for this book yet. {meta.label} history is
          recorded nightly from now on — it cannot be rebuilt for months already gone, so the line
          fills in as the months pass.
        </p>
      ) : everything ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          Nothing recorded for {meta.label.toLowerCase()} in either year.
        </p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
             aria-label={`${meta.label} by month, ${trend.fyLabel} versus ${trend.prevFyLabel}`}>
          {/* The zero line only. Gridlines behind twelve points are chart junk. */}
          <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)}
                className="stroke-border" strokeWidth={1} />
          {showPrev && (
            <path d={path(prev)} fill="none" className="stroke-muted-foreground/45"
                  strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          <path d={path(cur)} fill="none" className="stroke-primary" strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
          {cur.map((v, i) => v == null ? null : (
            <g key={i}>
              <circle cx={x(i)} cy={y(v)} r={v === 0 ? 1.5 : 3} className={v < 0 ? "fill-destructive" : "fill-primary"} />
              <title>{`${trend.months[i]} · ${fmt(v)}`}</title>
            </g>
          ))}
          {/* `fill-current` + a text colour, never `fill-[hsl(var(--token))]`.
              An unresolved custom property in an SVG paint attribute renders
              BLACK with no error — it has shipped that way in this repo before.
              And `text-2xs` rather than an arbitrary size: arbitrary Tailwind
              values are dropped silently here, which would leave the labels at
              the browser default. */}
          {trend.months.map((m, i) => (
            <text key={m} x={x(i)} y={H - 6} textAnchor="middle"
                  className="fill-current text-2xs text-muted-foreground">
              {m}
            </text>
          ))}
        </svg>
      )}

      <p className="mt-3 text-2xs text-muted-foreground">
        The axis is always April to March, so the same month sits in the same place every year.
        Hover a point for its value.
        {isBalance && trend.balancesSince && ` Balances recorded since ${formatDate(trend.balancesSince)}; months before that are gaps, not zeros.`}
      </p>
    </section>
  );
}
