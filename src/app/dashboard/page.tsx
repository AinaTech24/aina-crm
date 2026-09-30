/**
 * /dashboard opens the viewer's default dashboard (D8):
 *
 *   their own default ("Set as my default")
 *   → a dashboard assigned to them (Settings → Dashboards)
 *   → the last dashboard they opened (remembered, as in Zoho)
 *   → their role's default (owner, compliance and marketing → Owner
 *     Dashboard; branch head → Branch Head Dashboard; RM → Relationship
 *     Manager Dashboard; operations, back office and service team →
 *     Operations Dashboard; insurance team → Insurance Team Dashboard)
 *   → the Owner Dashboard.
 *
 * The sidebar's "Dashboard" link comes here, so it always opens that default.
 *
 * Links from before the named dashboards (`?scope=firm|branch|mine|ops|
 * insurance|claims`) open the role dashboard that replaced each view.
 */

import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ensureSystemDashboards, loadDashboard, resolveDefaultDashboard, systemDashboardId, systemDef, viewerFacts,
} from "@/lib/dashboards/platform";
import { keepQuery } from "@/lib/dashboards/open-system";
import type { SystemDashboardKey } from "@/lib/dashboards/system/definitions";

export const dynamic = "force-dynamic";

const LEGACY_SCOPE: Record<string, SystemDashboardKey> = {
  firm: "owner",
  branch: "branch_head",
  mine: "rm",
  ops: "operations",
  insurance: "insurance",
  claims: "claims",
};

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const scope = typeof sp.scope === "string" ? sp.scope : "";

  const target = await withTenant(session.tenantId, async (tx) => {
    await ensureSystemDashboards(tx, session.tenantId);
    const v = await viewerFacts(tx, session);
    const legacy = LEGACY_SCOPE[scope] ? await systemDashboardId(tx, v, LEGACY_SCOPE[scope]) : null;
    const id = legacy ?? (await resolveDefaultDashboard(tx, v));
    if (!id) return null;
    const hit = await loadDashboard(tx, v, id);
    return { id, centre: hit ? !!systemDef(hit.d)?.centre : false };
  });

  if (target) {
    // A full role dashboard reads its own URL (the old period keys included);
    // a widget dashboard reads the filter bar's.
    redirect(`/dashboard/${target.id}${target.centre ? keepQuery(sp, ["scope"]) : widgetQuery(sp)}`);
  }

  return (
    <EmptyState
      title="No dashboard is shared with you yet"
      description="Ask your administrator to share one, or create your own."
      primary={{ href: "/dashboard/new", label: "New dashboard" }}
    />
  );
}

/**
 * Everything but the old view switches carries over (rm, branch…). Old
 * period vocabularies are translated to the filter bar's: the cockpits'
 * `mtd`/`fytd`/… keys and `pfrom`/`pto`, and the Team page's
 * `date_from`/`date_to` range.
 */
function widgetQuery(sp: Record<string, string | string[] | undefined>): string {
  const OLD_PERIOD: Record<string, string> = {
    today: "today", tw: "week", mtd: "month", lm: "last_month", qtd: "quarter", fytd: "fy", ly: "last_fy",
  };
  const rest = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (["scope", "tab", "period", "pfrom", "pto", "pstart", "date_from", "date_to"].includes(k)) continue;
    if (typeof v !== "string" || !v) continue;
    rest.set(k, v);
  }
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const from = one("date_from") || one("pfrom");
  const to = one("date_to") || one("pto");
  if (from) {
    rest.set("period", "custom");
    rest.set("from", from);
    if (to) rest.set("to", to);
  } else if (OLD_PERIOD[one("period")] || ["week", "month", "last_month", "quarter", "fy", "last_fy", "custom"].includes(one("period"))) {
    rest.set("period", OLD_PERIOD[one("period")] ?? one("period"));
  }
  return rest.toString() ? `?${rest}` : "";
}
