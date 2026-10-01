/**
 * The ONE loading state for a dashboard (D6): the header and the four rows —
 * KPI cards, Needs attention beside the lead pipeline, the team table, money
 * movement — then the page renders together.
 */

import { WidgetSkeleton } from "@/components/dashboards/system/WidgetCard";

export default function DashboardLoading() {
  return (
    <div className="dash-canvas space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex items-start justify-between gap-3 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-56 rounded bg-secondary" />
          <div className="h-3 w-32 rounded bg-secondary" />
        </div>
        <div className="hidden lg:flex gap-2">
          <div className="h-8 w-48 rounded-lg bg-secondary" />
          <div className="h-8 w-24 rounded-lg bg-secondary" />
          <div className="h-8 w-24 rounded-lg bg-secondary" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card-surface h-24" />
        ))}
      </div>
      <div className="grid grid-cols-12 gap-4">
        <WidgetSkeleton size="M" lines={6} />
        <WidgetSkeleton size="M" lines={6} />
        <WidgetSkeleton size="L" lines={5} />
        <WidgetSkeleton size="L" lines={3} />
      </div>
    </div>
  );
}
