import React from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from "lucide-react";

export type ModernMetricTone = "indigo" | "emerald" | "violet" | "cyan" | "amber" | "rose";

export interface ModernMetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: ModernMetricTone;
  trend?: {
    value: string;
    direction: "up" | "down" | "flat";
    label?: string;
  };
  sparklineData?: number[];
  href?: string;
  badge?: string;
}

const TONE_STYLES: Record<
  ModernMetricTone,
  {
    bgBadge: string;
    iconColor: string;
    borderAccent: string;
    lineStroke: string;
    fillGradient: string;
  }
> = {
  indigo: {
    bgBadge: "bg-indigo-50 text-indigo-600 border-indigo-200",
    iconColor: "text-indigo-600",
    borderAccent: "hover:border-indigo-300 hover:shadow-indigo-100",
    lineStroke: "#4f46e5",
    fillGradient: "rgba(79, 70, 229, 0.14)",
  },
  emerald: {
    bgBadge: "bg-emerald-50 text-emerald-600 border-emerald-200",
    iconColor: "text-emerald-600",
    borderAccent: "hover:border-emerald-300 hover:shadow-emerald-100",
    lineStroke: "#059669",
    fillGradient: "rgba(5, 150, 105, 0.14)",
  },
  violet: {
    bgBadge: "bg-purple-50 text-purple-600 border-purple-200",
    iconColor: "text-purple-600",
    borderAccent: "hover:border-purple-300 hover:shadow-purple-100",
    lineStroke: "#7c3aed",
    fillGradient: "rgba(124, 58, 237, 0.14)",
  },
  cyan: {
    bgBadge: "bg-cyan-50 text-cyan-600 border-cyan-200",
    iconColor: "text-cyan-600",
    borderAccent: "hover:border-cyan-300 hover:shadow-cyan-100",
    lineStroke: "#0891b2",
    fillGradient: "rgba(8, 145, 178, 0.14)",
  },
  amber: {
    bgBadge: "bg-amber-50 text-amber-600 border-amber-200",
    iconColor: "text-amber-600",
    borderAccent: "hover:border-amber-300 hover:shadow-amber-100",
    lineStroke: "#d97706",
    fillGradient: "rgba(217, 119, 6, 0.14)",
  },
  rose: {
    bgBadge: "bg-rose-50 text-rose-600 border-rose-200",
    iconColor: "text-rose-600",
    borderAccent: "hover:border-rose-300 hover:shadow-rose-100",
    lineStroke: "#e11d48",
    fillGradient: "rgba(225, 29, 72, 0.14)",
  },
};

/**
 * Clean, bounded mini sparkline that strictly stays in its own container
 * and never overlaps surrounding text.
 */
function MiniSparkline({ data, stroke, fill }: { data: number[]; stroke: string; fill: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 100;
  const height = 36;

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * (width - 8) + 4;
    const y = height - ((val - min) / range) * (height - 10) - 5;
    return { x, y };
  });

  const pathD = points.reduce((acc, pt, idx, arr) => {
    if (idx === 0) return `M ${pt.x},${pt.y}`;
    const prev = arr[idx - 1];
    const cp1x = prev.x + (pt.x - prev.x) / 2;
    const cp2x = cp1x;
    return `${acc} C ${cp1x},${prev.y} ${cp2x},${pt.y} ${pt.x},${pt.y}`;
  }, "");

  const fillD = `${pathD} L ${width - 4},${height} L 4,${height} Z`;

  return (
    <div className="w-[100px] h-[36px] overflow-hidden shrink-0 flex items-center justify-end">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <defs>
          <linearGradient id={`grad-${stroke.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={fillD} fill={`url(#grad-${stroke.replace(/[^a-zA-Z0-9]/g, "")})`} />
        <path d={pathD} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function ModernMetricCard({
  title,
  value,
  subtitle,
  icon,
  tone,
  trend,
  sparklineData,
  href,
  badge,
}: ModernMetricCardProps) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.indigo;

  const content = (
    <div
      className={`group relative flex flex-col justify-between h-full p-5 rounded-2xl bg-card border border-border/80 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${styles.borderAccent}`}
    >
      {/* Top Header Row: Icon, Title & Badge */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`flex items-center justify-center size-9 rounded-xl border ${styles.bgBadge} transition-transform duration-200 group-hover:scale-105 shrink-0`}
          >
            {icon}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {badge && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border/70 whitespace-nowrap">
              {badge}
            </span>
          )}
          {href && (
            <span className="text-muted-foreground/50 group-hover:text-foreground transition-colors p-0.5">
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>
      </div>

      {/* Main Value & Sparkline (Cleanly separated) */}
      <div className="my-3.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground tabular-nums whitespace-nowrap">
            {value}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">
              {subtitle}
            </p>
          )}
        </div>

        {sparklineData && sparklineData.length > 1 && (
          <div className="shrink-0 pl-2">
            <MiniSparkline data={sparklineData} stroke={styles.lineStroke} fill={styles.fillGradient} />
          </div>
        )}
      </div>

      {/* Bottom Row: Trend pill & Label */}
      <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs gap-2">
        {trend ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-xs tabular-nums whitespace-nowrap ${
                trend.direction === "up"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : trend.direction === "down"
                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                  : "bg-secondary text-muted-foreground border border-border"
              }`}
            >
              {trend.direction === "up" && <ArrowUpRight className="size-3.5 stroke-[2.5]" />}
              {trend.direction === "down" && <ArrowDownRight className="size-3.5 stroke-[2.5]" />}
              {trend.direction === "flat" && <Minus className="size-3.5" />}
              {trend.value}
            </span>
            {trend.label && (
              <span className="text-muted-foreground text-2xs font-medium whitespace-nowrap">
                {trend.label}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">Healthy</span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl">
        {content}
      </Link>
    );
  }

  return content;
}
