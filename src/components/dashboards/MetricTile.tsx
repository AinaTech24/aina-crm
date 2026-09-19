import Link from "next/link";
import type { CSSProperties } from "react";

/**
 * A headline metric card: tinted icon chip · label · figure · delta pill ·
 * gradient sparkline.
 *
 * The identity colour is the point. With colour spent only on severity, four
 * of these sat in a row looking identical and the dashboard read as unfinished
 * however well it was spaced. Each metric now owns a hue from the `--metric-*`
 * set, carried by the chip, the pill and the sparkline fill. `--primary` still
 * owns every button and nav pill, and severity still speaks through
 * --success / --warning / --destructive — see the note on those tokens.
 *
 * The hue arrives as a single custom property so one declaration re-colours
 * the whole card, rather than five class strings that can drift apart.
 */
export type MetricHue = "indigo" | "emerald" | "violet" | "cyan" | "amber" | "rose";

type Delta = {
  /** Already formatted: "2.4%", "+₹38.1 L", "2". */
  value: string;
  direction: "up" | "down" | "flat";
  /** "vs last month", "onboarded this month". */
  since?: string;
};

export function MetricTile({
  icon,
  label,
  value,
  delta,
  series,
  href,
  hue,
  lead = false,
}: {
  icon: React.ReactNode;
  label: string;
  /** Already formatted — ₹16.23 Cr. */
  value: string;
  delta?: Delta;
  /** Raw series for the sparkline. Fewer than two points draws nothing. */
  series?: number[];
  href?: string;
  hue: MetricHue;
  /** The one metric that answers the reader's first question. Bigger type,
   *  taller chart, and it spans the row rather than sitting beside a sibling
   *  at twice the size when the grid folds. */
  lead?: boolean;
}) {
  const style = { "--c": `hsl(var(--metric-${hue}))` } as CSSProperties;
  const deltaTone =
    delta?.direction === "up"
      ? "text-success bg-success/10"
      : delta?.direction === "down"
        ? "text-destructive bg-destructive/10"
        : "text-muted-foreground bg-secondary";

  // The span belongs on whichever element is the GRID ITEM. With an href this
  // component renders <Link>{card}</Link>, so the anchor is the grid child and
  // a col-span on the inner div does nothing at all — which is why the lead
  // metric never got its extra width at any breakpoint.
  // Equal tiles. The reference takes its hierarchy from ORDER — the metric
  // that answers the first question comes first — rather than from a
  // double-width card, which only worked at one breakpoint and squeezed
  // everything beside it.
  const span = "";

  const inner = (
    <div
      style={style}
      className="card-surface card-raise relative flex h-full flex-col overflow-hidden p-5 transition-colors hover:border-foreground/20"
    >
      {/* Reference anatomy: tinted chip on the LEFT, figure above its label,
          and the same icon again as a very faint watermark on the right. The
          previous order put a small grey label on the top line and the number
          under it, which buries the one thing the card exists to show. */}
      {/* The watermark is decorative and ABSOLUTE. In the flow it consumed
          ~30px of the row, which — with a 44px chip beside it — left too little
          for the figure and clipped "₹16.23 Cr" to "₹16.23…". */}
      <span
        className="pointer-events-none absolute right-4 top-4 opacity-[0.10]"
        style={{ color: "var(--c)" }}
        aria-hidden
      >
        {icon}
      </span>

      <div className="flex items-start gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl"
            style={{
              background: "color-mix(in srgb, var(--c) 14%, transparent)",
              color: "var(--c)",
            }}
            aria-hidden
          >
            {icon}
          </span>
          <div className="min-w-0">
            {/* nowrap: the figure is the point of the card and must never
                break across lines. If it outgrows the column the card
                scrolls it rather than stacking "Lakh" underneath. */}
            {/* 24px, as the reference sets it. At 30px "₹16.23 Cr" did not fit
                a quarter-width card beside a 44px chip. */}
            <div className="whitespace-nowrap font-display text-2xl font-extrabold leading-none tabular-nums tracking-tight">
              {value}
            </div>
            <div className="mt-1.5 text-2xs font-bold uppercase leading-tight tracking-wide text-muted-foreground">
              {label}
            </div>
          </div>
        </div>
      </div>

      {delta && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums ${deltaTone}`}
          >
            {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—"} {delta.value}
          </span>
          {delta.since && <span className="text-2xs text-muted-foreground">{delta.since}</span>}
        </div>
      )}

      {/* `mt-auto` pins every sparkline to its card floor, so all of them sit
          on ONE baseline however much text runs above. Without it they land at
          four different heights and the strip looks assembled by accident. */}
      {series && series.length > 1 ? (
        <Sparkline points={series} tall={lead} />
      ) : (
        <div className="mt-auto pt-4" aria-hidden>
          <div
            className="h-px w-full"
            style={{ background: "color-mix(in srgb, var(--c) 22%, transparent)" }}
            title="No history yet — the trend fills in once the nightly snapshot has run"
          />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className={`block h-full ${span}`}>
      {inner}
    </Link>
  ) : (
    <div className={`h-full ${span}`}>{inner}</div>
  );
}

/** Area-filled trend line. Scales to the series' own min/max. */
function Sparkline({ points, tall }: { points?: number[]; tall?: boolean }) {
  if (!points || points.length < 2) return null;
  const W = 320;
  const H = tall ? 60 : 44;
  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series would divide by zero and, worse, draw a line at the top of
  // the box as though it had climbed there.
  const span = max - min || 1;
  const pad = 4;
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - pad - ((p - min) / span) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M${line.split(" ").join(" L")} L${W},${H} L0,${H} Z`;
  const [lx, ly] = xy[xy.length - 1];
  const gid = `sp-${Math.round(points[0] * 1000)}-${points.length}-${H}`;

  return (
    <svg
      className="mt-auto block w-full pt-4"
      style={{ height: H }}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--c)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--c)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--c)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r="3.5" fill="var(--c)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
