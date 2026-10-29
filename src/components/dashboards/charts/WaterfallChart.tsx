"use client";

/**
 * A bridge: an opening balance, the movements that changed it, and the
 * closing balance — AUM (money brought in vs the market) and the SIP book
 * (added, stopped, other). Stacked bars with an invisible base, so each
 * movement floats from where the previous one ended.
 *
 * When every bar sits far from zero the axis starts near the opening balance,
 * or a month's movement is a sliver on a tall bar; the card then says where
 * the axis starts (`axisNote`). Fills are resolved hex (chart-palette.ts).
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";
import { ChartMount } from "../ChartMount";

export type WaterfallStep = { label: string; value: number; kind: "total" | "delta"; hint?: string };

type Row = { label: string; base: number; bar: number; value: number; kind: "total" | "delta"; hint?: string };

/** Lay the steps out and pick the axis floor. Pure — exported for the caller's note. */
export function waterfallLayout(steps: WaterfallStep[]): { rows: Row[]; floor: number; top: number } {
  let run = 0;
  const rows: Row[] = steps.map((s) => {
    if (s.kind === "total") {
      run = s.value;
      return { label: s.label, base: 0, bar: s.value, value: s.value, kind: "total", hint: s.hint };
    }
    const from = run;
    run += s.value;
    return { label: s.label, base: Math.min(from, run), bar: Math.abs(s.value), value: s.value, kind: "delta", hint: s.hint };
  });
  const lows = rows.map((r) => (r.kind === "total" ? r.bar : r.base));
  const highs = rows.map((r) => r.base + r.bar);
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const span = hi - lo;
  // Start the axis near the data only when zero would flatten every movement.
  const rawFloor = lo > 0 && span < lo * 0.5 ? Math.max(0, lo - Math.max(span, hi * 0.01) * 0.8) : 0;
  const rawTop = hi + (hi - rawFloor) * 0.12;
  // Round both ends to a step of the span, so the axis reads 600 · 610 · 620, not 595.9.
  const step = niceStep((rawTop - rawFloor) / 4);
  const floor = rawFloor > 0 ? Math.floor(rawFloor / step) * step : 0;
  return { rows, floor, top: Math.ceil(rawTop / step) * step };
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** "₹3.83 Cr", "₹612.4 Cr", "₹35 Lakh" — short, trailing zeros dropped. */
const short = (v: number) => {
  const cr = Math.abs(v) >= 1e7;
  const decimals = cr && Math.abs(v) < 1e9 ? 2 : 1;
  return formatMoney(v, { decimals }).replace(/(\.\d*?)0+(?= )/, "$1").replace(/\.(?= )/, "");
};

/** An x-axis label over up to two lines, so neighbours never run together. */
function Tick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const words = String(payload?.value ?? "").split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 11) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return (
    <text x={x} y={(y ?? 0) + 4} textAnchor="middle" fontSize={12} fill={CHART_INK.tick}>
      {lines.slice(0, 2).map((l, i) => <tspan key={i} x={x} dy={i ? 14 : 10}>{l}</tspan>)}
    </text>
  );
}

export function WaterfallChart({ steps, height = 240 }: { steps: WaterfallStep[]; height?: number }) {
  const { rows, floor, top } = waterfallLayout(steps);
  const fill = (r: Row) => (r.kind === "total" ? CHART.indigo : r.value >= 0 ? CHART.green : CHART.red);
  const signed = (r: Row) => (r.kind === "total" ? short(r.value) : `${r.value >= 0 ? "+" : "−"}${short(Math.abs(r.value))}`);
  return (
    <ChartMount className="w-full" >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis dataKey="label" tick={<Tick />} tickLine={false} axisLine={false} interval={0} height={36} />
            <YAxis
              domain={[floor, top]}
              allowDataOverflow
              tick={{ fontSize: 12, fill: CHART_INK.tick }}
              tickLine={false}
              axisLine={false}
              width={76}
              tickFormatter={(v: number) => short(v)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: CHART_INK.cursor }}
              content={({ active, payload }) => {
                const r = active && payload?.[0]?.payload as Row | undefined;
                if (!r) return null;
                return (
                  <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                    <div style={{ fontWeight: 600 }}>{r.label}</div>
                    <div>{signed(r)}</div>
                    {r.hint && <div style={{ color: CHART_INK.tick, maxWidth: 220 }}>{r.hint}</div>}
                  </div>
                );
              }}
            />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="bar" stackId="w" radius={[4, 4, 4, 4]} maxBarSize={64} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.label} fill={fill(r)} />)}
              <LabelList
                dataKey="value"
                position="top"
                content={(p) => {
                  const { x, y, width, index } = p as { x: number; y: number; width: number; index: number };
                  const r = rows[index];
                  if (!r) return null;
                  return (
                    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={CHART_INK.reference}>
                      {signed(r)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartMount>
  );
}
