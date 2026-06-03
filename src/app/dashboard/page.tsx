/**
 * Dashboard router. Dispatches to the right variant based on the user's
 * primary role. Owner / Branch Head → Owner cockpit. RM → RM dashboard.
 * Back Office → Ops dashboard. Marketing → Marketing dashboard. Compliance
 * sees a compliance-flavored summary.
 *
 * Role priority order (a user can hold many roles):
 *   owner > compliance > marketing > back_office/ops > rm/branch_head > team_member
 */

import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { OwnerCockpit } from "@/components/dashboards/OwnerCockpit";
import { RmDashboard } from "@/components/dashboards/RmDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";
import { ComplianceCockpit } from "@/components/dashboards/ComplianceCockpit";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const roles = session.roles;
  const perms = session.permissions;
  const sp = await searchParams;
  const period = (sp.period ?? "mtd") as "mtd" | "qtd" | "fytd" | "lm" | "custom";
  const pstart = sp.pstart;

  // Owner / Branch Head sees the full cockpit
  let dash: React.ReactNode;
  if (can(roles, "dashboard.view.owner", perms)) {
    dash = <OwnerCockpit session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.compliance", perms)) {
    dash = <ComplianceCockpit session={session} />;
  } else if (can(roles, "dashboard.view.marketing", perms)) {
    dash = <MarketingDashboard session={session} />;
  } else if (can(roles, "dashboard.view.ops", perms)) {
    dash = <BackOfficeDashboard session={session} />;
  } else if (can(roles, "dashboard.view.rm", perms)) {
    dash = <RmDashboard session={session} />;
  } else {
    // Team member fallback — just tasks
    dash = <RmDashboard session={session} limited />;
  }

  return (
    <>
      <AnnouncementsStrip session={session} />
      {dash}
    </>
  );
}

