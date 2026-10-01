/**
 * One named dashboard (dashboard cleanup D2 / D7 / D8 / D9).
 *
 *   [Owner Dashboard ▾] ☆                         [Period ▾][RM ▾][Branch ▾][+ Filter] ⋯
 *   Showing: whole firm                                              Updated 5:21 PM
 *   ─ the dashboard ─
 *
 * Every role's dashboard opens here, picked from the name's dropdown. The
 * Owner Dashboard and every custom dashboard are widget cards (DashboardGrid);
 * the Branch Head, Relationship Manager, Operations, Insurance Team and Claims
 * dashboards are full pages of their own under the same header
 * (components/dashboards/system/centres.tsx).
 *
 * Which dashboards exist, who sees them and which one /dashboard opens:
 * lib/dashboards/platform.ts. What each card counts: lib/metrics, through the
 * viewer's record access (lib/dashboards/system/access.ts). A widget
 * dashboard loads every card, then renders once (loading.tsx is the one
 * skeleton).
 */

import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { AnnouncementsStrip } from "@/components/announcements/AnnouncementsStrip";
import { DashboardGrid } from "@/components/dashboards/system/DashboardGrid";
import { DashboardHead } from "@/components/dashboards/system/DashboardHead";
import { DashboardFilterBar } from "@/components/dashboards/system/DashboardFilterBar";
import { SetupChecklist } from "@/components/dashboards/system/SetupChecklist";
import { CentreDashboard } from "@/components/dashboards/system/centres";
import { DashboardBody, DashboardNavProvider } from "@/components/dashboards/system/DashboardNav";
import { prepareDashboard } from "@/components/dashboards/system/prepare";

export const dynamic = "force-dynamic";

export default async function DashboardById({
  params,
  searchParams,
}: {
  params: Promise<{ dashboardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { dashboardId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(dashboardId)) notFound();

  const p = await prepareDashboard(session, dashboardId, sp, { touch: true });
  if ("notFound" in p) notFound();

  if ("centre" in p) {
    return (
      <DashboardNavProvider>
        <div className="dash-canvas space-y-4">
          <AnnouncementsStrip session={session} />
          <CentreDashboard session={session} p={p} sp={sp} />
        </div>
      </DashboardNavProvider>
    );
  }

  const defaults = {
    period: p.filterConfig.defaults?.period ?? "fy",
    values: p.filterConfig.defaults?.values ?? {},
  };

  return (
    <DashboardNavProvider>
    <div className="dash-canvas space-y-4">
      <AnnouncementsStrip session={session} />
      <DashboardHead
        session={session}
        d={{
          id: p.id,
          name: p.name,
          list: p.list,
          isFavourite: p.isFavourite,
          isDefault: p.isDefault,
          canEdit: p.canEdit,
          canShare: p.canShare,
          canDelete: p.canDelete,
          canManage: p.canManage,
          audience: p.audience,
          locked: p.locked,
          cloneable: true,
        }}
        showing={p.showing}
        right={
          <DashboardFilterBar
            dashboardId={p.id}
            state={p.state}
            defaults={defaults}
            options={p.options}
            bar={p.bar}
            usingSaved={p.usingSaved}
          />
        }
      />
      {/* Dimmed while a filter change loads (DashboardNav). */}
      <DashboardBody>
        {/* First-run guidance for the owner: vanishes once the firm is set up. */}
        {p.systemKey === "owner" && session.roles.includes("owner") && <SetupChecklist tenantId={session.tenantId} />}
        <DashboardGrid p={p} />
      </DashboardBody>
    </div>
    </DashboardNavProvider>
  );
}
