/** Edit a dashboard's layout (D7). System and locked dashboards are cloned instead. */

import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { DashboardBuilder } from "@/components/dashboards/system/DashboardBuilder";
import {
  canEdit, canManageDashboards, filterConfigOf, layoutOf, loadDashboard, viewerFacts,
} from "@/lib/dashboards/platform";

export const dynamic = "force-dynamic";

export default async function EditDashboardPage({ params }: { params: Promise<{ dashboardId: string }> }) {
  const session = await requireSession();
  const { dashboardId } = await params;
  const data = await withTenant(session.tenantId, async (tx) => {
    const v = await viewerFacts(tx, session);
    const hit = await loadDashboard(tx, v, dashboardId);
    if (!hit || hit.d.deletedAt) return null;
    return {
      editable: canEdit(v, hit.d, hit.shares),
      name: hit.d.name,
      description: hit.d.description ?? "",
      layout: layoutOf(hit.d),
      filters: filterConfigOf(hit.d),
    };
  });
  if (!data) notFound();
  if (!data.editable) redirect(`/dashboard/${dashboardId}`);

  return (
    <div className="space-y-4">
      <PageHeaderCard title={`Edit ${data.name}`} subtitle="Change the widgets, their order and size." />
      <DashboardBuilder
        mode="edit"
        dashboardId={dashboardId}
        initial={{ name: data.name, description: data.description, layout: data.layout, filters: data.filters }}
        canConfigureFilters={canManageDashboards(session)}
        starters={[]}
      />
    </div>
  );
}
