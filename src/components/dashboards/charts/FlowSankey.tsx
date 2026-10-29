"use client";

/**
 * Where leads come from and where they end up: source → reached a meeting or
 * not → won / still open / lost. Band width is the number of leads. Recharts
 * Sankey; nodes carry their own resolved-hex colour.
 */

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { CHART_INK, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { formatCount } from "@/lib/format";
import { ChartMount } from "../ChartMount";

export type SankeyNode = { name: string; color: string };
export type SankeyLink = { source: number; target: number; value: number };

function Node(props: Record<string, unknown>) {
  const { x, y, width, height, index, payload, containerWidth } = props as {
    x: number; y: number; width: number; height: number; index: number;
    payload: SankeyNode & { value: number; depth?: number }; containerWidth: number;
  };
  // The first column is labelled on its left; every later column on its right.
  const right = (payload.depth ?? (x > containerWidth / 2 ? 1 : 0)) > 0;
  return (
    <g key={index}>
      <rect x={x} y={y} width={width} height={Math.max(2, height)} rx={3} fill={payload.color} />
      <text x={right ? x + width + 6 : x - 6} y={y + height / 2} dy={-2} textAnchor={right ? "start" : "end"}
        fontSize={12} fontWeight={600} fill={CHART_INK.reference}>{payload.name}</text>
      <text x={right ? x + width + 6 : x - 6} y={y + height / 2} dy={12} textAnchor={right ? "start" : "end"}
        fontSize={11} fill={CHART_INK.tick}>{formatCount(payload.value)}</text>
    </g>
  );
}

function Band(props: Record<string, unknown>) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props as {
    sourceX: number; targetX: number; sourceY: number; targetY: number; sourceControlX: number; targetControlX: number;
    linkWidth: number; payload: { source: SankeyNode };
  };
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none" stroke={payload.source.color} strokeOpacity={0.28} strokeWidth={Math.max(1, linkWidth)}
    />
  );
}

export function FlowSankey({ nodes, links, height = 280 }: { nodes: SankeyNode[]; links: SankeyLink[]; height?: number }) {
  return (
    <ChartMount className="w-full">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes, links }}
            node={<Node />}
            link={<Band />}
            nodePadding={14}
            nodeWidth={12}
            margin={{ top: 8, right: 124, bottom: 8, left: 96 }}
            iterations={32}
          >
            <Tooltip
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as { source?: SankeyNode; target?: SankeyNode; value?: number; name?: string } | undefined;
                if (!p) return null;
                const text = p.source && p.target ? `${p.source.name} → ${p.target.name}` : p.name;
                return (
                  <div style={{ ...TOOLTIP_STYLE, padding: "6px 10px" }}>
                    {text}: <b>{formatCount(p.value ?? 0)}</b>
                  </div>
                );
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </ChartMount>
  );
}
