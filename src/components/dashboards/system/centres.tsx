/**
 * The five role dashboards that are a full page of their own, rendered inside
 * Dashboard under the same header as the Owner Dashboard:
 *
 *   Branch Head Dashboard           BranchCommandCentre    (32-section brief)
 *   Relationship Manager Dashboard  MyBusinessDashboard    (40-section brief)
 *   Operations Dashboard            OperationsControlTower (50-section brief)
 *   Insurance Team Dashboard        InsuranceCommandCentre (58-section brief)
 *   Claims Dashboard                ClaimsControlCentre    (60-section brief)
 *
 * SERVER component. Who may open one is who can SEE it — the roles it is for
 * (definitions.ts `visibleTo`) or the people an admin shared it with
 * (platform.ts `canView`); the page never renders one the viewer cannot see.
 * What each one then SHOWS follows the viewer's own record access, decided
 * here and nowhere else — a shared dashboard never widens it:
 *
 *   Branch   `dashboard.view.all_branches` (the owner always) may pick any
 *            branch with `?branch=`; anyone else sees their own branch
 *            (`?branch=` ignored) and needs a branch on their user. Someone
 *            who sees only their own clients (an RM it was shared with) gets
 *            the one-on-one view of themselves, fixed. `?rm=` is honoured only
 *            for someone in the chosen branch.
 *   RM       the viewer's own book, always (lib/dashboard/my/window.ts).
 *   Ops      opsAccess(): firm, branch or own work.
 *   Insurance / Claims   insuranceAccess() / claimsAccess(): firm, branch or
 *            own clients.
 *
 * Every link a centre builds back to itself starts at `basePath`
 * (/dashboard/<id>), so drill-downs and toggles stay on this dashboard.
 */

import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Store } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isBranchScoped } from "@/lib/leads/access";
import type { Period } from "@/lib/dashboard/period";
import { opsAccess } from "@/lib/dashboard/ops/access";
import { insuranceAccess } from "@/lib/dashboard/insurance/access";
import { claimsAccess } from "@/lib/dashboard/claims/access";
import { systemDashboardId, viewerFacts } from "@/lib/dashboards/platform";
import { reportsOf, resolveDataAccess } from "@/lib/dashboards/team";
import { hasFilterParams, parseFilterState, type FilterState } from "@/lib/dashboards/system/filters";
import type { PeriodKey } from "@/lib/dashboards/system/period";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { EmptyState } from "@/components/common/EmptyState";
import { DashboardPageSkeleton } from "@/components/dashboards/DashboardSkeletons";
import { BranchCommandCentre } from "@/components/dashboards/BranchCommandCentre";
import { MyBusinessDashboard } from "@/components/dashboards/MyBusinessDashboard";
import { OperationsControlTower } from "@/components/dashboards/OperationsControlTower";
import { InsuranceCommandCentre } from "@/components/dashboards/InsuranceCommandCentre";
import { ClaimsControlCentre } from "@/components/dashboards/ClaimsControlCentre";
import { DashboardHead, type HeadFacts } from "./DashboardHead";
import { DashboardBody } from "./DashboardNav";
import type { PreparedCentre } from "./prepare";

type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const first = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
const isDate = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

async function branchName(session: SessionUser, id: string): Promise<string | null> {
  return withTenant(session.tenantId, async (tx) => {
    const r = (await tx.execute(sql`
      SELECT name FROM branches WHERE tenant_id = ${session.tenantId}::uuid AND id = ${id}::uuid
    `)).rows[0] as { name?: string | null } | undefined;
    return r?.name ?? null;
  });
}

export async function CentreDashboard({ session, p, sp }: { session: SessionUser; p: PreparedCentre; sp: SP }) {
  const facts: HeadFacts = {
    id: p.id,
    name: p.name,
    list: p.list,
    isFavourite: p.isFavourite,
    isDefault: p.isDefault,
    canEdit: false,
    canShare: p.canShare,
    canDelete: false,
    canManage: p.canManage,
    audience: p.audience,
    locked: true,
    cloneable: false,
  };
  const basePath = `/dashboard/${p.id}`;
  const head = (showing: string) => <DashboardHead session={session} d={facts} showing={showing} />;

  switch (p.centre) {
    case "branch": return <BranchHead session={session} sp={sp} basePath={basePath} head={head} />;
    case "rm": return <RmDesk session={session} sp={sp} basePath={basePath} head={head} />;
    case "ops": return <Operations session={session} sp={sp} basePath={basePath} head={head} p={p} />;
    case "insurance": return <InsuranceTeam session={session} sp={sp} basePath={basePath} head={head} />;
    case "claims": return <Claims session={session} sp={sp} basePath={basePath} head={head} />;
  }
}

type CentreProps = { session: SessionUser; sp: SP; basePath: string; head: (showing: string) => ReactNode };

