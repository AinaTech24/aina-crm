"use client";

/**
 * Cockpit charts: AUM breakup donut, monthly flow area, SIP business combo.
 *
 * Client components because Recharts needs the DOM. Each is a pure renderer —
 * all aggregation happens server-side in lib/dashboard/firm-charts.ts, so these
 * ship no query logic and stay cheap to reason about.
 *
 * Palette is shared so a colour means ONE thing across the section: inflow and
 * "started" are always mint, outflow and "closed" always rose, the running book
 * always cyan. A chart set where green means growth in one panel and Hybrid in
 * the next is the fastest way to make a dashboard unreadable.
 */

import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, CHART_INK } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";
import type { AumSlice, FlowPoint, SipPoint } from "@/lib/dashboard/firm-charts";

const INFLOW = CHART.green;
const OUTFLOW = CHART.red;
const NET = CHART.blue;

/** Asset classes get FIXED colours, not positional ones — Equity must stay the
 *  same colour when Debt overtakes Hybrid, or month-to-month comparison lies. */
const CLASS_COLOR: Record<string, string> = {
  Equity: CHART.blue,
  Hybrid: CHART.green,
  Debt: CHART.amber,
  Liquid: CHART.sky,
  Commodity: CHART.yellow,
  International: CHART.indigo,
  Other: CHART.slate,
};

const money = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};
const axisMoney = (n: number): string =>
  Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(0)}Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(0)}L` : `₹${n}`;

const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: 10,
    border: "1px solid hsl(var(--border))",
    background: CHART_INK.tooltipBg,
    fontSize: 12,
    boxShadow: "0 6px 24px rgba(0,0,0,.10)",
  },
  labelStyle: { fontWeight: 600, marginBottom: 2 },
} as const;

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="h-56 grid place-items-center text-xs text-muted-foreground">{children}</div>;
}

// ── AUM breakup ─────────────────────────────────────────────────────────────

export function AumBreakupDonut({ data }: { data: AumSlice[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) return <Empty>No scheme-level holdings to break down yet.</Empty>;

  return (
    <div>
      <ChartMount className="h-56 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="none">
              {data.map((d) => (
                <Cell key={d.label} fill={CLASS_COLOR[d.label] ?? CLASS_COLOR.Other} />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: any, n: any) => [money(Number(v)), n]} />
          </PieChart>
        </ResponsiveContainer>
        {/* Centre label — the donut hole is otherwise wasted space, and the
            total is the number people look for first. */}
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-2xs uppercase tracking-wider text-muted-foreground">Total</div>
            <div className="text-lg font-bold tabular-nums">{money(total)}</div>
          </div>
        </div>
      </ChartMount>

      {/* Legend as a value table rather than colour chips: the share is the
          point, and a chip alone makes you hover every slice to learn it. */}
      <div className="mt-3 space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 rounded-sm shrink-0" style={{ background: CLASS_COLOR[d.label] ?? CLASS_COLOR.Other }} />
            <span className="flex-1 truncate">{d.label}</span>
            <span className="tabular-nums font-medium">{money(d.value)}</span>
            <span className="tabular-nums text-muted-foreground w-12 text-right">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Monthly flows ───────────────────────────────────────────────────────────

export function MonthlyFlowChart({ data }: { data: FlowPoint[] }) {
  if (!data.length) return <Empty>No transactions in this window.</Empty>;
  return (
    <ChartMount className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INFLOW} stopOpacity={0.35} />
              <stop offset="100%" stopColor={INFLOW} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={OUTFLOW} stopOpacity={0.3} />
              <stop offset="100%" stopColor={OUTFLOW} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_INK.grid} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_INK.tick }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: CHART_INK.tick }} tickLine={false} axisLine={false} width={56} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: any, n: any) => [money(Number(v)), n]} />
          <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Area type="monotone" dataKey="inflow" name="Inflow" stroke={INFLOW} fill="url(#gIn)" strokeWidth={2} />
          <Area type="monotone" dataKey="outflow" name="Outflow" stroke={OUTFLOW} fill="url(#gOut)" strokeWidth={2} />
          {/* Net is a LINE, not a third area — stacking a signed series under two
              magnitudes reads as a third flow rather than their difference. */}
          <Line type="monotone" dataKey="net" name="Net" stroke={NET} strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}

// ── SIP business ────────────────────────────────────────────────────────────

export function SipBusinessChart({ data }: { data: SipPoint[] }) {
  if (!data.length) return <Empty>No SIP activity in this window.</Empty>;
  return (
    <ChartMount className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_INK.grid} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_INK.tick }} tickLine={false} axisLine={false} />
          {/* Two axes because counts of starts/stops (tens) and the running book
              (thousands) cannot share a scale without flattening one of them. */}
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: CHART_INK.tick }} tickLine={false} axisLine={false} width={40} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: CHART_INK.tick }} tickLine={false} axisLine={false} width={48} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Bar yAxisId="right" dataKey="running" name="Running book" fill={NET} fillOpacity={0.25} barSize={26} />
          <Line yAxisId="left" type="monotone" dataKey="started" name="Started" stroke={INFLOW} strokeWidth={2.5} dot={{ r: 3 }} />
          <Line yAxisId="left" type="monotone" dataKey="closed" name="Closed" stroke={OUTFLOW} strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
