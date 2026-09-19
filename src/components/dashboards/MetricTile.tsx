import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * A headline metric tile, built to the FlowDesk reference.
 *
 * Anatomy exactly as the reference sets it: tinted icon chip on the left, the
 * figure, its label beneath, and a chevron on the right when the tile is a
 * drill-through. One row, about 90px tall.
 *
 * What was removed to get there, and why it is worth recording: the tile used
 * to carry a delta PILL on its own row plus a full-width gradient sparkline,
 * which made it ~200px — more than twice the reference. That height difference
 * was the main reason the page did not read like the reference however well the
 * colours matched.
 *
 * The delta is not gone, it moved inline beside the label. A number with no
 * comparison cannot answer "is this good?", and keeping it costs no height.
 */
export type MetricHue = "indigo" | "emerald" | "violet" | "cyan" | "amber" | "rose";

type Delta = {
  /** Already formatted: "7.6%", "4". */
  value: string;
  direction: "up" | "down" | "flat";
};

export function MetricTile({
  icon,
  label,
  value,
  delta,
  href,
  hue,
}: {
  icon: React.ReactNode;
  label: string;
  /** Already formatted — ₹16.23 Cr. */
  value: string;
  delta?: Delta;
  href?: string;
  hue: MetricHue;
}) {
  const style = { "--c": `hsl(var(--metric-${hue}))` } as CSSProperties;
  const deltaTone =
    delta?.direction === "up"
      ? "text-success"
      : delta?.direction === "down"
        ? "text-destructive"
        : "text-muted-foreground";

  const inner = (
    <div
      style={style}
      className="card-surface flex h-full items-center gap-3.5 p-5 transition-colors hover:border-foreground/20"
    >
      <span
        className="grid size-10 shrink-0 place-items-center rounded-[10px]"
        style={{ background: "color-mix(in srgb, var(--c) 14%, transparent)", color: "var(--c)" }}
        aria-hidden
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        {/* The figure never breaks across lines — it is the point of the tile. */}
        <div className="truncate text-2xl font-semibold leading-none tabular-nums tracking-tight text-foreground">
          {value}
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm leading-tight text-muted-foreground">{label}</span>
          {delta && (
            <span className={`text-2xs font-semibold tabular-nums ${deltaTone}`}>
              {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—"} {delta.value}
            </span>
          )}
        </div>
      </div>

      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    <div className="h-full">{inner}</div>
  );
}