/** A dashboard the viewer may pick but not open as it stands — said plainly, under its own header. */
function Blocked({ head, icon, title, description }: {
  head: ReactNode; icon: typeof Store; title: string; description: string;
}) {
  return (
    <div className="space-y-4">
      {head}
      <EmptyState icon={icon} title={title} description={description} primary={{ href: "/dashboard/manage", label: "See all dashboards" }} />
    </div>
  );
}

/* ─────────────────────────────── Branch Head ─────────────────────────────── */

async function BranchHead({ session, sp, basePath, head }: CentreProps) {
  const { roles, permissions: perms } = session;
  const allBranches = can(roles, "dashboard.view.all_branches", perms);
  const branchLocked = isBranchScoped(session) && !allBranches;
  // Someone who sees only their own clients sees only them here too; someone
  // people report to picks among their team (never "All branch").
  const access = await withTenant(session.tenantId, (tx) => resolveDataAccess(tx, session));
  const selfOnly = access.kind === "self";
  const teamIds = access.kind === "team" ? access.memberIds : null;

  if (!allBranches && !session.branchId) {
    return (
      <Blocked head={head("your branch")} icon={Store}
        title="No branch is set on your user"
        description="This dashboard shows one branch — yours — and your user has no branch assigned. An administrator can set it in Team → Employees." />
    );
  }

  const ctx = await withTenant(session.tenantId, async (tx) => {
    const all = (await tx.execute(sql`
      SELECT id::text AS id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name ASC
    `)).rows as Array<{ id: string; name: string | null }>;
    const wanted = one(sp.branch) ?? null;
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
      <Blocked head={head("no branch")} icon={Store}
        title="No branch to show"
        description="This firm has no branch recorded yet, so there is no branch to review. Branches are added in Settings → Branches." />
    );
  }

  // The RM picker offers people who can still be reviewed; the window counts
  // everyone, departed included, so the branch's history is not rewritten.
  const pickable = ctx.people
    .filter((u) => !u.deleted && (!teamIds || teamIds.includes(u.id)))
    .map((u) => ({ id: u.id, name: u.name ?? "—", active: u.status === "active" }));
  const rmParam = (one(sp.rm) ?? "").trim();
  const rmId = selfOnly
    ? session.userId
    : rmParam && pickable.some((u) => u.id === rmParam)
      ? rmParam
      : teamIds ? session.userId : null;

  return (
    <div className="space-y-4">
      {head(selfOnly ? `your clients in ${ctx.branch.name}` : teamIds ? `your team in ${ctx.branch.name}` : branchLocked ? `${ctx.branch.name} (your branch)` : ctx.branch.name)}
      <DashboardBody>
        {/* Two minutes: this dashboard runs a lot of queries. It pauses while the tab is hidden. */}
        <AutoRefresh intervalMs={120000} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <BranchCommandCentre
            session={session}
            basePath={basePath}
            branch={ctx.branch}
            branchOptions={ctx.branchOptions}
            staff={pickable}
            staffIds={ctx.people.map((u) => u.id)}
            rmId={rmId}
            rmLocked={selfOnly}
            rmAll={!teamIds}
            period={(one(sp.period) ?? "mtd") as Period}
            customStart={one(sp.pstart)}
            customFrom={(one(sp.pfrom) ?? "").slice(0, 10) || undefined}
            customTo={(one(sp.pto) ?? "").slice(0, 10) || undefined}
            sp={sp}
          />
        </Suspense>
      </DashboardBody>
    </div>
  );
}

/* ─────────────────────────── Relationship Manager ─────────────────────────── */

async function RmDesk({ session, sp, basePath, head }: CentreProps) {
  // Someone people report to can open any of their desks; no one else's.
  const team = await withTenant(session.tenantId, (tx) => reportsOf(tx, session.tenantId, session.userId));
  const wanted = (one(sp.member) ?? "").trim();
  const viewing = team.find((m) => m.id === wanted) ?? null;
  return (
    <div className="space-y-4">
      {head(viewing ? `${viewing.name}'s clients (your team)` : "your clients")}
      <DashboardBody>
        {/* Two minutes: the desk runs about thirty loaders. It pauses while the
            tab is hidden, and refreshes the moment the RM comes back to it. */}
        <AutoRefresh intervalMs={120000} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <MyBusinessDashboard
            session={session}
            basePath={basePath}
            team={team}
            viewing={viewing}
            period={(one(sp.period) ?? "mtd") as Period}
            customStart={one(sp.pstart)}
            customFrom={(one(sp.pfrom) ?? "").slice(0, 10) || undefined}
            customTo={(one(sp.pto) ?? "").slice(0, 10) || undefined}
            sp={sp}
          />
        </Suspense>
      </DashboardBody>
    </div>
  );
}

/* ──────────────────────────────── Operations ──────────────────────────────── */

/** The old tower's period keys (lib/dashboard/period.ts) → the filter bar's. */
const LEGACY_PERIOD = new Map<string, PeriodKey>([
  ["tw", "week"], ["mtd", "month"], ["lm", "last_month"], ["qtd", "quarter"], ["fytd", "fy"], ["ly", "last_fy"],
]);
/** Old keys with no equivalent now (yesterday, last week, last quarter): the default period instead. */
const LEGACY_DROPPED = ["yd", "lw", "lq"];

