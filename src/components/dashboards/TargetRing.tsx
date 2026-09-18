import type { CSSProperties } from "react";

/**
 * One annual target as a progress ring.
 *
 * Geometry, stated once: a 60-unit viewBox with r=24 gives a circumference of
 * 2π·24 ≈ 150.8, and a 5-unit stroke leaves 43 units of clear space inside.
 * "100%" sets to roughly 33 units at 12.5px, so it fits — on the 44-unit box
 * this replaces it was WIDER than the hole and clipped to "00%".
 *
 * The notch on every track is the pace marker: where the arc should have
 * reached by today. It is the one thing the competitor's version has no answer
 * to — their bars colour on raw percentage, so 50% looks identical in September
 * and in February. On a metric at zero the notch carries the whole message,
 * because the gap between it and an empty ring IS the problem.
 */
const R = 24;
const C = 2 * Math.PI * R; // 150.796

export type RingTone = "success" | "warning" | "destructive";

const HUE: Record<RingTone, string> = {
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  destructive: "hsl(var(--destructive))",
};

export function TargetRing({
  label,
  value,
  target,
  pct,
  expectedPct,
  note,
  tone,
}: {
  label: string;
  /** Already formatted — ₹2.49 Cr, or 10. */
  value: string;
  target: string;
  pct: number;
  /** Fraction of the period elapsed, 0-100. */
  expectedPct: number;
  note: string;
  tone: RingTone;
}) {
  const shown = Math.min(100, Math.max(0, pct));
  const style = { "--c": HUE[tone] } as CSSProperties;
  // A negative dashoffset rotates the dash forward around the track, which is
  // how a single 1.8-unit mark gets placed at an arbitrary percentage.
  const notchOffset = -(Math.min(99, Math.max(1, expectedPct)) / 100) * C;

  return (
    <div style={style} className="flex min-w-0 items-center gap-4 rounded-xl bg-secondary/60 p-4">
      <svg
        className="size-16 shrink-0"
        viewBox="0 0 60 60"
        role="img"
        aria-label={`${label}: ${value} of ${target}, ${pct}% of target, against ${expectedPct}% of the period elapsed — ${note}`}
      >
        <circle cx="30" cy="30" r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="5" />
        {shown > 0 && (
          <circle
            cx="30"
            cy="30"
            r={R}
            fill="none"
            stroke="var(--c)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - shown / 100)}
            transform="rotate(-90 30 30)"
          />
        )}
        {/* Pace marker. Sits on top of the arc so it stays visible when the
            metric has overtaken it. */}
        <circle
          cx="30"
          cy="30"
          r={R}
          fill="none"
          stroke={shown > 0 ? "hsl(var(--foreground))" : "var(--c)"}
          strokeOpacity={shown > 0 ? 0.38 : 0.9}
          strokeWidth="7"
          strokeDasharray={`1.8 ${C - 1.8}`}
          strokeDashoffset={notchOffset}
          transform="rotate(-90 30 30)"
        />
        <text
          x="30"
          y="30"
          textAnchor="middle"
          dominantBaseline="central"
          className="font-display font-extrabold tabular-nums"
          style={{ fontSize: "12.5px", fill: "var(--c)" }}
        >
          {pct}%
        </text>
      </svg>

      <div className="min-w-0">
        {/* Wraps rather than truncates: "Leads / referrals generated" and
            "New SIP book addition" both clip at this width, and a metric label
            cut to "NEW SIP BOOK ADDI…" has lost the word that identifies it. */}
        <div className="mb-2 text-2xs font-bold uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </div>
        {/* `whitespace-nowrap` on each figure: "₹2.49 Cr" was breaking after
            the rupee amount and putting "Cr" on its own line. */}
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="whitespace-nowrap font-display text-lg font-extrabold leading-none tabular-nums tracking-tight">
            {value}
          </span>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            / {target}
          </span>
        </div>
        <div className="mt-1 text-2xs font-bold" style={{ color: "var(--c)" }}>
          {note}
        </div>
      </div>
    </div>
  );
}
