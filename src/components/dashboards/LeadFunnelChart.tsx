"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { CHART_SERIES } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";

type FunnelStep = { name: string; value: number; percentage: number };

const COLORS = [...CHART_SERIES];

export function LeadFunnelChart({ data }: { data: FunnelStep[] }) {
  if (!data.some(d => d.value > 0)) {
    return (
      <div className="h-48 grid place-items-center text-xs text-muted-foreground">
        No active leads in pipeline MTD.
      </div>
    );
  }

  return (
    <ChartMount className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
        >
          <XAxis type="number" hide />
          <YAxis
            dataKey="name"
            type="category"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "currentColor", fontSize: 11 }}
            width={90}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: "0.5rem",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
            formatter={(v: any, name: any, props: any) => [
              `${v} Leads (${props.payload.percentage.toFixed(0)}%)`,
              "Count",
            ]}
          />
          <Bar dataKey="value" barSize={22}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
