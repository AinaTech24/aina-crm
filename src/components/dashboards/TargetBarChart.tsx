"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartMount } from "./ChartMount";

/**
 * Annual targets as a flat bar chart of percent-achieved per metric, with a
 * dashed reference line where the calendar says each bar should have reached.
 * Bars past the line are green, bars within reach are amber, the rest red —
 * the same pace bands the rings used, in the reference's chart language.
 */
export function TargetBarChart({
  data,
  expectedPct,
}: {
  data: Array<{ name: string; pct: number; value: string; target: string }>;
  expectedPct: number;
}) {
  const tone = (pct: number) => {
    if (pct >= 100 || expectedPct < 10 || pct / expectedPct >= 0.9) return "hsl(var(--chart-3))";
    if (pct / expectedPct >= 0.7) return "hsl(var(--chart-4))";
    return "hsl(var(--chart-5))";
  };
  return (
    <ChartMount className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="32%">
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            interval={0}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--secondary))" }}
            contentStyle={{
              borderRadius: 10,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))",
              fontSize: 12,
            }}
            formatter={(value, _name, item) => {
              const p = (item as { payload?: { value?: string; target?: string } }).payload;
              return [`${Number(value ?? 0)}% · ${p?.value ?? ""} of ${p?.target ?? ""}`, ""];
            }}
          />
          <ReferenceLine
            y={expectedPct}
            stroke="hsl(var(--foreground))"
            strokeOpacity={0.45}
            strokeDasharray="4 4"
            label={{
              value: `${expectedPct}% of year`,
              position: "insideTopRight",
              fontSize: 10,
              fill: "hsl(var(--muted-foreground))",
            }}
          />
          <Bar dataKey="pct" radius={0} maxBarSize={56}>
            {data.map((d) => (
              <Cell key={d.name} fill={tone(d.pct)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
