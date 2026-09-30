/** New dashboard (D7). Anyone may create one; it starts as "Only me". */

import { requireSession } from "@/lib/auth/session";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { DashboardBuilder } from "@/components/dashboards/system/DashboardBuilder";
import { canManageDashboards } from "@/lib/dashboards/platform";
import { SYSTEM_DASHBOARDS } from "@/lib/dashboards/system/definitions";
import { EXTRA_FILTERS } from "@/lib/dashboards/system/filters";

export const dynamic = "force-dynamic";

export default async function NewDashboardPage() {
  const session = await requireSession();
  const starters = SYSTEM_DASHBOARDS
    .filter((d) => d.layout.length && d.visibleTo(session))
    .map((d) => ({ key: d.key, name: d.name, layout: d.layout }));
  return (
    <div className="space-y-4">
      <PageHeaderCard title="New dashboard" subtitle="Pick the widgets you want and arrange them." />
      <DashboardBuilder
        mode="new"
        initial={{ name: "", description: "", layout: [], filters: { fields: EXTRA_FILTERS, defaults: { period: "fy" } } }}
        canConfigureFilters={canManageDashboards(session)}
        starters={starters}
      />
    </div>
  );
}
