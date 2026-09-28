import type { LeadPipeline as LeadPipelineData } from "@/lib/dashboard/lead-pipeline";
import { FlowChartCard } from "./FlowChartCard";
import { LeadPipelineChart } from "./LeadPipelineChart";
import { EmptySection } from "./EmptySection";
import { Filter } from "lucide-react";

/**
 * Lead pipeline — stage occupancy now, as a flat bar chart in the reference's
 * chart-card chrome. Main-path stages in blueprint order; call-back loops are
 * appended after them so nothing open goes uncounted; dead ends are left out of
 * the chart and summarised in the subtitle instead.
 */
export function LeadPipeline({ data }: { data: LeadPipelineData }) {
  const { path, loops, closed, openTotal, overdueTotal } = data;
  if (openTotal === 0 && closed.every((c) => c.count === 0)) {
    return (
      <EmptySection
        icon={Filter}
        title="Lead pipeline"
        note="No open leads. New leads appear here as soon as they are added."
        href="/dashboard/leads"
        linkLabel="All leads"
      />
    );
  }
  const rows = [...path, ...loops.filter((b) => b.count > 0)].map((b) => ({
    name: b.name,
    count: b.count,
    overdue: b.overdue,
  }));
  const lost = closed.find((c) => c.key === "not_qualified")?.count ?? 0;
  const subtitle =
    `${openTotal.toLocaleString("en-IN")} open` +
    (overdueTotal ? ` · ${overdueTotal.toLocaleString("en-IN")} past stage SLA` : "") +
    (lost ? ` · ${lost} lost` : "");

  return (
    <FlowChartCard title="Lead Pipeline" subtitle={subtitle} href="/dashboard/leads" hrefLabel="All leads">
      <LeadPipelineChart data={rows} />
    </FlowChartCard>
  );
}
