"use client";

/**
 * Money movement: gross investment and redemption as bars, net as a line.
 * Fills are resolved hex (chart-palette.ts) — an unresolved hsl(var()) fill
 * paints black in SVG.
 */

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";
import { ChartMount } from "../ChartMount";

export type MoneyPoint = { label: string; gross: number; redemption: number; net: number };

export function MoneyMovementChart({ data }: { data: MoneyPoint[] }) {
  return (
    <ChartMount className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 12, fill: CHART_INK.tick }}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(v: number) => formatMoney(v, { decimals: 1 })}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: CHART_INK.cursor }}
            formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="gross" name="Gross investment" fill={CHART.green} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="redemption" name="Redemption" fill={CHART.slate} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line dataKey="net" name="Net sales" stroke={CHART.navy} strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
