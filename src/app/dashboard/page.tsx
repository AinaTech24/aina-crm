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
import { LayoutDashboard, Star, Store } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { OwnerCockpit } from "@/components/dashboards/OwnerCockpit";
import { DashboardHeaderBar } from "@/components/dashboards/DashboardHeaderBar";
import { resolvePeriodRange, resolvePreviousRange, type Period } from "@/lib/dashboard/period";
import { AppliedFilterChips, type AppliedFilter } from "@/components/dashboards/AppliedFilterChips";
import { RmDashboard } from "@/components/dashboards/RmDashboard";
import { BackOfficeDashboard } from "@/components/dashboards/BackOfficeDashboard";
import { MarketingDashboard } from "@/components/dashboards/MarketingDashboard";
import { ComplianceCockpit } from "@/components/dashboards/ComplianceCockpit";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";
import { DashboardMemberFilter } from "@/components/dashboards/DashboardMemberFilter";
import { DashboardBranchFilter } from "@/components/dashboards/DashboardBranchFilter";
import { DashboardTabs } from "@/components/dashboards/DashboardTabs";
import { DashboardScopeSwitch } from "@/components/dashboards/DashboardScopeSwitch";
import { MyBusinessDashboard } from "@/components/dashboards/MyBusinessDashboard";
import { BranchCommandCentre } from "@/components/dashboards/BranchCommandCentre";
import { EmptyState } from "@/components/common/EmptyState";
import { isBranchScoped } from "@/lib/leads/access";
import { parseDashboardTab } from "@/lib/dashboard/tabs";
import { parseDashboardScope, type DashboardScope } from "@/lib/dashboard/scope";
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

  // ── Which BOOK — and which books this viewer may open at all ─────────────
  // See lib/dashboard/scope.ts. Parsing the URL is not permission; this is.
  //
  // `dashboard.view.all_branches` is the explicit cross-branch grant (the
  // owner always holds it). A branch head without it is LOCKED to their own
  // branch here: the branch command centre is their default, `?branch=` is
  // ignored, and the firm-wide cockpit is not offered — the brief's rule, "do
  // not allow access to another branch unless explicitly permitted by CRM
  // security". The lock uses the same test the client and lead lists already
  // apply (isBranchScoped: branch head, not owner, with a branch).
  //
  // A branch head with NO branch set cannot be given a branch view; asking for
  // one shows why, rather than silently widening to the whole firm.
  const allBranches = can(roles, "dashboard.view.all_branches", perms);
  const branchLocked = isBranchScoped(session) && !allBranches;
  // A locked branch head always has their OWN branch view — it is the one
  // dashboard the lock leaves them. That also covers a head whose permissions
  // were customised before `dashboard.view.branch` existed: a non-empty
  // permission list is an allow-list, and without this they would have no
  // way back to their branch from "My portfolio".
  const canBranchView =
    allBranches || (!!session.branchId && (branchLocked || can(roles, "dashboard.view.branch", perms)));
  const canFirmView = can(roles, "dashboard.view.owner", perms) && !branchLocked;
  // An RM's home is their own desk — "My Client & Business Dashboard". Someone
  // with no firm, compliance, marketing or ops cockpit but an RM dashboard has
  // no firm-wide view to default to, so "My portfolio" is their dashboard.
  const rmHome =
    !canFirmView && !branchLocked &&
    !can(roles, "dashboard.view.compliance", perms) &&
    !can(roles, "dashboard.view.marketing", perms) &&
    !can(roles, "dashboard.view.ops", perms) &&
    can(roles, "dashboard.view.rm", perms);
  const requested = parseDashboardScope(sp.scope);
  const scope: DashboardScope =
    requested === "mine" ? "mine"
    : requested === "branch" ? (canBranchView ? "branch" : rmHome ? "mine" : "firm")
    : branchLocked ? "branch"
    : rmHome ? "mine"
    : "firm";
  const branchUnassigned = requested === "branch" && !canBranchView && roles.includes("branch_head") && !session.branchId;
  const availableScopes: DashboardScope[] = [
    ...(canFirmView ? (["firm"] as const) : []),
    ...(canBranchView ? (["branch"] as const) : []),
    "mine",
  ];

  // FY to date is the director's default frame — a month-to-date view on the
  // 2nd of the month says almost nothing about the business.
  //
  // The personal cockpit and the branch command centre default to MTD instead,
  // which is what both briefs ask for and is the right frame one level down:
  // the month is the unit a branch and an RM are chased on, and every tile
  // carries its FYTD figure underneath anyway, so nothing is lost.
  const period = (sp.period ?? (scope === "mine" || scope === "branch" ? "mtd" : "fytd")) as Period;
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
  //
  // An explicit `?scope=` beats a saved default board. Without that exception
  // a user who has set one would click "My portfolio" and land back on their
  // board — the switch would appear broken, with nothing on screen explaining
  // why. A URL the reader asked for wins over a preference they set once.
  if (sp.std !== "1" && !sp.scope) {
    const board = await withTenant(session.tenantId, async (tx) => getDefaultBoard(tx, session.tenantId, session.userId));
    if (board) {
      // A branch-locked head does not get the firm-wide member roster here —
      // the same wall as the branch view.
      const showMembers = canFirmView;
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

  // ── My portfolio: the RM desk ────────────────────────────────────────────
  // `?scope=mine` — and the DEFAULT for an RM — shows the signed-in user's own
  // book as "My Client & Business Dashboard". Offered to anyone who can see a
  // dashboard at all: a director and a branch head who carry clients have a
  // desk too. It returns early because none of the firm-wide filter machinery
  // below (member picker, branch picker, tabs) means anything on one person's
  // book. The desk parses its own URL state (action day, client filters,
  // target horizon…) from `sp`.
  if (scope === "mine") {
    return (
      <>
        {/* Two minutes, not thirty seconds: the desk runs about thirty
            loaders. It pauses while the tab is hidden, and refreshes the
            moment the RM comes back to it. */}
        <AutoRefresh intervalMs={120000} />
        <AnnouncementsStrip session={session} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <MyBusinessDashboard
            session={session}
            period={period}
            customStart={pstart}
            customFrom={pfrom}
            customTo={pto}
            sp={sp}
            scopeSwitch={<DashboardScopeSwitch current="mine" available={availableScopes} />}
          />
        </Suspense>
      </>
    );
  }

  // ── Branch command centre ───────────────────────────────────────────────
  // `?scope=branch` — and the DEFAULT for a branch-locked head. Which branch
  // is decided here and nowhere else: a locked viewer always gets their own
  // (`?branch=` is ignored); a viewer with cross-branch access may pick one,
  // falling back to their own, then to the first branch.
  if (branchUnassigned) {
    return (
      <>
        <AnnouncementsStrip session={session} />
        <div className="mt-6">
          <EmptyState
            icon={Store}
            title="No branch is set on your user"
            description="The branch command centre shows one branch — yours — and your user has no branch assigned, so there is nothing to show. An administrator can set it in Team → Employees. Your own book is still available."
            primary={{ href: "/dashboard?scope=mine", label: "Open my portfolio" }}
          />
        </div>
      </>
    );
  }

  if (scope === "branch") {
    const ctx = await withTenant(session.tenantId, async (tx) => {
      const all = (await tx.execute(sql`
        SELECT id::text AS id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name ASC
      `)).rows as Array<{ id: string; name: string | null }>;
      const wanted = typeof sp.branch === "string" ? sp.branch : null;
      const chosen = allBranches
        ? all.find((b) => b.id === wanted) ?? all.find((b) => b.id === session.branchId) ?? all[0]
        : all.find((b) => b.id === session.branchId);
      if (!chosen) return null;
      // Everyone whose users.branch_id is this branch — departed people too,
      // because their meetings and tasks in the period still happened here.
      const people = (await tx.execute(sql`
        SELECT id::text AS id, name, status, (deleted_at IS NOT NULL) AS deleted
          FROM users
         WHERE tenant_id = ${session.tenantId}::uuid AND branch_id = ${chosen.id}::uuid
         ORDER BY (status = 'active') DESC, name ASC
      `)).rows as Array<{ id: string; name: string | null; status: string; deleted: boolean }>;
      return {
        branch: { id: chosen.id, name: chosen.name ?? "—" },
        branchOptions: allBranches ? all.map((b) => ({ id: b.id, name: b.name ?? "—" })) : null,
        people,
      };
    });

    if (!ctx) {
      return (
        <>
          <AnnouncementsStrip session={session} />
          <div className="mt-6">
            <EmptyState
              icon={Store}
              title="No branch to show"
              description="This firm has no branch recorded yet, so there is no branch command centre to build. Branches are added in Settings → Branches."
              primary={{ href: "/dashboard?scope=mine", label: "Open my portfolio" }}
            />
          </div>
        </>
      );
    }

    // The RM picker offers people who can still be reviewed; the window counts
    // everyone, departed included, so the branch's history is not rewritten.
    const pickable = ctx.people
      .filter((u) => !u.deleted)
      .map((u) => ({ id: u.id, name: u.name ?? "—", active: u.status === "active" }));
    // An RM filter is honoured only for someone IN this branch — a stray id in
    // the URL cannot widen the view to another branch's person.
    const rmId = rmParam && pickable.some((u) => u.id === rmParam) ? rmParam : null;

    return (
      <>
        {/* Two minutes, not thirty seconds: this page runs several times the
            queries of the personal cockpit. It pauses while the tab is hidden. */}
        <AutoRefresh intervalMs={120000} />
        <AnnouncementsStrip session={session} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <BranchCommandCentre
            session={session}
            branch={ctx.branch}
            branchOptions={ctx.branchOptions}
            staff={pickable}
            staffIds={ctx.people.map((u) => u.id)}
            rmId={rmId}
            period={period}
            customStart={pstart}
            customFrom={pfrom}
            customTo={pto}
            sp={sp}
            scopeSwitch={<DashboardScopeSwitch current="branch" available={availableScopes} />}
          />
        </Suspense>
      </>
    );
  }

  // Owner / Branch Head sees the full cockpit — plus member and branch
  // selectors that SCOPE that cockpit. Neither swaps the page for a different
  // dashboard; they narrow the same one.
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

    // Picking a team member FILTERS this cockpit; it does not replace it.
    // Previously `selected` swapped the whole page to RmDashboard, so choosing
    // a name changed which dashboard you were looking at — the tabs, the
    // sections and the layout all changed under you. Now it behaves like the
    // branch filter next to it: same page, narrower numbers.
    const selected = rmParam ? members.find((m) => m.id === rmParam) : undefined;
    const selectedRmId = selected ? selected.id : null;

    // What is actually narrowing the numbers, stated on the page. The period is
    // carried separately because it is never absent and never removable.
    const appliedFilters: AppliedFilter[] = [];
    if (selected) {
      appliedFilters.push({ params: ["rm"], label: "RM", value: selected.name ?? "—" });
    }
    if (selectedBranch) {
      const b = branches.find((x) => x.id === selectedBranch);
      appliedFilters.push({ params: ["branch"], label: "Branch", value: b?.name ?? "—" });
    }
    const comparison = resolvePreviousRange(period, new Date(), {
      customStart: pstart,
      from: pfrom,
      to: pto,
    });
    const filterReceipt = (
      <AppliedFilterChips
        periodLabel={periodLabel}
        comparisonLabel={comparison.label}
        filters={appliedFilters}
        lastRefreshed={new Date().toISOString()}
      />
    );
    tabsBar = <DashboardTabs current={dashTab} />;
    memberBar = (
      <>
        <DashboardMemberFilter
          members={members}
          selected={selected ? rmParam : ""}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
        <DashboardBranchFilter branches={branches} selected={selectedBranch} />
      </>
    );
    dash = (
      <OwnerCockpit
        session={session}
        period={period}
        customStart={pstart}
        customFrom={pfrom}
        customTo={pto}
        activityDays={activityDays}
        branchId={selectedBranch}
        rmId={selectedRmId}
        tab={dashTab}
        controls={
          <div className="space-y-2.5 border-b border-border pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <DashboardScopeSwitch current="firm" available={availableScopes} />
                <DashboardTabs current={dashTab} />
              </div>
              <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light">
                {memberBar}
              </DashboardHeaderBar>
            </div>
            {filterReceipt}
          </div>
        }
      />
    );
    headerControls = (
      <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light">
        {memberBar}
      </DashboardHeaderBar>
    );
  } else if (can(roles, "dashboard.view.compliance", perms)) {
    dash = <ComplianceCockpit session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.marketing", perms)) {
    dash = <MarketingDashboard session={session} period={period} customStart={pstart} />;
  } else if (can(roles, "dashboard.view.ops", perms)) {
    dash = <BackOfficeDashboard session={session} />;
  } else if (can(roles, "dashboard.view.rm", perms)) {
    // Not normally reached: an RM with none of the cockpits above is `rmHome`
    // and was sent to the desk (scope "mine") before this point.
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
