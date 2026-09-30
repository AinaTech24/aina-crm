/**
 * GET /api/claims-control/search?q= — universal claim search (§54) for the
 * Claims Control Centre, within the viewer's claims scope.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { claimsAccess } from "@/lib/dashboard/claims/access";
import { searchClaims } from "@/lib/dashboard/claims/search";
import { mayUseRoleDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const access = claimsAccess(session);
    if (!(await mayUseRoleDashboard(session, "claims", access.allowed && access.canView))) {
      return NextResponse.json({ error: "You do not have access to insurance claims." }, { status: 403 });
    }
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ hits: [] });
    const hits = await withTenant(
      session.tenantId,
      (tx) => searchClaims(tx, session.tenantId, access.scope, q),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    return NextResponse.json({ hits });
  } catch (err) {
    return handleApiError(err);
  }
}
