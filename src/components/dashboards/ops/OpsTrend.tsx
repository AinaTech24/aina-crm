"use client";

/**
 * §40 Operations trend — one COUNT metric at a time across the financial
 * year, chosen with a toggle. Every metric here is a count, so the scale is
 * always "number of requests"; nothing in rupees ever shares it.
 */

import { useState } from "react";
import type { TrendPoint } from "@/lib/dashboard/ops/flow";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const METRICS: Array<{ key: keyof Omit<TrendPoint, "month" | "label">; label: string; hint: string; tone: string }> = [
  { key: "received", label: "Received", hint: "requests received in the month", tone: "bg-primary/70" },
  { key: "completed", label: "Completed", hint: "requests completed in the month", tone: "bg-success" },
  { key: "closing", label: "Pending at month end", hint: "open at the end of the month (today for this month)", tone: "bg-primary/40" },
  { key: "rejected", label: "Rejected", hint: "rejected or failed on the feed", tone: "bg-destructive/70" },
  { key: "breached", label: "SLA breaches", hint: "SLA fell due in the month and was missed", tone: "bg-destructive/70" },
];

export function OpsTrend({ points }: { points: TrendPoint[] }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("received");
  const m = METRICS.find((x) => x.key === metric)!;
  const peak = Math.max(1, ...points.map((p) => p[metric]));
  const any = points.some((p) => p[metric] > 0);
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Operations trend">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <h2 className="section-title">Operations trend</h2>
          <p className="section-subtitle mt-1">Month by month this financial year.</p>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Metric">
          {METRICS.map((x) => (
            <button key={x.key} type="button" onClick={() => setMetric(x.key)} aria-pressed={metric === x.key} title={`${x.hint.charAt(0).toUpperCase()}${x.hint.slice(1)}`}
                    className={cn("inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium",
                      metric === x.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {!any ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Nothing recorded for {m.label.toLowerCase()} this financial year.
        </p>
      ) : (
        <div className="flex h-44 items-end gap-2" role="img" aria-label={`${m.label} by month`}>
          {points.map((p) => (
            <div key={p.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-2xs tabular-nums text-muted-foreground">{p[metric] ? formatCount(p[metric]) : ""}</span>
              <span className={cn("w-full rounded-t", m.tone)} style={{ height: `${(p[metric] / peak) * 100}%`, minHeight: p[metric] ? 3 : 0 }} />
              <span className="text-2xs text-muted-foreground">{p.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
