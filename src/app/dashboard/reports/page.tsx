import Link from "next/link";
import { BarChart3, FileBarChart } from "lucide-react";
import { ReportsGrid } from "@/components/reports/ReportsGrid";
import { HelpTip } from "@/components/common/HelpTip";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { REPORTS } from "@/lib/reports/catalog";

export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const sections = REPORTS.map((g) => ({
    group: g.group,
    frequency: g.frequency,
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
      {/* Was a hand-rolled heading, which is why this page alone had no
          breadcrumb while every list screen around it did. */}
      <PageHeaderCard
        title={
          <>
            <FileBarChart className="size-6 text-muted-foreground" /> Reports
            <HelpTip title="Reports">
              Every MIS and analytics report, grouped by area. Business &amp; SIP numbers, team
              performance, retention &amp; tax, and the new Practice Intelligence reports (risk-drift,
              referrals, revenue).
            </HelpTip>
          </>
        }
        actions={
          <Link href="/dashboard/reports/custom" className="btn-primary whitespace-nowrap">
            <BarChart3 className="size-4" /> Custom Reports
          </Link>
        }
      />

      <ReportsGrid sections={sections} />
    </div>
  );
}
