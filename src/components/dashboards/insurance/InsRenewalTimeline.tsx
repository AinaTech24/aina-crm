/**
 * Renewals in the next 90 days on a timeline, one row per product group,
 * each policy a bubble sized by its installment — beside the due-date
 * buckets, so the big renewals close at hand are seen first.
 */

import { CalendarClock } from "lucide-react";
import { Section } from "@/components/dashboards/my/Shared";
import { RenewalTimeline } from "@/components/dashboards/charts/RenewalTimeline";
import { GROUP_LABEL } from "@/lib/insurance/book";
import { formatCount } from "@/lib/format";
import type { RenewalPointRow } from "@/lib/dashboard/insurance/renewals";

const MAX_ROWS = 6;

export function RenewalTimelinePanel({ rows, total }: { rows: RenewalPointRow[]; total: number }) {
  if (!rows.length) return null;
  // The largest groups get a row each; the rest share one.
  const byGroup = new Map<string, number>();
  for (const r of rows) byGroup.set(r.group, (byGroup.get(r.group) ?? 0) + r.premium);
  const keep = new Set([...byGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ROWS - 1).map(([g]) => g));
  const label = (g: string) => (keep.has(g) || byGroup.size <= MAX_ROWS ? GROUP_LABEL[g] ?? "Unclassified" : "Other lines");
  return (
    <Section
      title="Renewals in the next 90 days"
      subtitle={`${formatCount(total)} polic${total === 1 ? "y" : "ies"} due; bubble size is the installment.`}
      icon={<CalendarClock className="size-4" />}
      note={total > rows.length ? `Showing the ${formatCount(rows.length)} largest.` : undefined}
    >
      <RenewalTimeline
        points={rows.map((r) => ({
          days: r.days, premium: r.premium, line: label(r.group), client: r.client,
          product: r.product,
        }))}
      />
    </Section>
  );
}
