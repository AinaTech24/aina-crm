import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Dashboard router. Dispatches to the right variant based on the user's
 * primary role. Owner / Branch Head → Owner cockpit. RM → RM dashboard.
 * Back Office → Ops dashboard. Marketing → Marketing dashboard. Compliance
 * sees a compliance-flavored summary.
 *
 * Role priority order (a user can hold many roles):
 *   owner > compliance > marketing > back_office/ops > rm/branch_head > team_member
 */

import Link from "next/link";
import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { LayoutDashboard, Star } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { OwnerCockpit } from "@/components/dashboards/OwnerCockpit";
import { DashboardHeaderBar } from "@/components/dashboards/DashboardHeaderBar";
import { resolvePeriodRange } from "@/lib/dashboard/period";
import { RmDashboard } from "@/components/dashboards/RmDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";
import { ComplianceCockpit } from "@/components/dashboards/ComplianceCockpit";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";
import { DashboardMemberFilter } from "@/components/dashboards/DashboardMemberFilter";
import { DashboardBranchFilter } from "@/components/dashboards/DashboardBranchFilter";
import { PeriodChips } from "@/components/dashboards/PeriodChips";
import { DashboardTabs } from "@/components/dashboards/DashboardTabs";
import { parseDashboardTab } from "@/lib/dashboard/tabs";
import { getDefaultBoard } from "@/lib/dashboards/service";
import { DashboardView } from "@/components/dashboards/custom/DashboardView";
import { DashboardPageSkeleton } from "@/components/dashboards/DashboardSkeletons";
import type { PlacedWidget } from "@/lib/dashboards/widgets";
import { ACTIVITY_RANGES, type ActivityRange } from "@/lib/dashboard/firm-pulse";

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
  // Owner cockpit custom-range window (Monthly / Quarterly / Custom range picks).
  const pfrom = (sp.pfrom ?? "").slice(0, 10) || undefined;
  const pto = (sp.pto ?? "").slice(0, 10) || undefined;
  const periodLabel = resolvePeriodRange(period, new Date(), { customStart: pstart, from: pfrom, to: pto }).label;
  // Per-user dashboards use an explicit date range (date_from/date_to); the
  // firm-wide OwnerCockpit still uses the period chips.
  const dateFrom = (sp.date_from ?? "").slice(0, 10);
  const dateTo = (sp.date_to ?? "").slice(0, 10);
  const rmParam = (sp.rm ?? "").trim();
  // Activity-tile window (?act=3|7|10|15|30). Kept in the URL rather than in
  // component state so the choice survives a refresh and can be shared.
  const actRaw = Number(sp.act);
  const activityDays: ActivityRange = (ACTIVITY_RANGES as readonly number[]).includes(actRaw)
    ? (actRaw as ActivityRange)
    : 7;

  // ── Custom default board ─────────────────────────────────────────────────
  // If the user has set one of their "My Dashboards" as default, render it here
  // instead of the role cockpit (unless ?std=1 forces the standard view).
  if (sp.std !== "1") {
    const board = await withTenant(session.tenantId, async (tx) => getDefaultBoard(tx, session.tenantId, session.userId));
    if (board) {
      const showMembers = can(roles, "dashboard.view.owner", perms);
      const members = showMembers
        ? await withTenant(session.tenantId, async (tx) => {
            const r = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name`);
            return (r.rows as { id: string; name: string }[]).map((m) => ({ id: String(m.id), name: m.name ?? "—" }));
          })
        : [];
      return (
        <>
          <AnnouncementsStrip session={session} />
          <PageHeaderCard title={<><Star className="size-4 text-amber-500" /> {board.name}</>}>
<div className="flex items-center gap-2 text-xs">
              <Link href="/dashboard/boards" className="text-muted-foreground hover:underline inline-flex items-center gap-1">
                <LayoutDashboard className="size-3.5" /> My Dashboards
              </Link>
              <Link href="/dashboard?std=1" className="text-muted-foreground hover:underline">Standard view</Link>
            </div>
</PageHeaderCard>
          <DashboardView layout={(board.layout as PlacedWidget[]) ?? []} members={members} initialRm={(board.filters as any)?.rm ?? ""} />
        </>
      );
    }
  }

  // Owner / Branch Head sees the full cockpit — plus a "Viewing" member
  // selector that scopes the dashboard to a single team member's RmDashboard.
  let dash: React.ReactNode;
  let memberBar: React.ReactNode = null;
  // View / Create / Period controls — shown on the right of the "Viewing" row,
  // only for the firm-wide Owner cockpit (not when drilled into one member).
  let headerControls: React.ReactNode = null;
  let tabsBar: React.ReactNode = null;
  const dashTab = parseDashboardTab(sp.tab);
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
    // Branch roster for the third filter. Date and member already existed;
    // branch did not, even though leads / investors / activities /
    // insurance_policies / insurance_claims all carry `branch_id`.
    const branches = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, name FROM branches
        WHERE tenant_id = ${session.tenantId}::uuid
        ORDER BY name ASC
      `);
      return (r.rows as { id: string; name: string }[]).map((b) => ({
        id: String(b.id),
        name: b.name ?? "—",
      }));
    });
    const branchParam = typeof sp.branch === "string" ? sp.branch : undefined;
    const selectedBranch = branchParam && branches.some((b) => b.id === branchParam) ? branchParam : null;

    const selected = rmParam ? members.find((m) => m.id === rmParam) : undefined;
    // Tabs belong to the firm-wide cockpit only — an RM drill-down has its own
    // layout and is short enough not to need splitting.
    if (!selected) {
      tabsBar = <DashboardTabs current={dashTab} />;
    }
    memberBar = (
      <>
        <DashboardMemberFilter
          members={members}
          selected={selected ? rmParam : ""}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
        <DashboardBranchFilter branches={branches} selected={selectedBranch} />
        <span className="h-5 w-px bg-border" aria-hidden />
        {/* Eight one-click ranges in front of the Period dropdown, which keeps
            the richer pickers (specific month / quarter / since / custom). */}
        <PeriodChips current={period} />
      </>
    );
    dash = selected ? (
      <RmDashboard session={session} targetUserId={selected.id} targetName={selected.name} from={dateFrom} to={dateTo} />
    ) : (
      <OwnerCockpit
        session={session}
        period={period}
        customStart={pstart}
        customFrom={pfrom}
        customTo={pto}
        activityDays={activityDays}
        branchId={selectedBranch}
        tab={dashTab}
        controls={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DashboardTabs current={dashTab} />
            <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light">
              {memberBar}
            </DashboardHeaderBar>
          </div>
        }
      />
    );
    if (!selected) {
      headerControls = (
        <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light">
          {memberBar}
        </DashboardHeaderBar>
      );
    }
  } else if (can(roles, "dashboard.view.compliance", perms)) {
    dash = <ComplianceCockpit session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.marketing", perms)) {
    dash = <MarketingDashboard session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.ops", perms)) {
    dash = <BackOfficeDashboard session={session} />;
  } else if (can(roles, "dashboard.view.rm", perms)) {
    dash = <RmDashboard session={session} from={dateFrom} to={dateTo} />;
  } else {
    // Team member fallback — just tasks
    dash = <RmDashboard session={session} limited from={dateFrom} to={dateTo} />;
  }

  return (
    <>
      {/* Live-refresh the dashboard data periodically (no manual reload).
          Conservative interval — pauses when the tab is hidden. */}
      <AutoRefresh intervalMs={30000} />
      <AnnouncementsStrip session={session} />
      {/* Tabs first, then filters: a tab chooses WHAT you are looking at, the
          filters refine it. Reading order should follow that. */}
      {/* Owner cockpit renders its own tabs + toolbar under the header card
          (reference order). Only the RM drill-down still needs them here. */}
      {!headerControls && tabsBar && <div className="mt-1 mb-3">{tabsBar}</div>}
      {!headerControls && memberBar && (
        <div className="mb-5 flex flex-wrap items-center gap-2">{memberBar}</div>
      )}
      {/* The role cockpits are async server components doing their own data
          fetching — stream them in behind a skeleton so the shell (sidebar,
          topbar, announcements) paints immediately. */}
      <Suspense fallback={<DashboardPageSkeleton />}>{dash}</Suspense>
    </>
  );
}

