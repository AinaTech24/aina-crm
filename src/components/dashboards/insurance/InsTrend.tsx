"use client";

/**
 * §2 — the FY month by month: new and renewal premium stacked, total on top,
 * and the same month of the previous FY as a line. Personal / Commercial /
 * Combined switch on the client; the rows already carry all three.
 * Fills are resolved hex (chart-palette.ts): an unresolved CSS variable in an
 * SVG fill paints black.
 */

import { TrendingUp } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/dashboard/insurance/business";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Axis ticks: ₹1.5 L, ₹3 L, ₹1.2 Cr — a rounded whole lakh would misstate the line. */
const tick = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(v % 1e7 ? 1 : 0)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)} L` : formatMoney(v);

type LineKey = "all" | "personal" | "commercial";

export function InsTrend({ points, fyLabel, pyLabel, lockedLine }: {
  points: TrendPoint[]; fyLabel: string; pyLabel: string;
  /** The dashboard's own line filter: the data is already one line, so the switch would only offer zeros. */
  lockedLine?: "personal" | "commercial" | null;
}) {
  const [picked, setLine] = useState<LineKey>("all");
  const line: LineKey = lockedLine ? "all" : picked;
  const data = points.map((p) => ({
    label: p.label,
    New: Math.round(p.cur[line].newAmt),
    Renewal: Math.round(p.cur[line].renAmt),
    [pyLabel]: Math.round(p.prevTotal[line]),
  }));
  const any = data.some((d) => d.New || d.Renewal || (d[pyLabel] as number));
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Insurance business trend">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="section-title flex items-center gap-2"><TrendingUp className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Insurance business trend</h2>
          <p className="section-subtitle mt-1">{fyLabel}, month by month — {lockedLine ? `${lockedLine === "personal" ? "Personal" : "Commercial"} Lines ` : ""}new and renewal premium, against {pyLabel}.</p>
        </div>
        {!lockedLine && <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Line">
          {([["all", "Combined"], ["personal", "Personal"], ["commercial", "Commercial"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={line === k} onClick={() => setLine(k)}
              className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium",
                line === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>}
      </div>
      {!any ? (
        <p className="dash-empty">No insurance business recorded in either year yet.</p>
      ) : (
        <div className="h-72 min-w-0 overflow-hidden">
          {/* First paint narrower than any phone: an 800px first paint made a mobile browser widen its
              layout viewport to fit, and the chart and the viewport chased each other. */}
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: CHART_INK.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: CHART_INK.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={72}
                tickFormatter={tick} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_INK.cursor }}
                formatter={(v) => formatMoney(Number(v ?? 0))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="New" stackId="p" fill={CHART.blue} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Renewal" stackId="p" fill={CHART.green} radius={[4, 4, 0, 0]} />
              <Line dataKey={pyLabel} type="monotone" stroke={CHART.slate} strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-3 text-2xs text-muted-foreground">
        Renewal premium includes renewals keyed as new policy rows and installments collected with “Mark renewed” from a policy&apos;s second year.
      </p>
    </section>
  );
}
