import Link from "next/link";
import type { ProgressRow } from "@/lib/dashboard/target-progress";
import { formatINRShort } from "@/lib/utils";
import { FlowChartCard } from "./FlowChartCard";
import { TargetBarChart } from "./TargetBarChart";

/**
 * Target achievement — the firm against its own annual targets, as a bar chart
 * in the reference's chart language. The pace line is the part the competitor
 * has no answer to: 50% is good news in September and bad news in February.
 */
export function TargetAchievement({
  rows,
  fy,
  elapsed,
}: {
  rows: ProgressRow[];
  fy: string;
  /** Fraction of the financial year gone, 0..1. */
  elapsed: number;
}) {
  const withTargets = rows.filter((r) => r.target > 0);
  const expectedPct = Math.round(elapsed * 100);

  if (withTargets.length === 0) {
    return (
      <FlowChartCard title="Target Achievement" subtitle={`FY ${fy}`}>
        <div className="text-sm leading-relaxed text-muted-foreground">
          No annual targets set for FY {fy} yet.{" "}
          <Link href="/dashboard/settings/targets" className="text-primary underline">
            Set them in Settings
          </Link>{" "}
          and the firm&apos;s progress against each one shows here.
        </div>
      </FlowChartCard>
    );
  }

  const data = withTargets.map((r) => {
    const fmt = (v: number) => (r.kind === "currency" ? formatINRShort(v) : v.toLocaleString("en-IN"));
    return {
      name: r.label.replace(/ generated| added \(net\)| addition| done/gi, ""),
      pct: Math.min(100, Math.round((r.total / r.target) * 100)),
      value: fmt(r.total),
      target: fmt(r.target),
    };
  });

  return (
    <FlowChartCard
      title="Target Achievement"
      subtitle={`FY ${fy} · dashed line marks the ${expectedPct}% year-elapsed pace`}
      href="/dashboard/finances/progress"
      hrefLabel="Month by month"
    >
      <TargetBarChart data={data} expectedPct={expectedPct} />
    </FlowChartCard>
  );
}
