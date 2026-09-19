"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";

/**
 * Stage occupancy as a flat bar chart in the reference style: solid blue bars,
 * square corners, horizontal dashed gridlines only, no axis lines, small grey
 * ticks. Colours are resolved hex — see chart-palette.ts for why.
 */
export function LeadPipelineChart({
  data,
}: {
  data: Array<{ name: string; count: number; overdue: number }>;
}) {
  return (
    <ChartMount className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="3 3" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK.tick }} interval={0} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK.tick }} />
          <Tooltip
            cursor={{ fill: CHART_INK.cursor }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, _name, item) => {
              const v = Number(value ?? 0);
              const overdue = Number((item as { payload?: { overdue?: number } }).payload?.overdue ?? 0);
              return [`${v} lead${v === 1 ? "" : "s"}${overdue ? ` · ${overdue} past SLA` : ""}`, ""];
            }}
          />
          <Bar dataKey="count" fill={CHART.blue} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
