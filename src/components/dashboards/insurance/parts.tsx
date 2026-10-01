/**
 * Small pieces the insurance sections share. A plain module (no "use client"),
 * so server sections can use them; the drawer link is its own client module.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A change against a base — "N/A" when the base is zero (the brief), "New from zero" when growth starts from nothing. */
export function ChangeText({ cur, prev, format = "currency", inverse = false, newFromZero = false }: {
  cur: number | null; prev: number | null; format?: "currency" | "count" | "percent"; inverse?: boolean; newFromZero?: boolean;
}) {
  if (cur == null || prev == null) return <span className="text-muted-foreground">—</span>;
  if (prev === 0) {
    if (cur === 0) return <span className="text-muted-foreground">No change</span>;
    return <span className="text-muted-foreground" title="Nothing in the comparison period to grow from">{newFromZero ? "New from zero" : "N/A"}</span>;
  }
  const diff = cur - prev;
  if (diff === 0) return <span className="text-muted-foreground">No change</span>;
  const good = inverse ? diff < 0 : diff > 0;
  const pct = format === "percent" ? `${diff > 0 ? "+" : "−"}${(Math.abs(diff) * 100).toFixed(1)} pts` : `${diff > 0 ? "+" : "−"}${formatPercent(Math.abs(diff / prev) * 100, 1)}`;
  return <span className={good ? "text-success" : "text-warning-foreground"}>{pct}</span>;
}

export function diffText(cur: number | null, prev: number | null, format: "currency" | "count" | "percent"): string {
  if (cur == null || prev == null) return "—";
  const d = cur - prev;
  if (d === 0) return "0";
  const sign = d > 0 ? "+" : "−";
  if (format === "percent") return `${sign}${(Math.abs(d) * 100).toFixed(1)} pts`;
  return `${sign}${format === "currency" ? formatMoney(Math.abs(d)) : formatCount(Math.abs(d))}`;
}

export function fmtValue(v: number | null, format: "currency" | "count" | "percent"): ReactNode {
  if (v == null) return <span className="text-muted-foreground" title="Not recorded for this period">—</span>;
  if (format === "percent") return formatPercent(v * 100, 1);
  return format === "currency" ? formatMoney(v) : formatCount(v);
}

/** A labelled proportional bar — for mixes and breakdowns. Width is share of the largest row. */
export function BarRow({ label, value, max, right, href, tone = "primary", title }: {
  label: ReactNode; value: number; max: number; right: ReactNode; href?: string; tone?: "primary" | "danger" | "success" | "warning"; title?: string;
}) {
  const fill = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  const bar = tone === "danger" ? "bg-destructive/70" : tone === "success" ? "bg-success/80" : tone === "warning" ? "bg-warning" : "bg-primary/70";
  const body = (
    <div className={cn("flex items-center gap-2 py-1 text-xs", href && "rounded hover:bg-accent")} title={title}>
      <span className="w-32 shrink-0 truncate text-foreground sm:w-44">{label}</span>
      <span className="h-3.5 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
        {value > 0 && <span className={cn("block h-full rounded", bar)} style={{ width: `${fill}%` }} />}
      </span>
      <span className="w-32 shrink-0 text-right tabular-nums text-muted-foreground sm:w-52">{right}</span>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** Two-way toggle rendered as links (server) — the current key is highlighted. */
export function LinkToggle({ current, options }: { current: string; options: Array<{ key: string; label: string; href: string }> }) {
  return (
    <div className="dash-seg" role="group">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          scroll={false}
          aria-current={o.key === current ? "true" : undefined}
          className={cn(
            "inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
            o.key === current ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export const pctOf = (part: number, whole: number): string => (whole > 0 ? formatPercent((part / whole) * 100, 1) : "—");
