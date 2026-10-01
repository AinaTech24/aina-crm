"use client";

/**
 * §43 claims received trend · §44 claim amount trend · §45 open-claim backlog.
 * The current FY month by month. Counts and amounts are separate charts —
 * never one axis for both. Personal / Commercial switch on the client; all
 * three cuts arrive computed. Fills are resolved hex (chart-palette.ts): an
 * unresolved CSS variable in an SVG fill paints black.
 */

import { TrendingUp } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthPoint } from "@/lib/dashboard/claims/review";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type LineKey = "all" | "personal" | "commercial";
const tick = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(v % 1e7 ? 1 : 0)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)} L` : formatMoney(v);

export function ClaimTrend({ points, fyLabel, lockedLine }: { points: MonthPoint[]; fyLabel: string; lockedLine: "personal" | "commercial" | null }) {
  const [picked, setPicked] = useState<LineKey>("all");
  const line: LineKey = lockedLine ? "all" : picked;
  const rows = points.map((p) => ({ label: p.label, partial: p.partial, ...p.lines[line] }));
  const counts = rows.map((r) => ({ label: r.label, Logged: r.logged, Settled: r.settled, "Open at month end": r.closing }));
  const amounts = rows.map((r) => ({ label: r.label, Claimed: Math.round(r.loggedAmt), Settled: Math.round(r.settledAmt), "Outstanding at month end": Math.round(r.closingAmt) }));
  const any = rows.some((r) => r.logged || r.settled || r.closing || r.opening);
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Claims trend">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="section-title flex items-center gap-2"><TrendingUp className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Claims trend and backlog</h2>
          <p className="section-subtitle mt-1">{fyLabel}, month by month{lockedLine ? ` — ${lockedLine === "personal" ? "Personal" : "Commercial"} Lines` : ""}. Counts and amounts on separate charts.</p>
        </div>
        {!lockedLine && (
          <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Line">
            {([["all", "All"], ["personal", "Personal"], ["commercial", "Commercial"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={line === k} onClick={() => setPicked(k)}
                className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium", line === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      {!any ? (
        <p className="dash-empty">No claim activity in {fyLabel} yet.</p>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">Claims · count</h3>
              <div className="h-64 min-w-0 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 256 }}>
                  <ComposedChart data={counts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: CHART_INK.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: CHART_INK.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_INK.cursor }} formatter={(v) => formatCount(Number(v ?? 0))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Logged" fill={CHART.blue} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Settled" fill={CHART.green} radius={[3, 3, 0, 0]} />
                    <Line dataKey="Open at month end" type="monotone" stroke={CHART.amber} strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">Claims · amount</h3>
              <div className="h-64 min-w-0 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 256 }}>
                  <ComposedChart data={amounts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: CHART_INK.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: CHART_INK.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={72} tickFormatter={tick} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_INK.cursor }} formatter={(v) => formatMoney(Number(v ?? 0))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Claimed" fill={CHART.blue} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Settled" fill={CHART.green} radius={[3, 3, 0, 0]} />
                    <Line dataKey="Outstanding at month end" type="monotone" stroke={CHART.amber} strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <h3 className="mb-1.5 mt-5 text-2xs font-semibold text-muted-foreground">Open-claim backlog</h3>
          <div className="table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th scope="col">Month</th><th scope="col" className="text-right">Opening open</th><th scope="col" className="text-right">New claims</th>
                  <th scope="col" className="text-right">Closed / settled</th><th scope="col" className="text-right">Closing open</th><th scope="col" className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.closing - r.opening;
                  return (
                    <tr key={r.label}>
                      <td className="py-2 text-xs font-medium">{r.label}{r.partial ? <span className="text-muted-foreground"> (to date)</span> : null}</td>
                      <td className="py-2 text-right text-xs tabular-nums">{formatCount(r.opening)}</td>
                      <td className="py-2 text-right text-xs tabular-nums">{formatCount(r.logged)}</td>
                      <td className="py-2 text-right text-xs tabular-nums" title={`${r.settled} settled · ${r.rejected} rejected · ${r.withdrawn} withdrawn`}>{formatCount(r.closed)}</td>
                      <td className="py-2 text-right text-xs font-medium tabular-nums">{formatCount(r.closing)}</td>
                      <td className={cn("py-2 text-right text-xs tabular-nums", d > 0 ? "text-warning-foreground" : "text-muted-foreground")}>{d === 0 ? "No change" : d > 0 ? `+${formatCount(d)}` : `−${formatCount(-d)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-2xs text-muted-foreground">
        Closed is settled, rejected or withdrawn. A claim closed without a settlement date or a status change on record is dated from its last edit.
      </p>
    </section>
  );
}
