"use client";

/**
 * Renders a matrix report as a bar / pie / line chart. Single-series matrices
 * chart the per-row total; pivot matrices render one series per pivot column.
 * A summary report charts its top-level groups through the same shape.
 * Optional: a dashed target line (Zoho's "benchmark") and a cap on how many
 * groups are drawn (the largest; the table below still lists every one).
 * Fixed-height block + ResponsiveContainer 100% (the correct sizing pattern).
 */
import {
  ResponsiveContainer,
  BarChart, Bar,
  PieChart, Pie, Cell,
  LineChart, Line,
  AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine,
} from "recharts";
import { CHART_INK, CHART_SERIES_WIDE } from "@/lib/dashboard/chart-palette";

type Matrix = {
  groupByLabel: string;
  colLabels: string[];
  rows: { key: string; label?: string; cells: number[]; total: number }[];
};
export type ReportChartType = "bar" | "pie" | "line" | "area" | "donut";

const COLORS = [...CHART_SERIES_WIDE];

/** Axis ticks in Indian short form, no unit (a chart may count records or sum rupees): 3.8 Cr · 9.5 L · 12K. */
function axisShort(v: number): string {
  const a = Math.abs(v);
  const trim = (n: number) => String(Number(n.toFixed(1)));
  if (a >= 1e7) return `${trim(v / 1e7)} Cr`;
  if (a >= 1e5) return `${trim(v / 1e5)} L`;
  if (a >= 1e3) return `${trim(v / 1e3)}K`;
  return String(v);
}

export default function ReportChart({
  chartType,
  matrix,
  target,
  limit,
}: {
  chartType: ReportChartType;
  matrix: Matrix;
  /** Draws a dashed "Target" line across bar / line / area charts. */
  target?: number | null;
  /** Draw only the largest N groups. */
  limit?: number | null;
}) {
  const single = matrix.colLabels.length <= 1;
  const series = single ? ["total"] : matrix.colLabels;
  const rows = limit && limit > 0 && matrix.rows.length > limit ? [...matrix.rows].sort((a, b) => b.total - a.total).slice(0, limit) : matrix.rows;
  const targetLine =
    target != null && Number.isFinite(target) ? (
      <ReferenceLine y={target} stroke={CHART_INK.reference} strokeDasharray="6 4" label={{ value: "Target", position: "insideTopRight", fontSize: 11, fill: CHART_INK.reference }} />
    ) : null;
  const data = rows.map((r) => {
    const o: Record<string, string | number> = { name: r.label || r.key || "—", total: r.total };
    matrix.colLabels.forEach((c, i) => (o[c] = r.cells[i] ?? 0));
    return o;
  });
  const pieData = rows.map((r) => ({ name: r.label || r.key || "—", value: r.total }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chartType === "pie" || chartType === "donut" ? (
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={chartType === "donut" ? 55 : 45} paddingAngle={2}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : chartType === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART_INK.tick }} />
            <YAxis tick={{ fontSize: 11, fill: CHART_INK.tick }} allowDecimals={false} tickFormatter={axisShort} width={56} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            {targetLine}
            {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((c, i) => (
              <Area key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.18} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : chartType === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART_INK.tick }} />
            <YAxis tick={{ fontSize: 11, fill: CHART_INK.tick }} allowDecimals={false} tickFormatter={axisShort} width={56} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            {targetLine}
            {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART_INK.tick }} />
            <YAxis tick={{ fontSize: 11, fill: CHART_INK.tick }} allowDecimals={false} tickFormatter={axisShort} width={56} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            {targetLine}
            {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((c, i) => (
              <Bar key={c} dataKey={c} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
