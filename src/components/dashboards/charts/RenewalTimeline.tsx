"use client";

/**
 * Renewals falling due, on a timeline: days from today across, one row per
 * line of business, each policy a bubble sized by its premium. The next
 * fortnight is shaded so the big, close ones are seen first.
 */

import { CartesianGrid, ReferenceArea, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";
import { ChartMount } from "../ChartMount";

export type RenewalPoint = { days: number; premium: number; line: string; client: string; product: string };

const LINE_COLOR = [CHART.indigo, CHART.blue, CHART.teal, CHART.amber, CHART.purple, CHART.slate];

export function RenewalTimeline({ points, horizon = 90, soon = 15 }: { points: RenewalPoint[]; horizon?: number; soon?: number }) {
  const lines = [...new Set(points.map((p) => p.line))];
  const maxPremium = Math.max(...points.map((p) => p.premium), 1);
  const height = 56 + lines.length * 44;
  return (
    <ChartMount className="w-full">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
            <ReferenceArea x1={0} x2={soon} fill={CHART.amber} fillOpacity={0.08} />
            <XAxis type="number" dataKey="days" domain={[0, horizon]} ticks={[0, 15, 30, 45, 60, 75, 90].filter((t) => t <= horizon)}
              tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => (v === 0 ? "Today" : `${v} d`)} />
            <YAxis type="category" dataKey="line" allowDuplicatedCategory={false} width={92}
              tick={{ fontSize: 12, fill: CHART_INK.reference }} tickLine={false} axisLine={false} />
            <ZAxis type="number" dataKey="premium" domain={[0, maxPremium]} range={[40, 700]} />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as RenewalPoint | undefined);
                if (!p) return null;
                return (
                  <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                    <div style={{ fontWeight: 600 }}>{p.client}</div>
                    <div>{p.product}</div>
                    <div style={{ color: CHART_INK.tick }}>{formatMoney(p.premium)} premium · {p.days === 0 ? "due today" : `due in ${p.days} day${p.days === 1 ? "" : "s"}`}</div>
                  </div>
                );
              }}
            />
            {lines.map((l, i) => (
              <Scatter key={l} name={l} data={points.filter((p) => p.line === l)} fill={LINE_COLOR[i % LINE_COLOR.length]}
                fillOpacity={0.75} stroke="#FFFFFF" strokeWidth={1.5} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </ChartMount>
  );
}
