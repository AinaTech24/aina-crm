"use client";

/**
 * How concentrated the book is: clients sorted by AUM, largest first, and the
 * share of AUM the top x% of them hold (a Lorenz / Pareto curve). The
 * diagonal is a book where every client holds the same. One axis, two
 * percentages of the same whole.
 */

import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "../ChartMount";

export type CurvePoint = { clientsPct: number; aumPct: number };

export function ConcentrationCurve({ points, mark = 10, height = 220 }: { points: CurvePoint[]; mark?: number; height?: number }) {
  const data = points.map((p) => ({ ...p, even: p.clientsPct }));
  const at = points.find((p) => p.clientsPct === mark);
  return (
    <ChartMount className="w-full">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis dataKey="clientsPct" type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={44}
              tick={{ fontSize: 12, fill: CHART_INK.tick }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as CurvePoint | undefined);
                if (!p) return null;
                return (
                  <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                    The top <b>{p.clientsPct}%</b> of clients hold <b>{p.aumPct.toFixed(0)}%</b> of AUM
                  </div>
                );
              }}
            />
            <Line dataKey="even" stroke={CHART.slate} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
            <Area dataKey="aumPct" type="monotone" stroke={CHART.indigo} strokeWidth={2.5} fill={CHART.indigo} fillOpacity={0.08}
              dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {at && <ReferenceDot x={at.clientsPct} y={at.aumPct} r={5} fill={CHART.indigo} stroke="#FFFFFF" strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartMount>
  );
}
