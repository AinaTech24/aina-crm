"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CHART, CHART_INK } from "@/lib/dashboard/chart-palette";
import { ChartMount } from "./ChartMount";

type CampaignRoi = {
  name: string;
  sent: number;
  read: number;
  replied: number;
};

export function CampaignRoiChart({ data }: { data: CampaignRoi[] }) {
  if (!data.length) {
    return (
      <div className="h-48 grid place-items-center text-xs text-muted-foreground">
        No campaign broadcasts in this period.
      </div>
    );
  }

  return (
    <ChartMount className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: CHART_INK.tick }} />
          <YAxis tick={{ fontSize: 9, fill: CHART_INK.tick }} />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: "0.5rem",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="sent" fill={CHART.navy} name="Sent" />
          <Bar dataKey="read" fill={CHART.blue} name="Read" />
          <Bar dataKey="replied" fill={CHART.green} name="Replied" />
        </BarChart>
      </ResponsiveContainer>
    </ChartMount>
  );
}
