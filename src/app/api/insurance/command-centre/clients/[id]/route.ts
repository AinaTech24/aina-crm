/**
 * GET /api/insurance/command-centre/clients/:id — one client's insurance
 * relationship for the command centre's client drawer (§49): policies,
 * claims, insurance proposals, meetings, open tasks and queries.
 *
 * Scope is the page's own (lib/dashboard/insurance/access.ts), and the client
 * is loaded through the same base query, so a client the viewer could not see
 * on the dashboard is simply "not found" here.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { insuranceAccess } from "@/lib/dashboard/insurance/access";
import { loadClientInsurance } from "@/lib/dashboard/insurance/detail";
import { istToday } from "@/lib/dashboard/insurance/params";
import { fyStartOf, yearBefore } from "@/lib/dashboard/insurance/window";
import { mayUseRoleDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const session = await requireSession();
    const access = insuranceAccess(session);
    if (!(await mayUseRoleDashboard(session, "insurance", access.allowed))) {
      return NextResponse.json({ error: "You do not have access to the insurance dashboard." }, { status: 403 });
    }

    const today = istToday();
    const fy = fyStartOf(today);
    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const t = await loadDashboardThresholds(tx);
        return loadClientInsurance(tx, {
          tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter: {},
          from: today, to: today, periodLabel: "Today", prevFrom: today, prevTo: today, prevLabel: "Today",
          fyStart: fy, pyFrom: yearBefore(fy), pyTo: yearBefore(today), today, t,
        }, id, { contacts: access.contacts });
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    if (!data) return NextResponse.json({ error: "This client is not in your insurance book." }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
