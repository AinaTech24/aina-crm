import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";

import type { ProgressRow } from "@/lib/dashboard/target-progress";
import { formatINRShort } from "@/lib/utils";

/**
 * Target achievement — how the firm is tracking against its own annual targets.
 *
 * The numbers already existed on /dashboard/finances/progress; they were just
 * buried, so nobody saw them unless they went looking. Same loader, compact
 * presentation, link through to the month-by-month table.
 *
 * Three things this does NOT copy from the competitor's version:
 *
 *  - It does not show a metric with no target set. Rendering "0 / 0 — 0%" for a
 *    firm that never set targets invents a failure out of an empty settings
 *    page; the panel says so and links to Settings instead.
 *  - Every metric here is "higher is better", so a full bar is unambiguously
 *    good. Theirs shows "Redemptions ₹8.8L — 100% ✓" in green, which celebrates
 *    money leaving the book.
 *  - It judges PACE, not raw progress. A bare "50%" is good news in September
 *    and bad news in February; theirs colours both the same.
 */

/**
 * Where a metric stands against where the calendar says it should be.
 *
 * Judged as a RATIO of achieved-to-expected, not a fixed margin: a fixed margin
 * gives sensible bands in March and absurd ones in May, because the same
 * 10-point gap is a rounding error late in the year and a disaster early in it.
 */
function pace(pct: number, expectedPct: number) {
  const met = { tone: "bg-success", note: "Target met", noteClass: "text-success" };
  const on = { tone: "bg-success", note: "On pace", noteClass: "text-muted-foreground" };
  if (pct >= 100) return met;
  // First few weeks of the year: there is not yet enough elapsed time for the
  // ratio to mean anything, so don't paint a firm red in the second week of April.
  if (expectedPct < 10) return on;
  const ratio = pct / expectedPct;
  if (ratio >= 0.9) return on;
  if (ratio >= 0.7)
    return { tone: "bg-warning", note: "Slightly behind", noteClass: "text-muted-foreground" };
  return { tone: "bg-destructive", note: "Behind pace", noteClass: "text-destructive" };
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
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" />
          <span className="section-title">Target achievement</span>
          <span className="text-2xs text-muted-foreground">
            FY {fy} · {expectedPct}% of the year gone
          </span>
        </div>
        <Link
          href="/dashboard/finances/progress"
          className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Month by month <ArrowRight className="size-3" />
        </Link>
      </div>

      {withTargets.length === 0 ? (
        <div className="text-sm text-muted-foreground leading-relaxed">
          No annual targets set for FY {fy} yet.{" "}
          <Link href="/dashboard/settings/targets" className="text-foreground underline">
            Set them in Settings
          </Link>{" "}
          and the firm&apos;s progress against each one shows here.
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {withTargets.map((r) => {
            const pct = Math.round((r.total / r.target) * 100);
            const fmt = (v: number) =>
              r.kind === "currency" ? formatINRShort(v) : v.toLocaleString("en-IN");
            const { tone, note, noteClass } = pace(pct, expectedPct);
            return (
              <div key={r.metric} className="space-y-1.5">
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {r.label}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tabular-nums leading-none">{fmt(r.total)}</span>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    / {fmt(r.target)}
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full ${tone}`}
                    // Nothing achieved draws nothing. A 2% minimum sliver reads
                    // as "a little progress", which is the opposite of true.
                    style={{ width: `${pct === 0 ? 0 : Math.min(100, Math.max(2, pct))}%` }}
                  />
                  {/* Where the calendar says the bar should have reached by
                      today. Without it "50%" is a number the reader has to
                      judge unaided. */}
                  <div
                    className="absolute inset-y-0 w-px bg-foreground/45"
                    style={{ left: `${expectedPct}%` }}
                    aria-hidden
                  />
                </div>
                <div className="flex items-baseline justify-between gap-2 text-2xs">
                  <span className="tabular-nums text-muted-foreground">{pct}%</span>
                  <span className={noteClass}>{note}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
