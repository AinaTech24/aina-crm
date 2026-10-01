/**
 * A tiny trend line for a headline tile: the last few month-ends of a balance,
 * as a stroke and a soft fill under it. SERVER component — plain SVG, no
 * library. Paints are `currentColor`, which resolves from the tile's colour;
 * an `hsl(var(--token))` in an SVG paint attribute would render black.
 *
 * It says direction and shape, not values: no axes, no labels. Two points are
 * a slope, not a trend, so callers draw it only from three points up.
 */

import type { CSSProperties } from "react";

export function Sparkline({ values, width = 72, height = 26, className, style }: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Usually the colour: `{ color: "var(--c)" }` takes the tile's hue. */
  style?: CSSProperties;
}) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} style={style} aria-hidden>
      <path d={area} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={2.25} fill="currentColor" />
    </svg>
  );
}
