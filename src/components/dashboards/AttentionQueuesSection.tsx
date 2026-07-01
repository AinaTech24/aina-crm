import React from "react";
import { sql } from "drizzle-orm";
import { ClipboardList, AlertOctagon } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { Group, Stat } from "./DashboardShared";

export async function AttentionQueuesSection({ session }: { session: SessionUser }) {
  const dormantCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL AND next_review_at IS NOT NULL
                AND next_review_at <= now()) AS reviews_due,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE status IN ('open', 'in_progress')) AS sr_pending,
          (SELECT COUNT(*)::int FROM service_requests
              WHERE status IN ('open', 'in_progress') AND type = 'complaint') AS complaints_open,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL AND service_tier = 'A'
                AND (last_review_at IS NULL OR last_review_at < now() - interval '120 days')) AS hni_not_reviewed,
          (SELECT COUNT(*)::int FROM investors
              WHERE status = 'active' AND deleted_at IS NULL
                AND (last_transaction_at IS NULL OR last_transaction_at < ${dormantCutoff})) AS dormant_clients
      `);
      return res.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <Group title="Needs attention">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat
          href="/dashboard/review-meetings"
          label="Review Meetings Due"
          value={String(data.reviews_due ?? 0)}
          tone={Number(data.reviews_due ?? 0) > 0 ? "amber" : "muted"}
          icon={ClipboardList}
        />
        <Stat
          href="/dashboard/service-requests"
          label="Pending Service Requests"
          value={String(data.sr_pending ?? 0)}
          tone={Number(data.sr_pending ?? 0) > 0 ? "amber" : "muted"}
        />
        <Stat
          href="/dashboard/complaints"
          label="Open Complaints"
          value={String(data.complaints_open ?? 0)}
          tone={Number(data.complaints_open ?? 0) > 0 ? "rose" : "muted"}
          icon={AlertOctagon}
        />
        <Stat
          href="/dashboard/reports/high_aum"
          label="High-AUM Not Reviewed"
          value={String(data.hni_not_reviewed ?? 0)}
          tone={Number(data.hni_not_reviewed ?? 0) > 0 ? "rose" : "muted"}
        />
        <Stat
          href="/dashboard/reports/dormant"
          label="Dormant Clients"
          value={String(data.dormant_clients ?? 0)}
          tone={Number(data.dormant_clients ?? 0) > 0 ? "amber" : "muted"}
        />
      </div>
    </Group>
  );
}
