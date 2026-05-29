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

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const roles = session.roles;
  const perms = session.permissions;

  // Owner / Branch Head sees the full cockpit
  if (can(roles, "dashboard.view.owner", perms)) {
    return <OwnerCockpit session={session} />;
  }
  if (can(roles, "dashboard.view.compliance", perms)) {
    return <OwnerCockpit session={session} />; // shares cockpit; compliance has full visibility
  }
  if (can(roles, "dashboard.view.marketing", perms)) {
    return <MarketingDashboard session={session} />;
  }
  if (can(roles, "dashboard.view.ops", perms)) {
    return <BackOfficeDashboard session={session} />;
  }
  if (can(roles, "dashboard.view.rm", perms)) {
    return <RmDashboard session={session} />;
  }
  // Team member fallback — just tasks
  return <RmDashboard session={session} limited />;
}
