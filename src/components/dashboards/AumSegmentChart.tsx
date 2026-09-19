"use client";

import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatINR, formatINRShort } from "@/lib/utils";
import { CHART_SERIES, TOOLTIP_STYLE } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";

type SegmentData = { name: string; value: number; count: number };

/**
 * Thick flat donut with a centre label and a dot legend — the reference's
 * "Project Status" / "Deal Health" treatment.
 *
 * The centre label is a Recharts <Label> INSIDE the pie, not an absolutely
 * positioned overlay. The overlay depended on arbitrary Tailwind classes to
 * find the centre; when those failed to reach the page it landed on the
 * legend. A Label is positioned by the chart itself and cannot drift.
 */
export function AumSegmentChart({ data }: { data: SegmentData[] }) {
  const totalAum = data.reduce((sum, item) => sum + item.value, 0);

  if (!data.some((d) => d.value > 0)) {
    return (
      <div className="h-72 grid place-items-center text-xs text-muted-foreground">
        No active client AUM data available.
      </div>
    );
  }

  return (
    <ChartMount className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="46%"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={1.5}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={CHART_SERIES[index % CHART_SERIES.length]} />
            ))}
            <Label
              position="center"
              content={({ viewBox }) => {
                const vb = viewBox as { cx?: number; cy?: number } | undefined;
                const cx = vb?.cx ?? 0;
                const cy = vb?.cy ?? 0;
                return (
                  <g>
                    <text x={cx} y={cy - 10} textAnchor="middle" fontSize={13} fill="#6B7280">
                      Active AUM
                    </text>
                    <text x={cx} y={cy + 14} textAnchor="middle" fontSize={18} fontWeight={600} fill="#111827">
                      {formatINRShort(totalAum)}
                    </text>
                  </g>
                );
              }}
            />
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name, item) => {
              const count = Number((item as { payload?: { count?: number } }).payload?.count ?? 0);
              return [`${formatINR(Number(value ?? 0))} (${count} clients)`, String(name ?? "")];
            }}
          />
          <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
