/**
 * Settings → Dashboards (D8): which dashboard each role opens by default, and
 * dashboards assigned to one person. "Manage dashboards" only.
 *
 * A role's choices are the dashboards that role can see (a system dashboard
 * for its roles, a custom one shared with everyone or with that role); a
 * person's choices are the dashboards they can see.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { DefaultsEditor } from "@/components/dashboards/system/DefaultsEditor";
import { dashboards, dashboardDefaults } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  canManageDashboards, canView, ensureSystemDashboards, type ShareRow, type ShareType,
} from "@/lib/dashboards/platform";
import { ROLE_DEFAULTS } from "@/lib/dashboards/system/definitions";
import type { SessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardDefaultsPage() {
  const session = await requireSession();
  if (!canManageDashboards(session)) {
    return (
      <EmptyState
        title="Only an admin can set default dashboards"
        description="Ask the owner to give you the Manage dashboards permission."
      />
    );
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    await ensureSystemDashboards(tx, session.tenantId);
    const [rows, shares, defaults, people] = await Promise.all([
      tx.select().from(dashboards).where(and(eq(dashboards.tenantId, session.tenantId), isNull(dashboards.deletedAt))),
      tx.execute(sql`SELECT dashboard_id, share_type, share_ref, include_subordinates FROM dashboard_shares WHERE tenant_id = ${session.tenantId}::uuid`),
      tx.select().from(dashboardDefaults).where(eq(dashboardDefaults.tenantId, session.tenantId)),
      tx.execute(sql`
        SELECT id, name, roles, branch_id, desk_id, permissions FROM users
         WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name`),
    ]);
    const shareBy = new Map<string, ShareRow[]>();
    for (const r of shares.rows as Array<{ dashboard_id: string; share_type: ShareType; share_ref: string; include_subordinates: boolean }>) {
      shareBy.set(r.dashboard_id, [...(shareBy.get(r.dashboard_id) ?? []), { shareType: r.share_type, shareRef: r.share_ref, includeSubordinates: r.include_subordinates }]);
    }
    const seenBy = (s: SessionUser, deskId: string | null) =>
      rows.filter((d) => canView({ session: s, deskId }, d, shareBy.get(d.id) ?? []))
        .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name))
        .map((d) => ({ id: d.id, name: d.name }));

    const roleRows = [...new Map(ROLE_DEFAULTS.map((r) => [r.role, r])).values()].map((r) => ({
      role: r.role,
      label: r.label,
      current: defaults.find((x) => x.targetType === "role" && x.targetRef === r.role)?.dashboardId ?? null,
      options: seenBy({ userId: "", tenantId: session.tenantId, roles: [r.role], email: "", permissions: [] } as unknown as SessionUser, null),
    }));
    const userRows = (people.rows as Array<{ id: string; name: string | null; roles: string[]; branch_id: string | null; desk_id: string | null; permissions: string[] | null }>).map((u) => ({
      id: u.id,
      name: (u.name ?? "—").replace(/\s*\([^)]*\)$/, ""),
      current: defaults.find((x) => x.targetType === "user" && x.targetRef === u.id)?.dashboardId ?? null,
      options: seenBy({
        userId: u.id, tenantId: session.tenantId, roles: u.roles ?? [], branchId: u.branch_id ?? undefined,
        email: "", permissions: u.permissions ?? [],
      } as unknown as SessionUser, u.desk_id),
    }));
    return { roleRows, userRows };
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeaderCard title="Dashboards" />
      <DefaultsEditor roles={data.roleRows} users={data.userRows} />
    </div>
  );
}
