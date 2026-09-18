import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";

import type { ProgressRow } from "@/lib/dashboard/target-progress";
import { formatINRShort } from "@/lib/utils";
import { MetricCard, type MetricTone } from "./MetricCard";

/**
 * Target achievement — how the firm is tracking against its own annual targets.
 *
 * The numbers already existed on /dashboard/finances/progress; they were just
 * buried, so nobody saw them unless they went looking. Same loader, scorecard
 * presentation, link through to the month-by-month table.
 *
 * The card anatomy follows the competitor's KPI Achievement panel — see
 * MetricCard for what is and is not copied from it.
 */

/**
 * Where a metric stands against where the calendar says it should be.
 *
 * Judged as a RATIO of achieved-to-expected, not a fixed margin: a fixed margin
 * gives sensible bands in March and absurd ones in May, because the same
 * 10-point gap is a rounding error late in the year and a disaster early in it.
 */
function pace(pct: number, expectedPct: number): { tone: MetricTone; note: string } {
  if (pct >= 100) return { tone: "success", note: "Target met" };
  // First few weeks of the year: not enough elapsed time for the ratio to mean
  // anything, so don't paint a firm red in the second week of April.
  if (expectedPct < 10) return { tone: "success", note: "On pace" };
  const ratio = pct / expectedPct;
  if (ratio >= 0.9) return { tone: "success", note: "On pace" };
  if (ratio >= 0.7) return { tone: "warning", note: "Slightly behind" };
  return { tone: "destructive", note: "Behind pace" };
}

export function TargetAchievement({
  rows,
  fy,
  elapsed,
}: {
  rows: ProgressRow[];
  fy: string;
  /** Fraction of the financial year gone, 0..1. Computed on the server. */
  elapsed: number;
}) {
  const withTargets = rows.filter((r) => r.target > 0);
  const expectedPct = Math.round(elapsed * 100);

  return (
    <div className="card-surface p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-muted-foreground" />
            <span className="section-title">Target achievement</span>
          </div>
          {/* The competitor states the window under the panel title rather than
              leaving the reader to infer it from a filter three sections up.
              They are right; ours also states how much of it has gone, which is
              the number that makes every percentage below readable. */}
          <p className="mt-0.5 text-2xs text-muted-foreground">
            FY {fy} · {expectedPct}% of the year elapsed
          </p>
        </div>
        <Link
          href="/dashboard/finances/progress"
          className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
        >
          Month by month <ArrowRight className="size-3" />
        </Link>
      </div>

      {withTargets.length === 0 ? (
        <div className="text-sm leading-relaxed text-muted-foreground">
          No annual targets set for FY {fy} yet.{" "}
          <Link href="/dashboard/settings/targets" className="text-foreground underline">
            Set them in Settings
          </Link>{" "}
          and the firm&apos;s progress against each one shows here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {withTargets.map((r) => {
            const pct = Math.round((r.total / r.target) * 100);
            const fmt = (v: number) =>
              r.kind === "currency" ? formatINRShort(v) : v.toLocaleString("en-IN");
            const { tone, note } = pace(pct, expectedPct);
            return (
              <MetricCard
                key={r.metric}
                label={r.label}
                value={fmt(r.total)}
                target={fmt(r.target)}
                pct={pct}
                tone={tone}
                note={note}
                expectedPct={expectedPct}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
