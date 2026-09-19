"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";

/**
 * Annual targets as flat bars of percent-achieved, with a dashed reference line
 * where the calendar says each bar should have reached. Green past the line,
 * amber within reach, red behind. Resolved hex throughout.
 */
export function TargetBarChart({
  data,
  expectedPct,
}: {
  data: Array<{ name: string; pct: number; value: string; target: string }>;
  expectedPct: number;
}) {
  const tone = (pct: number) => {
    if (pct >= 100 || expectedPct < 10 || pct / expectedPct >= 0.9) return CHART.green;
    if (pct / expectedPct >= 0.7) return CHART.amber;
    return CHART.red;
  };
  return (
    <ChartMount className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="32%">
          <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="3 3" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK.tick }} interval={0} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: CHART_INK.tick }}
          />
          <Tooltip
            cursor={{ fill: CHART_INK.cursor }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, _name, item) => {
              const p = (item as { payload?: { value?: string; target?: string } }).payload;
              return [`${Number(value ?? 0)}% · ${p?.value ?? ""} of ${p?.target ?? ""}`, ""];
            }}
          />
          <ReferenceLine
            y={expectedPct}
            stroke={CHART_INK.reference}
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            label={{ value: `${expectedPct}% of year`, position: "insideTopRight", fontSize: 10, fill: CHART_INK.tick }}
          />
          <Bar dataKey="pct" maxBarSize={56}>
            {data.map((d) => (
              <Cell key={d.name} fill={tone(d.pct)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
