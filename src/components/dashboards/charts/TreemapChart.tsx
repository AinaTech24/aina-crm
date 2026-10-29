"use client";

/**
 * The book as tiles sized by money: asset class (colour) › category (tile).
 * A tile is named only when the name fits inside it; every tile carries its
 * value and share in the tooltip, and the card lists the classes beneath.
 */

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatMoney, formatPercent } from "@/lib/format";
import { ChartMount } from "../ChartMount";

export type TreemapGroup = { name: string; color: string; children: Array<{ name: string; value: number }> };

type Leaf = { name: string; size: number; fill: string; group: string; share: number };

function Tile(props: Record<string, unknown>) {
  const { x, y, width, height, depth, name, fill, share } = props as {
    x: number; y: number; width: number; height: number; depth: number; name: string; fill: string; share: number;
  };
  if (depth !== 2) return null;
  const w = Math.max(0, width - 2);
  const h = Math.max(0, height - 2);
  const label = w > 70 && h > 34;
  return (
    <g>
      <rect x={x + 1} y={y + 1} width={w} height={h} rx={5} fill={fill} />
      {label && (
        <>
          <text x={x + 9} y={y + 19} fontSize={12} fontWeight={600} fill="#FFFFFF">
            {name.length * 7 > w - 12 ? `${name.slice(0, Math.max(3, Math.floor((w - 12) / 7) - 1))}…` : name}
          </text>
          <text x={x + 9} y={y + 34} fontSize={11} fill="#FFFFFF" fillOpacity={0.9}>{formatPercent(share, 0)}</text>
        </>
      )}
    </g>
  );
}

export function TreemapChart({ groups, height = 260 }: { groups: TreemapGroup[]; height?: number }) {
  const total = groups.reduce((a, g) => a + g.children.reduce((b, c) => b + c.value, 0), 0) || 1;
  // A group's tiles step down in strength so neighbours inside it stay apart.
  const data = groups.map((g) => ({
    name: g.name,
    children: g.children
      .slice()
      .sort((a, b) => b.value - a.value)
      .map((c, i): Leaf => ({
        name: c.name, size: c.value, group: g.name, share: (c.value / total) * 100,
        // Capped so white labels keep their contrast on the lightest tile.
        fill: shade(g.color, Math.min(i, 3) * 0.09),
      })),
  }));
  return (
    <ChartMount className="w-full">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap data={data} dataKey="size" aspectRatio={4 / 3} isAnimationActive={false} content={<Tile />}>
            <Tooltip
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as Leaf | undefined);
                if (!p || !p.group) return null;
                return (
                  <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                    <div style={{ fontWeight: 600 }}>{p.group} › {p.name}</div>
                    <div style={{ color: CHART_INK.tick }}>{formatMoney(p.size)} · {formatPercent(p.share, 1)} of the book</div>
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </ChartMount>
  );
}

/** Mix a hex colour toward white by `t` (0–1). */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
