import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { ReportsGrid } from "@/components/reports/ReportsGrid";
import { HelpTip } from "@/components/common/HelpTip";
import { REPORTS } from "@/lib/reports/catalog";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const sections = REPORTS.map((g) => ({
    group: g.group,
    items: g.items.map((i) => ({
      key: i.key,
      label: i.label,
      iconName: i.icon,
      desc: i.desc,
      aliases: i.aliases,
      href: i.href ?? `/dashboard/reports/${i.key}`,
    })),
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          {/* The help affordance belongs beside the TITLE — hung off the block
              it read as a stray icon floating past the end of the description. */}
          <h1 className="page-title">
            Reports
            <HelpTip title="Reports">
              Every MIS and analytics report, grouped by area. Business &amp; SIP numbers, team
              performance, retention &amp; tax, and the new Practice Intelligence reports (risk-drift,
              referrals, revenue).
            </HelpTip>
          </h1>
          <p className="page-subtitle mt-1">Every report your firm can run, grouped by the question it answers.</p>
        </div>
        <Link href="/dashboard/reports/custom" className="btn-primary whitespace-nowrap">
          <BarChart3 className="size-4" /> Custom Reports
        </Link>
      </div>

      <ReportsGrid sections={sections} />
    </div>
  );
}
