"use client";

/**
 * §21 Investment flow — gross purchase, redemption and net business by month,
 * for one product at a time, from Business Entries (the only source that
 * records SIF, AIF and PMS and an explicit asset class).
 *
 * Bars go UP for money in and DOWN for money out from a zero line, and the net
 * is a line of its own — a redemption is drawn as what it is, not coloured as
 * a failure (§20: "do not label all redemption as negative"). Recharts, like
 * every other chart on the dashboards; paints are RESOLVED hex from
 * chart-palette.ts, never hsl(var(--token)), which renders black in an SVG
 * paint attribute when it does not resolve.
 */

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FlowByMonth, FlowProduct } from "@/lib/dashboard/my/desk";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartMount } from "../ChartMount";

const PRODUCTS: Array<{ key: FlowProduct; label: string }> = [
  { key: "all_mf", label: "Mutual fund" },
  { key: "equity", label: "Equity" },
  { key: "debt", label: "Debt" },
  { key: "liquid", label: "Liquid" },
  { key: "sif", label: "SIF" },
  { key: "aif", label: "AIF" },
  { key: "pms", label: "PMS" },
  { key: "other", label: "Other" },
];

export function FlowChart({ data }: { data: FlowByMonth }) {
  const [product, setProduct] = useState<FlowProduct>("all_mf");
  if (!data.months) {
    return (
      <section className="card-surface p-5 sm:p-6" aria-label="Investment flow">
        <h2 className="section-title flex items-center gap-2"><ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden /> Investment flow</h2>
        <p className="mt-3 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2.5 text-2xs text-muted-foreground">
          No business entry has ever been recorded for your book, so there is no product split to chart. The split
          comes from Business Entries; the business trend above uses the RTA feed.
        </p>
      </section>
    );
  }
  const s = data.series[product];
  // Redemption is plotted below the zero line, so it is stored negative here
  // and shown as the amount it is in the tooltip.
  const rows = s.map((m, i) => ({ m: data.months![i], purchase: m.purchase, redemption: -m.redemption, net: m.purchase - m.redemption }));
  const sum = (f: { purchase: number; redemption: number }) => ({ gross: f.purchase, red: f.redemption, net: f.purchase - f.redemption });
  const mtd = sum(data.mtd[product]), fytd = sum(data.fytd[product]);
  const empty = s.every((m) => m.purchase === 0 && m.redemption === 0);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Investment flow">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden /> Investment flow
          </h2>
          <p className="section-subtitle mt-1">Gross purchase, redemption and net business by month — {PRODUCTS.find((p) => p.key === product)?.label}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Product">
          {PRODUCTS.map((p) => (
            <button key={p.key} type="button" onClick={() => setProduct(p.key)} aria-pressed={product === p.key}
              className={cn("inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                product === p.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-2 text-2xs sm:grid-cols-6">
        {([["MTD gross", mtd.gross], ["MTD redemption", mtd.red], ["MTD net", mtd.net],
           ["FYTD gross", fytd.gross], ["FYTD redemption", fytd.red], ["FYTD net", fytd.net]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-secondary/70 px-2.5 py-1.5">
            <dt className="text-muted-foreground">{l}</dt>
            <dd className={cn("font-semibold tabular-nums", l.endsWith("net") && v < 0 ? "text-warning-foreground" : "text-foreground")}>{formatMoney(v)}</dd>
          </div>
        ))}
      </dl>

      {empty ? (
        <p className="dash-empty">
          No {PRODUCTS.find((p) => p.key === product)?.label} business recorded this financial year.
        </p>
      ) : (
        <ChartMount className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {/* One stack with a sign offset: purchase rises from the zero line, redemption hangs below it, in the same month slot. */}
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} stackOffset="sign">
              <CartesianGrid stroke={CHART_INK.grid} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} width={76}
                     tickFormatter={(v: number) => formatMoney(Math.abs(v), { decimals: 1 })} />
              <ReferenceLine y={0} stroke={CHART_INK.reference} strokeOpacity={0.35} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: CHART_INK.cursor }}
                formatter={(v, name) => [formatMoney(Math.abs(Number(v))), name === "purchase" ? "Purchase" : name === "redemption" ? "Redemption" : "Net"]}
              />
              <Bar dataKey="purchase" name="purchase" stackId="flow" fill={CHART.blue} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="redemption" name="redemption" stackId="flow" fill={CHART.slate} radius={[0, 0, 4, 4]} maxBarSize={28} isAnimationActive={false} />
              <Line dataKey="net" name="net" type="monotone" stroke={CHART.ink} strokeWidth={1.5} strokeDasharray="3 3"
                    dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartMount>
      )}
      <p className="mt-2 flex flex-wrap gap-x-4 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: CHART.blue }} aria-hidden /> Purchase</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: CHART.slate }} aria-hidden /> Redemption</span>
        <span className="inline-flex items-center gap-1"><span className="h-px w-4 border-t border-dashed" style={{ borderColor: CHART.ink }} aria-hidden /> Net</span>
        <span>From Business Entries (confirmed and e-mailed); switch and STP count as purchase into the target product.</span>
      </p>
    </section>
  );
}
