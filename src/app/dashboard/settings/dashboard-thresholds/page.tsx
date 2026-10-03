import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/common/EmptyState";
import { Gauge } from "lucide-react";
import {
  CONFIGURABLE_THRESHOLDS, DEFAULT_DASHBOARD_THRESHOLDS, sanitizeThresholdOverrides,
} from "@/lib/dashboard/thresholds";
import { ThresholdsForm } from "./ThresholdsForm";

export const dynamic = "force-dynamic";

/**
 * Settings → Dashboard thresholds.
 *
 * The lines the dashboards draw — the RM target matrix's amber band, target
 * phasing, when a lead is stale, when a proposal needs attention, the SLAs the
 * attention centre escalates on. The branch brief forbids hard-coding them, so
 * they are firm settings with the code defaults underneath.
 */
export default async function DashboardThresholdsPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.dashboard", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={Gauge}
          title="Only an administrator can change dashboard thresholds"
          description="These values decide what every dashboard in the firm calls on-target, stale or overdue, so they are an administrator setting. Ask the firm owner if one needs to change."
          primary={{ href: "/dashboard/settings", label: "Back to settings" }}
        />
      </div>
    );
  }

  const overrides = await withTenant(session.tenantId, async (tx) => {
    const row = (await tx.execute(sql`
      SELECT settings FROM dashboard_settings WHERE tenant_id = ${session.tenantId}::uuid
    `)).rows[0] as { settings: unknown } | undefined;
    return sanitizeThresholdOverrides(row?.settings);
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderCard
        title="Dashboard thresholds"
        breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Dashboard thresholds" }]}
      />
      <ThresholdsForm
        fields={CONFIGURABLE_THRESHOLDS as unknown as Parameters<typeof ThresholdsForm>[0]["fields"]}
        defaults={DEFAULT_DASHBOARD_THRESHOLDS as unknown as Record<string, unknown>}
        overrides={overrides as Record<string, unknown>}
      />
    </div>
  );
}
