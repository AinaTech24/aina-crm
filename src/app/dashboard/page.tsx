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
import { OwnerCockpit } from "@/components/dashboards/OwnerCockpit";
import { RmDashboard } from "@/components/dashboards/RmDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const roles = session.roles;

  // Owner / Branch Head sees the full cockpit
  if (roles.includes("owner") || roles.includes("branch_head")) {
    return <OwnerCockpit session={session} />;
  }
  if (roles.includes("compliance")) {
    return <OwnerCockpit session={session} />; // shares cockpit; compliance has full visibility
  }
  if (roles.includes("marketing")) {
    return <MarketingDashboard session={session} />;
  }
  if (roles.includes("back_office") || roles.includes("ops")) {
    return <BackOfficeDashboard session={session} />;
  }
  if (roles.includes("rm")) {
    return <RmDashboard session={session} />;
  }
  // Team member fallback — just tasks
  return <RmDashboard session={session} limited />;
}
