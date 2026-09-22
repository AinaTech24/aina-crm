import React from "react";
import { sql } from "drizzle-orm";
import { Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { AumSegmentChart } from "./AumSegmentChart";
import { EmptySection } from "./EmptySection";
import { FlowChartCard } from "./FlowChartCard";
import type { SessionUser } from "@/lib/auth/session";

export async function AumSegmentSection({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          -- 'Unsegmented', not 'Retail'. COALESCE'ing NULL to a real segment
          -- name reports clients as Retail who were never classified, and the
          -- tracker's own breakdown of the same column calls them Unsegmented —
          -- so the two disagreed about which bucket the same clients were in.
          COALESCE(NULLIF(segment_tag, ''), 'Unsegmented') AS segment,
          COUNT(*)::int AS client_count,
          COALESCE(SUM(aum::numeric), 0)::numeric AS total_aum
        FROM investors
        WHERE status = 'active' AND deleted_at IS NULL
        -- GROUP BY 1, not segment_tag: grouping by the RAW column while
        -- selecting the COALESCE'd one puts NULL and 'Retail' in separate
        -- groups, so the donut drew two different slices both labelled
        -- "Retail" — which is exactly what the legend was showing.
        GROUP BY 1
      `);
      return res.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const aumSegments = data.map((r) => ({
    name: String(r.segment),
    value: Number(r.total_aum),
    count: Number(r.client_count),
  }));

  if (!aumSegments.some((s) => s.value > 0)) {
    return (
      <EmptySection
        icon={Users}
        title="AUM by client segment"
        note="No valued holdings against an active client yet."
        href="/dashboard/investors"
        linkLabel="Clients"
      />
    );
  }

  return (
    <FlowChartCard title="AUM by Segment" subtitle="Active-client AUM across client categories" href="/dashboard/investors" hrefLabel="Clients">
      <AumSegmentChart data={aumSegments} />
    </FlowChartCard>
  );
}
