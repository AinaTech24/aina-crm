"use client";

/**
 * Platform analytics — every MFD metric the admin asked for (total MFDs,
 * active/inactive, license status mix incl. expired/suspended/extended, clients
 * per MFD) rendered as interactive charts. Each chart card lets you switch the
 * *visualization* of the same data (pie / donut / bar / line / area / radar /
 * radial), and the trend section re-buckets by daily…annually. All charts
 * animate in smoothly (Recharts).
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  RadialBarChart, RadialBar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { CHART, CHART_INK, CHART_SERIES_WIDE } from "@/lib/dashboard/chart-palette";
import {
  Building2, Activity, UserCheck, Users, ShieldAlert, BadgeCheck, CalendarClock,
  PieChart as PieIcon, BarChart3, LineChart as LineIcon, AreaChart as AreaIcon,
  Radar as RadarIcon, CircleDot, AlignStartVertical, Trash2, ChevronDown,
} from "lucide-react";
import { ChartMount } from "@/components/dashboards/ChartMount";
import { formatDate } from "@/lib/format";

export type MfdRow = {
  id: string;
  name: string;
  createdAt: string | null;
  deletedAt: string | null;
  status: string;
  packageKey: string | null;
  licenseEndAt: string | null;
  investors: number;
  activeInvestors: number;
};

type Gran = "daily" | "weekly" | "monthly" | "quarterly" | "half_yearly" | "annually";
type DistType = "donut" | "pie" | "bar" | "hbar" | "radar" | "radial";
type TrendType = "area" | "line" | "bar";

const PALETTE = [...CHART_SERIES_WIDE];

const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: CHART.green },
  trial: { label: "Trial", color: CHART.blue },
  past_due: { label: "Past due", color: CHART.amber },
  suspended: { label: "Suspended", color: CHART.red },
  expired: { label: "Expired", color: CHART.red },
  cancelled: { label: "Cancelled", color: CHART.slate },
  pending: { label: "Pending", color: CHART.purple },
};

const GRAN_OPTS: { key: Gran; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half-yearly" },
  { key: "annually", label: "Annually" },
];

function bucketOf(date: Date, gran: Gran): { key: string; label: string; sort: number } {
  const y = date.getFullYear();
  const m = date.getMonth();
  switch (gran) {
    case "daily":
      return { key: date.toISOString().slice(0, 10), label: formatDate(date, "dayMonth"), sort: date.getTime() };
    case "weekly": {
      const dt = new Date(date);
      const dow = (dt.getDay() + 6) % 7;
      dt.setDate(dt.getDate() - dow);
      dt.setHours(0, 0, 0, 0);
      return { key: dt.toISOString().slice(0, 10), label: formatDate(dt, "dayMonth"), sort: dt.getTime() };
    }
    case "monthly":
      return { key: `${y}-${m}`, label: date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), sort: y * 12 + m };
    case "quarterly": {
      const q = Math.floor(m / 3) + 1;
      return { key: `${y}-Q${q}`, label: `Q${q} '${String(y).slice(2)}`, sort: y * 4 + q };
    }
    case "half_yearly": {
      const h = m < 6 ? 1 : 2;
      return { key: `${y}-H${h}`, label: `H${h} '${String(y).slice(2)}`, sort: y * 2 + h };
    }
    case "annually":
      return { key: `${y}`, label: `${y}`, sort: y };
  }
}

export function AnalyticsDashboard({ mfds, extendedCount }: { mfds: MfdRow[]; extendedCount: number }) {
  const [gran, setGran] = useState<Gran>("daily");

  const m = useMemo(() => {
    // Live (not soft-deleted) MFDs vs the soft-deleted set — kept separate so a
    // deleted tenant never inflates the "active" numbers.
    const live = mfds.filter((x) => !x.deletedAt);
    const softDeleted = mfds.filter((x) => x.deletedAt).length;
    const total = live.length;
    const active = live.filter((x) => x.status === "active").length;
    const trial = live.filter((x) => x.status === "trial").length;
    const suspended = live.filter((x) => x.status === "suspended").length;
    const expired = live.filter((x) => x.status === "expired").length;
    const inactive = total - active;
    const totalClients = live.reduce((s, x) => s + x.investors, 0);
    const activeClients = live.reduce((s, x) => s + x.activeInvestors, 0);

    const licenseDist = Object.keys(STATUS_META)
      .map((k) => ({ name: STATUS_META[k].label, value: live.filter((x) => x.status === k).length, color: STATUS_META[k].color }))
      .filter((d) => d.value > 0);
    if (softDeleted > 0) licenseDist.push({ name: "Soft-deleted", value: softDeleted, color: CHART.ink });

    const activeDist = [
      { name: "Active", value: active, color: CHART.green },
      { name: "Inactive", value: inactive, color: CHART.red },
      ...(softDeleted > 0 ? [{ name: "Soft-deleted", value: softDeleted, color: CHART.ink }] : []),
    ];

    const pkgCount = new Map<string, number>();
    live.forEach((x) => pkgCount.set(x.packageKey ?? "none", (pkgCount.get(x.packageKey ?? "none") ?? 0) + 1));
    const pkgDist = [...pkgCount.entries()].map(([k, v], i) => ({ name: k === "none" ? "No plan" : k, value: v, color: PALETTE[i % PALETTE.length] }));

    const topClients = [...live]
      .filter((x) => x.investors > 0)
      .sort((a, b) => b.investors - a.investors)
      .slice(0, 10)
      .map((x, i) => ({ name: x.name, value: x.investors, color: PALETTE[i % PALETTE.length] }));

    return { total, active, trial, suspended, expired, inactive, softDeleted, totalClients, activeClients, licenseDist, activeDist, pkgDist, topClients };
  }, [mfds]);

  const trend = useMemo(() => {
    const buckets = new Map<string, { label: string; sort: number; mfds: number; clients: number }>();
    mfds.filter((x) => !x.deletedAt).forEach((x) => {
      if (!x.createdAt) return;
      const b = bucketOf(new Date(x.createdAt), gran);
      const e = buckets.get(b.key) ?? { label: b.label, sort: b.sort, mfds: 0, clients: 0 };
      e.mfds += 1;
      e.clients += x.investors;
      buckets.set(b.key, e);
    });
    let cum = 0;
    return [...buckets.values()]
      .sort((a, b) => a.sort - b.sort)
      .map((s) => {
        cum += s.mfds;
        return { period: s.label, "New MFDs": s.mfds, "Total MFDs": cum, "New clients": s.clients };
      })
      .slice(-30);
  }, [mfds, gran]);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">Analytics</h1>
        
      </div>

      {/* KPI ribbon */}
      <CollapsibleSection
        title="Key metrics"
        subtitle="Platform headline numbers at a glance"
        summary={`${m.total.toLocaleString("en-IN")} MFDs · ${m.totalClients.toLocaleString("en-IN")} clients`}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Total MFDs" value={m.total} icon={Building2} tone="brand" />
          <Kpi label="Active MFDs" value={m.active} icon={Activity} tone="emerald" />
          <Kpi label="Inactive MFDs" value={m.inactive} icon={ShieldAlert} tone="rose" />
          <Kpi label="Total clients" value={m.totalClients} icon={Users} tone="violet" />
          <Kpi label="Active clients" value={m.activeClients} icon={UserCheck} tone="emerald" />
          <Kpi label="On trial" value={m.trial} icon={CalendarClock} tone="blue" />
          <Kpi label="Suspended / Expired" value={m.suspended + m.expired} icon={ShieldAlert} tone="rose" />
          <Kpi label="Licenses extended" value={extendedCount} icon={BadgeCheck} tone="amber" />
          <Kpi label="Soft-deleted MFDs" value={m.softDeleted} icon={Trash2} tone="rose" />
        </div>
      </CollapsibleSection>

      {/* Trend with granularity switcher */}
      <CollapsibleSection
        title="Growth over time"
        subtitle="New & cumulative MFDs and client acquisition"
        headerExtra={
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {GRAN_OPTS.map((g) => (
              <button
                key={g.key}
                onClick={() => setGran(g.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  gran === g.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
      >
        <TrendChart data={trend} />
      </CollapsibleSection>

      {/* Distribution grid */}
      <CollapsibleSection title="Distributions" subtitle="License, health, plan and client-book breakdowns">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DistributionCard title="License status" subtitle="MFDs by subscription state" data={m.licenseDist} initial="donut" />
          <DistributionCard title="Active vs inactive MFDs" subtitle="Subscription health split" data={m.activeDist} initial="pie" />
          <DistributionCard title="Clients per MFD (top 10)" subtitle="Investor book size by firm" data={m.topClients} initial="hbar" />
          <DistributionCard title="Plan distribution" subtitle="MFDs by subscription package" data={m.pkgDist} initial="bar" />
        </div>
      </CollapsibleSection>
    </div>
  );
}

/* --------------------------------------------------- Collapsible section */
function CollapsibleSection({
  title,
  subtitle,
  summary,
  headerExtra,
  children,
}: {
  title: string;
  subtitle?: string;
  summary?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border rounded-xl bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex items-center gap-2 text-left -m-1 p-1 rounded-md hover:bg-muted/50 transition-colors"
        >
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform duration-300 ${open ? "" : "-rotate-90"}`}
          />
          <span>
            <span className="block font-semibold leading-tight">{title}</span>
            {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
          </span>
        </button>
        {open ? headerExtra : summary ? <span className="text-xs text-muted-foreground font-medium tabular-nums">{summary}</span> : null}
      </div>
      <div
        className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0 mt-0"}`}
      >
        <div className="overflow-hidden min-h-0">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- KPI card */
function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: "brand" | "emerald" | "rose" | "violet" | "blue" | "amber" }) {
  const tones: Record<string, string> = {
    brand: "text-primary bg-primary/10",
    emerald: "text-emerald-600 bg-emerald-500/10",
    rose: "text-rose-600 bg-rose-500/10",
    violet: "text-violet-600 bg-violet-500/10",
    blue: "text-blue-600 bg-blue-500/10",
    amber: "text-amber-600 bg-amber-500/10",
  };
  return (
    <div className="border rounded-xl bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className={`size-7 rounded-lg grid place-items-center ${tones[tone]}`}><Icon className="size-4" /></span>
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums">{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

/* ------------------------------------------------- Distribution chart card */
const DIST_TYPES: { key: DistType; icon: any; title: string }[] = [
  { key: "donut", icon: CircleDot, title: "Donut" },
  { key: "pie", icon: PieIcon, title: "Pie" },
  { key: "bar", icon: BarChart3, title: "Bar" },
  { key: "hbar", icon: AlignStartVertical, title: "Horizontal bar" },
  { key: "radar", icon: RadarIcon, title: "Radar" },
  { key: "radial", icon: Activity, title: "Radial" },
];

function DistributionCard({ title, subtitle, data, initial }: { title: string; subtitle: string; data: { name: string; value: number; color: string }[]; initial: DistType }) {
  const [type, setType] = useState<DistType>(initial);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="border rounded-xl bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {DIST_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              title={t.title}
              aria-label={t.title}
              className={`size-7 grid place-items-center rounded-md transition-colors ${
                type === t.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
      {total === 0 ? (
        <div className="h-64 grid place-items-center text-xs text-muted-foreground">No data yet.</div>
      ) : (
        <DistributionChart data={data} type={type} total={total} />
      )}
    </div>
  );
}

const TOOLTIP_STYLE = { fontSize: 12, borderRadius: "0.6rem", border: "1px solid hsl(var(--border))", background: CHART_INK.tooltipBg, color: "#111827", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" } as const;

function DistributionChart({ data, type, total }: { data: { name: string; value: number; color: string }[]; type: DistType; total: number }) {
  if (type === "pie" || type === "donut") {
    return (
      <ChartMount className="h-64 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={type === "donut" ? 58 : 0} outerRadius={88} paddingAngle={type === "donut" ? 3 : 1}
              animationDuration={900} animationEasing="ease-out">
              {data.map((d, i) => <Cell key={i} fill={d.color} stroke={CHART_INK.tooltipBg} strokeWidth={2} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: any) => [`${Number(v).toLocaleString("en-IN")} (${Math.round((Number(v) / total) * 100)}%)`, n]} />
            <Legend verticalAlign="bottom" height={28} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
        {type === "donut" && (
          <div className="absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
            <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold">Total</div>
            <div className="text-lg font-bold">{total.toLocaleString("en-IN")}</div>
          </div>
        )}
      </ChartMount>
    );
  }

  if (type === "radar") {
    return (
      <ChartMount className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="78%">
            <PolarGrid stroke={CHART_INK.grid} />
            <PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: CHART_INK.tick }} />
            <PolarRadiusAxis tick={{ fontSize: 9, fill: CHART_INK.tick }} />
            <Radar dataKey="value" stroke={CHART.red} fill={CHART.red} fillOpacity={0.45} animationDuration={900} animationEasing="ease-out" />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </RadarChart>
        </ResponsiveContainer>
      </ChartMount>
    );
  }

  if (type === "radial") {
    const rd = data.map((d) => ({ ...d, fill: d.color }));
    return (
      <ChartMount className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={rd} cx="50%" cy="50%" innerRadius="25%" outerRadius="95%" barSize={14} startAngle={90} endAngle={-270}>
            <RadialBar background dataKey="value" cornerRadius={8} animationDuration={900} animationEasing="ease-out" />
            <Legend iconSize={8} layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </RadialBarChart>
        </ResponsiveContainer>
      </ChartMount>
    );
  }

  // bar + hbar
  const horizontal = type === "hbar";
  return (
    <ChartMount className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 12, bottom: 6, left: horizontal ? 8 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} opacity={0.5} {...(horizontal ? { horizontal: false } : { vertical: false })} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 10, fill: CHART_INK.tick }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: CHART_INK.tick }} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: CHART_INK.tick }} interval={0} angle={-12} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: CHART_INK.tick }} allowDecimals={false} />
            </>
          )}
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_INK.cursor }} />
          <Bar dataKey="value" radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} animationDuration={900} animationEasing="ease-out">
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}

/* -------------------------------------------------------- Trend chart card */
const TREND_TYPES: { key: TrendType; icon: any; title: string }[] = [
  { key: "area", icon: AreaIcon, title: "Area" },
  { key: "line", icon: LineIcon, title: "Line" },
  { key: "bar", icon: BarChart3, title: "Bar" },
];

function TrendChart({ data }: { data: Record<string, any>[] }) {
  const [type, setType] = useState<TrendType>("area");
  const SERIES = [
    { key: "New MFDs", color: CHART.red },
    { key: "Total MFDs", color: CHART.blue },
    { key: "New clients", color: CHART.green },
  ];

  return (
    <div>
      <div className="flex justify-end mb-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {TREND_TYPES.map((t) => (
            <button key={t.key} onClick={() => setType(t.key)} title={t.title} aria-label={t.title}
              className={`size-7 grid place-items-center rounded-md transition-colors ${type === t.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <t.icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div className="h-72 grid place-items-center text-xs text-muted-foreground">No signups in range.</div>
      ) : (
        <ChartMount className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {type === "area" ? (
              <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} opacity={0.5} vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_INK.tick }} />
                <YAxis tick={{ fontSize: 10, fill: CHART_INK.tick }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {SERIES.map((s) => (
                  <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} animationDuration={900} animationEasing="ease-out" />
                ))}
              </AreaChart>
            ) : type === "line" ? (
              <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} opacity={0.5} vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_INK.tick }} />
                <YAxis tick={{ fontSize: 10, fill: CHART_INK.tick }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {SERIES.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} animationDuration={900} animationEasing="ease-out" />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_INK.grid} opacity={0.5} vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_INK.tick }} />
                <YAxis tick={{ fontSize: 10, fill: CHART_INK.tick }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_INK.cursor }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} fill={s.color} animationDuration={900} animationEasing="ease-out" />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </ChartMount>
      )}
    </div>
  );
}
