/**
 * Dashboard router. Dispatches to the right variant based on the user's
 * primary role. Owner / Branch Head → Owner cockpit. RM → RM dashboard.
 * Back Office → Ops dashboard. Marketing → Marketing dashboard. Compliance
 * sees a compliance-flavored summary.
 *
 * Role priority order (a user can hold many roles):
 *   owner > compliance > marketing > back_office/ops > rm/branch_head > team_member
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { OwnerCockpit } from "@/components/dashboards/OwnerCockpit";
import { RmDashboard } from "@/components/dashboards/RmDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";
import { ComplianceCockpit } from "@/components/dashboards/ComplianceCockpit";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";
import { DashboardMemberFilter } from "@/components/dashboards/DashboardMemberFilter";

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
  const rmParam = (sp.rm ?? "").trim();

  // Owner / Branch Head sees the full cockpit — plus a "Viewing" member
  // selector that scopes the dashboard to a single team member's RmDashboard.
  let dash: React.ReactNode;
  let memberBar: React.ReactNode = null;
  if (can(roles, "dashboard.view.owner", perms)) {
    // Active-user roster drives the member dropdown. Tenant-scoped by RLS.
    const members = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, name FROM users
        WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
        ORDER BY name ASC
      `);
      return (r.rows as { id: string; name: string }[]).map((m) => ({
        id: String(m.id),
        name: m.name ?? "—",
      }));
    });
    const selected = rmParam ? members.find((m) => m.id === rmParam) : undefined;
    memberBar = (
      <DashboardMemberFilter
        members={members}
        selected={selected ? rmParam : ""}
        period={period}
        pstart={pstart}
      />
    );
    dash = selected ? (
      <RmDashboard session={session} targetUserId={selected.id} targetName={selected.name} />
    ) : (
      <OwnerCockpit session={session} period={period} customStart={pstart} />
    );
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
      {memberBar}
      {dash}
    </>
  );
}

