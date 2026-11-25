import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/client-master/summary — what the optional sections of the client
 * master PDF would hold (record counts) and which of them the viewer's role may include.
 * Feeds the "Download client master" popup.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { countClientMasterSections } from "@/lib/investors/client-master/load";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const out = await withTenant(
      session.tenantId,
      (tx) => countClientMasterSections(tx, session, id),
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if (!out) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
