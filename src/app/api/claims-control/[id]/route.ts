/**
 * GET /api/claims-control/:id — one claim for the Claims Control Centre's
 * drawer (§55–58): the claim, Policy 360, Client 360, the lifecycle
 * timeline, the communication log and the audit trail.
 *
 * Access is the page's own (lib/dashboard/claims/access.ts) and the claim is
 * loaded through the page's claim set, so a claim the viewer cannot see on
 * the dashboard is simply "not found" here. `?hv=` carries the viewer's
 * high-value preset so the drawer flags a claim the way the page did.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { claimsAccess } from "@/lib/dashboard/claims/access";
import { loadClaimDetail } from "@/lib/dashboard/claims/detail";
import { parseClaimView } from "@/lib/dashboard/claims/params";
import { fyStartOf } from "@/lib/dashboard/claims/window";
import { istToday } from "@/lib/dashboard/insurance/params";
import { mayUseRoleDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const session = await requireSession();
    const access = claimsAccess(session);
    if (!(await mayUseRoleDashboard(session, "claims", access.allowed && access.canView))) {
      return NextResponse.json({ error: "You do not have access to insurance claims." }, { status: 403 });
    }
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
    const today = istToday();
    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const t = await loadDashboardThresholds(tx);
        const view = parseClaimView(sp, t);
        return loadClaimDetail(tx, {
          tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter: {},
          from: today, to: today, periodLabel: "Today", prevFrom: today, prevTo: today, prevLabel: "Today",
          fyStart: fyStartOf(today), today, t,
          highValue: view.highValue, noUpdateDays: view.noUpdateDays, clientUpdateDays: view.clientUpdateDays,
        }, id, { contacts: access.canClient360 });
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    if (!data) return NextResponse.json({ error: "This claim is not in your claims book." }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
