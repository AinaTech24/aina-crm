/**
 * POST /api/dashboards/[id]/clone → a private copy for the caller, from any
 * dashboard they can see (the Owner Dashboard included — cloning is how a firm
 * varies a locked dashboard). A role dashboard that is a full page of its own
 * (Branch Head, RM, Operations, Insurance Team, Claims) has no cards to copy.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { cloneDashboard, loadDashboard, systemDef, viewerFacts } from "@/lib/dashboards/platform";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const newId = await withTenant(session.tenantId, async (tx) => {
      const hit = await loadDashboard(tx, await viewerFacts(tx, session), id);
      if (!hit || hit.d.deletedAt) return null;
      if (systemDef(hit.d)?.centre) return "centre" as const;
      return cloneDashboard(tx, session, hit.d);
    });
    if (!newId) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (newId === "centre") {
      return NextResponse.json({ error: "This dashboard can't be cloned. Clone the Owner Dashboard, or build one from the widget library." }, { status: 400 });
    }
    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
