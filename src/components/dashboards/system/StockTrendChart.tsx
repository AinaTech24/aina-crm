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
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="aum" dataKey="aum" name="AUM" fill={CHART.blue} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line yAxisId="sip" dataKey="sip" name="SIP book a month" stroke={CHART.green} strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
