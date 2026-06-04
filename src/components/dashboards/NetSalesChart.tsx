"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartMount } from "./ChartMount";

type Point = { day: string; gross: number; redemption: number; net: number };

export function NetSalesChart({ data }: { data: Point[] }) {
  if (!data.length) {
    return (
      <div className="h-48 grid place-items-center text-sm text-muted-foreground">
        No transactions in the last 30 days yet.
      </div>
    );
  }
  return (
    <ChartMount className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="redemption" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(v: any) => `₹${Number(v).toLocaleString("en-IN")}`}
            labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" })}
          />
          <Area type="monotone" dataKey="gross" stroke="#10b981" fill="url(#gross)" strokeWidth={2} name="Gross inflow" />
          <Area type="monotone" dataKey="redemption" stroke="#ef4444" fill="url(#redemption)" strokeWidth={2} name="Redemption" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
