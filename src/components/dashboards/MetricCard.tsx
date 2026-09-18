import Link from "next/link";

/**
 * A single metric against its target — the scorecard card.
 *
 * The anatomy is taken deliberately from the competitor's KPI Achievement
 * panel, because it is the right shape for this: a quiet uppercase label, the
 * achieved figure large with the target small beside it, a thin full-width
 * bar, and the percentage beneath in the bar's own colour. Four lines, read
 * top to bottom, no chrome competing with the number.
 *
 * What is NOT copied:
 *
 *  - Theirs colours on raw percentage, so "50%" is the same red in September as
 *    in February. This one colours on PACE — achieved against how much of the
 *    period has actually elapsed — and draws a tick where the calendar says the
 *    bar should have reached. A number without that context is not information.
 *  - Theirs shows "REDEMPTIONS ₹8.8L — 100% ✓" in green, celebrating money
 *    leaving the book. Every metric here is higher-is-better; see the warning
 *    on PROGRESS_METRICS before adding one that isn't.
 *
 * The number uses `font-display` (Manrope) at 28px. That is the single biggest
 * reason the old tiles read as plain: the figure everyone opens the page for
 * was set in the same face and nearly the same size as the label above it.
 */
export type MetricTone = "success" | "warning" | "destructive";

const BAR: Record<MetricTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};
const TEXT: Record<MetricTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function MetricCard({
  label,
  value,
  target,
  pct,
  tone,
  note,
  expectedPct,
  href,
}: {
  label: string;
  /** Already formatted — ₹2.49 Cr, or 10. */
  value: string;
  /** Already formatted. Omitted when the metric has no target. */
  target?: string;
  pct: number;
  tone: MetricTone;
  /** "On pace" / "Behind pace" / "Target met". */
  note?: string;
  /** Where the calendar says the bar should be, 0-100. */
  expectedPct?: number;
  href?: string;
}) {
  const inner = (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="text-2xs font-semibold uppercase tracking-wide leading-snug text-muted-foreground">
        {label}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display text-[1.75rem] font-extrabold leading-none tabular-nums tracking-tight">
          {value}
        </span>
        {target && (
          <span className="text-xs text-muted-foreground tabular-nums">/ {target}</span>
        )}
      </div>

      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        {/* Zero draws nothing. A minimum-width stub reads as slight progress,
            which is the opposite of true. */}
        {pct > 0 && (
          <div
            className={`h-full rounded-full ${BAR[tone]}`}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          />
        )}
        {expectedPct != null && expectedPct > 0 && expectedPct < 100 && (
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${expectedPct}%` }}
            aria-hidden
          />
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2 text-2xs">
        <span className={`font-semibold tabular-nums ${TEXT[tone]}`}>{pct}%</span>
        {note && <span className="text-muted-foreground">{note}</span>}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
