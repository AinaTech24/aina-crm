"use client";

/**
 * Business trend: AUM (bars, left axis) and the SIP book (line, right axis),
 * one point per month as recorded, with today's live figure last. Two axes
 * because the two balances differ by two orders of magnitude — on one axis the
 * SIP book is a flat line on the floor. Fills are resolved hex
 * (chart-palette.ts): an unresolved hsl(var()) fill paints black in SVG.
 */

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";
import { ChartMount } from "../ChartMount";

export type StockTrendPoint = { label: string; aum: number; sip: number };

export function StockTrendChart({ data }: { data: StockTrendPoint[] }) {
  return (
    <ChartMount className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {/* Stops are resolved hex, like every fill here: a gradient that read a
              CSS variable would paint black wherever the variable is missing. */}
          <defs>
            <linearGradient id="stock-trend-aum" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.blue} stopOpacity={1} />
              <stop offset="100%" stopColor={CHART.blue} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_INK.grid} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="aum"
            tick={{ fontSize: 12, fill: CHART_INK.tick }}
            tickLine={false}
            axisLine={false}
            width={84}
            tickFormatter={(v: number) => formatMoney(v, { decimals: 1 })}
          />
          <YAxis
            yAxisId="sip"
            orientation="right"
            tick={{ fontSize: 12, fill: CHART_INK.tick }}
            tickLine={false}
            axisLine={false}
            width={84}
            tickFormatter={(v: number) => formatMoney(v, { decimals: 1 })}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: CHART_INK.cursor }}
            formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar yAxisId="aum" dataKey="aum" name="AUM" fill="url(#stock-trend-aum)" radius={[6, 6, 0, 0]} maxBarSize={56} />
          <Line
            yAxisId="sip"
            dataKey="sip"
            name="SIP book a month"
            type="monotone"
            stroke={CHART.green}
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: "#FFFFFF", strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
