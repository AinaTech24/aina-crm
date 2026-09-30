/**
 * Open a role dashboard by its key — for the pages the role dashboards
 * replaced (Reports › Branch review / My desk / Practice health, Insurance ›
 * Overview / Claims desk, WORK › Operations) and for the `/dashboard?scope=`
 * links older than all of them. SERVER-ONLY.
 *
 * The query string is kept (a drill-down link keeps its RM, branch or period),
 * and a viewer who may not see that dashboard lands on their own default
 * instead of an error.
 */

import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { ensureSystemDashboards, opensSystemDashboard, systemDashboardId, viewerFacts } from "./platform";
import type { SystemDashboardKey } from "./system/definitions";

type SP = Record<string, string | string[] | undefined>;

export function keepQuery(sp: SP, drop: string[] = []): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (drop.includes(k) || typeof v !== "string" || !v) continue;
    q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * The routes behind a role dashboard (its drawers, search, export): the
 * dashboard's own capability, or the dashboard shared with the viewer by an
 * admin. What the route then returns still follows the viewer's own record
 * access — sharing a dashboard never widens that.
 */
export async function mayUseRoleDashboard(session: SessionUser, key: SystemDashboardKey, byCapability: boolean): Promise<boolean> {
  if (byCapability) return true;
  return withTenant(session.tenantId, (tx) => opensSystemDashboard(tx, session, key));
}

export async function openSystemDashboard(session: SessionUser, key: SystemDashboardKey, sp: SP): Promise<never> {
  const id = await withTenant(session.tenantId, async (tx) => {
    await ensureSystemDashboards(tx, session.tenantId);
    return systemDashboardId(tx, await viewerFacts(tx, session), key);
  });
  redirect(id ? `/dashboard/${id}${keepQuery(sp, ["scope"])}` : "/dashboard");
}
