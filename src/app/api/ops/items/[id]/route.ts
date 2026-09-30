/**
 * GET /api/ops/items/:id — one operations request for the Control Tower's
 * detail drawer: the request, its client context (no portfolio), its remarks
 * and — for the roles that hold the audit log — its status-change trail.
 *
 * Scope is the page's own (lib/dashboard/ops/access.ts) and the item is loaded
 * through the same base query, so a request the viewer could not see on the
 * dashboard is simply "not found" here.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { opsAccess } from "@/lib/dashboard/ops/access";
import { loadOpsItemDetail } from "@/lib/dashboard/ops/detail";
import { istToday } from "@/lib/dashboard/ops/params";
import { mayUseRoleDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const session = await requireSession();
    const access = opsAccess(session);
    if (!(await mayUseRoleDashboard(session, "operations", access.allowed))) {
      return NextResponse.json({ error: "You do not have access to the operations dashboard." }, { status: 403 });
    }

    const today = istToday();
    const item = await withTenant(
      session.tenantId,
      async (tx) => {
        const t = await loadDashboardThresholds(tx);
        return loadOpsItemDetail(
          tx,
          { tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter: {}, from: today, to: today, today, periodLabel: "Today", t },
          id,
          { audit: access.audit, contacts: access.contacts },
        );
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err) {
    return handleApiError(err);
  }
}
