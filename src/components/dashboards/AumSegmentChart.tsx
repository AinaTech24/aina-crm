"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatINR, formatINRShort } from "@/lib/utils";
import { ChartMount } from "./ChartMount";

type SegmentData = { name: string; value: number; count: number };

/** Reference donut palette: indigo, blue, green, amber, slate — flat. */
const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-6))",
];

/**
 * Thick flat donut with a centre label and a dot legend — the reference's
 * "Project Status" / "Deal Health" treatment.
 */
export function AumSegmentChart({ data }: { data: SegmentData[] }) {
  const totalAum = data.reduce((sum, item) => sum + item.value, 0);

  if (!data.some((d) => d.value > 0)) {
    return (
      <div className="h-72 grid place-items-center text-xs text-muted-foreground">
        No active client AUM data available.
      </div>
    );
  }

  return (
    <ChartMount className="relative h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="46%"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={1.5}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 10,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))",
            }}
            formatter={(value, name, item) => {
              const count = Number((item as { payload?: { count?: number } }).payload?.count ?? 0);
              return [`${formatINR(Number(value ?? 0))} (${count} clients)`, String(name ?? "")];
            }}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="text-sm text-muted-foreground">Active AUM</div>
        <div className="text-lg font-semibold tabular-nums text-foreground">{formatINRShort(totalAum)}</div>
      </div>
    </ChartMount>
  );
}
