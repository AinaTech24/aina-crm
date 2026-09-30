/**
 * §42 monthly insurance scorecard · §43 weekly review — one panel, two modes.
 */

import { ClipboardList } from "lucide-react";
import type { Compare } from "@/lib/dashboard/insurance/review";
import { Section } from "@/components/dashboards/my/Shared";
import { CompareTable } from "./InsKpis";
import { LinkToggle } from "./parts";

export function ReviewPanel({ mode, c, hrefs, qualityPct }: { mode: "weekly" | "monthly"; c: Compare; hrefs: Record<string, string>; qualityPct: string }) {
  return (
    <Section title={mode === "monthly" ? "Monthly insurance scorecard" : "Weekly insurance review"}
      subtitle={mode === "monthly"
        ? "This month to date against the same days of last month and of the same month last year."
        : "This week to date against the same weekdays last week."}
      icon={<ClipboardList className="size-4" />}
      action={<LinkToggle current={mode} options={[
        { key: "weekly", label: "Weekly review", href: hrefs.weekly }, { key: "monthly", label: "Monthly scorecard", href: hrefs.monthly },
      ]} />}
      note={`Branch and RM contribution are in the tables above. Insurance data is ${qualityPct} complete today. A figure marked “Now” is a snapshot, not a flow.`}>
      <CompareTable c={c} />
    </Section>
  );
}
