"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { CHART_SERIES_WIDE } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";

type FunnelStep = { name: string; value: number; percentage: number };

const COLORS = [...CHART_SERIES_WIDE];

export function OnboardingFunnelChart({ data }: { data: FunnelStep[] }) {
  if (!data.some(d => d.value > 0)) {
    return (
      <div className="h-56 grid place-items-center text-xs text-muted-foreground">
        No active clients in the onboarding pipeline.
      </div>
    );
  }

  return (
    <ChartMount className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 15, right: 30, left: 30, bottom: 10 }}
        >
          <XAxis type="number" hide />
          <YAxis
            dataKey="name"
            type="category"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "currentColor", fontSize: 11 }}
            width={120}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: "0.5rem",
              border: "1px solid rgba(0,0,0,0.08)",
              backgroundColor: "rgba(255, 255, 255, 0.95)",
            }}
            formatter={(v: any, name: any, props: any) => [
              `${v} Clients (${props.payload.percentage.toFixed(0)}%)`,
              "Count",
            ]}
          />
          <Bar dataKey="value" barSize={20}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
