import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/common/EmptyState";
import { CalendarCheck } from "lucide-react";
import { loadTrackerSettings } from "@/lib/team/daily-discipline";
import { DailyTrackerSettingsForm } from "./DailyTrackerSettingsForm";

export const dynamic = "force-dynamic";

/** Settings → Daily tracker: the time the team is reminded, once, to fill in the day's tracker. */
export default async function DailyTrackerSettingsPage() {
  const session = await requireSession();
  if (!can(session.roles, "settings.dashboard", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={CalendarCheck}
          title="Only an administrator can change the tracker reminder"
          description="It decides when the whole team is reminded to fill in the Daily Job Tracker. Ask the firm owner if it needs to change."
          primary={{ href: "/dashboard/settings", label: "Back to settings" }}
        />
      </div>
    );
  }
  const settings = await withTenant(session.tenantId, (tx) => loadTrackerSettings(tx, session.tenantId));
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard
        title="Daily tracker"
        breadcrumb={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Daily tracker" }]}
      />
      <DailyTrackerSettingsForm initial={settings.remindAt} />
    </div>
  );
}
