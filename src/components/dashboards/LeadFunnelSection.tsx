import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import { withTenant } from "@/db/client";
import { LeadFunnelChart } from "./LeadFunnelChart";
import { EmptySection } from "./EmptySection";
import { resolvePeriodDates, type Period } from "@/lib/dashboard/period";
import type { SessionUser } from "@/lib/auth/session";

export async function LeadFunnelSection({
  session,
  period = "mtd",
}: {
  session: SessionUser;
  period?: Period;
}) {
  const now = new Date();
  const { startISO: startOfPeriodISO } = resolvePeriodDates(period, now);

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stage IN ('call_done', 'contacted', 'meeting_scheduled', 'meeting_pending', 'meeting_done', 'won_lead', 'converted', 'post_meeting_qualified'))::int AS contacted,
          COUNT(*) FILTER (WHERE stage IN ('meeting_scheduled', 'meeting_pending', 'meeting_done', 'won_lead', 'converted', 'post_meeting_qualified'))::int AS meetings,
          COUNT(*) FILTER (WHERE stage IN ('won_lead', 'converted'))::int AS converted
        FROM leads
        WHERE created_at >= ${startOfPeriodISO} AND converted_investor_id IS NULL
      `);
      return res.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const total = Number(data?.total ?? 0);
  const contacted = Number(data?.contacted ?? 0);
  const meetings = Number(data?.meetings ?? 0);
  const converted = Number(data?.converted ?? 0);

  const funnelSteps = [
    { name: "Total Leads", value: total, percentage: 100 },
    {
      name: "Contacted",
      value: contacted,
      percentage: total > 0 ? (contacted / total) * 100 : 0,
    },
    {
      name: "Meetings",
      value: meetings,
      percentage: total > 0 ? (meetings / total) * 100 : 0,
    },
    {
      name: "Converted",
      value: converted,
      percentage: total > 0 ? (converted / total) * 100 : 0,
    },
  ];

  // A funnel scoped to the period is empty for most of any given month, so
  // this branch is the COMMON case, not the edge case. It gets one line.
  if (total === 0) {
    return (
      <EmptySection
        icon={Sparkles}
        title={`Lead funnel (${period.toUpperCase()})`}
        note="No leads created in this period."
        href="/dashboard/leads"
        linkLabel="Pipeline"
      />
    );
  }

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          Lead Funnel ({period.toUpperCase()})
        </h2>
        <Link href="/dashboard/leads" className="text-2xs text-muted-foreground hover:text-foreground font-medium">
          Pipeline →
        </Link>
      </div>
      <LeadFunnelChart data={funnelSteps} />
    </div>
  );
}