/**
 * A link from before the filter bar (`period=mtd`, `pfrom` / `pto` / `pstart`)
 * → the same view in the bar's keys, so the address bar only ever carries those.
 */
function opsLegacyUrl(sp: SP, basePath: string): string | null {
  const period = first(sp, "period");
  const legacy = LEGACY_PERIOD.has(period) || LEGACY_DROPPED.includes(period)
    || !!first(sp, "pfrom") || !!first(sp, "pto") || !!first(sp, "pstart");
  if (!legacy) return null;
  const q = new URLSearchParams();
  for (const k of Object.keys(sp)) {
    if (["period", "from", "to", "pfrom", "pto", "pstart"].includes(k)) continue;
    const v = first(sp, k);
    if (v) q.set(k, v);
  }
  const mapped = LEGACY_PERIOD.get(period);
  if (mapped) q.set("period", mapped);
  else if (period === "custom" && isDate(first(sp, "pfrom").slice(0, 10))) {
    q.set("period", "custom");
    q.set("from", first(sp, "pfrom").slice(0, 10));
    if (isDate(first(sp, "pto").slice(0, 10))) q.set("to", first(sp, "pto").slice(0, 10));
  }
  const s = q.toString();
  return `${basePath}${s ? `?${s}` : ""}`;
}

async function Operations({ session, sp, basePath, head, p }: CentreProps & { p: PreparedCentre }) {
  const access = opsAccess(session);
  const legacy = opsLegacyUrl(sp, basePath);
  if (legacy) redirect(legacy);

  const defaults: FilterState = {
    period: p.filterConfig.defaults?.period ?? "today",
    values: p.filterConfig.defaults?.values ?? {},
  };
  // URL first; else the viewer's saved filter; else the defaults.
  const explicit = hasFilterParams(sp);
  let state = parseFilterState(sp, explicit ? { period: defaults.period, values: {} } : p.saved ?? defaults);
  // A custom range needs its start date — without one the bar and the tower's
  // resolver would each guess a different range — so it falls back to the
  // default period. An end before the start means "to today".
  if (state.period === "custom") {
    const { from, to } = state;
    if (!isDate(from)) state = { ...state, period: defaults.period, from: undefined, to: undefined };
    else if (!isDate(to) || to < from) state = { ...state, to: undefined };
  } else {
    state = { ...state, from: undefined, to: undefined };
  }

  const showing = access.scope.kind === "firm" ? "whole firm"
    : access.scope.kind === "branch" ? (await branchName(session, access.scope.branchId)) ?? "your branch"
    : "your own work";

  return (
    <div className="space-y-4">
      {head(showing)}
      <DashboardBody>
        {/* Two minutes: it is a working queue. It pauses while the tab is hidden. */}
        <AutoRefresh intervalMs={120000} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <OperationsControlTower
            session={session}
            basePath={basePath}
            sp={sp}
            state={state}
            defaults={defaults}
            explicit={explicit}
            usingSaved={!explicit && !!p.saved}
            dashboardId={p.id}
          />
        </Suspense>
      </DashboardBody>
    </div>
  );
}

/* ─────────────────────────────── Insurance Team ─────────────────────────────── */

async function InsuranceTeam({ session, sp, basePath, head }: CentreProps) {
  const access = insuranceAccess(session);
  // The Claims Dashboard when the viewer may open it (by role or shared); else the claims scorecard.
  const claimsId = await withTenant(session.tenantId, async (tx) => systemDashboardId(tx, await viewerFacts(tx, session), "claims"));
  const showing = access.scope.kind === "firm" ? "whole firm"
    : access.scope.kind === "branch" ? (await branchName(session, access.scope.branchId)) ?? "your branch"
    : "your clients";

  return (
    <div className="space-y-4">
      {head(showing)}
      <DashboardBody>
        <AutoRefresh intervalMs={300000} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <InsuranceCommandCentre session={session} sp={sp} basePath={basePath}
            claimsHref={claimsId ? `/dashboard/${claimsId}` : null} />
        </Suspense>
      </DashboardBody>
    </div>
  );
}

/* ─────────────────────────────────── Claims ─────────────────────────────────── */

async function Claims({ session, sp, basePath, head }: CentreProps) {
  const access = claimsAccess(session);
  const showing = access.scope.kind === "branch"
    ? (await branchName(session, access.scope.branchId)) ?? "your branch"
    : access.scope.kind === "self" ? "your clients' claims" : "whole firm";

  return (
    <div className="space-y-4">
      {head(showing)}
      <DashboardBody>
        {/* Two minutes: it is a working queue. It pauses while the tab is hidden. */}
        <AutoRefresh intervalMs={120000} />
        <Suspense fallback={<DashboardPageSkeleton />}>
          <ClaimsControlCentre session={session} sp={sp} basePath={basePath} />
        </Suspense>
      </DashboardBody>
    </div>
  );
}
