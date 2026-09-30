/**
 * POST /api/dashboards/[id]/restore → back from Recently deleted, within 30
 * days. Its creator or a manager.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { dashboards } from "@/db/schema";
import { RESTORE_DAYS, canManageDashboards, loadDashboard, viewerFacts } from "@/lib/dashboards/platform";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const status = await withTenant(session.tenantId, async (tx) => {
      const hit = await loadDashboard(tx, await viewerFacts(tx, session), id);
      if (!hit || !hit.d.deletedAt) return 404;
      if (hit.d.userId !== session.userId && !canManageDashboards(session)) return 403;
      if (hit.d.deletedAt.getTime() < Date.now() - RESTORE_DAYS * 864e5) return 410;
      await tx.update(dashboards).set({ deletedAt: null, updatedAt: new Date() } as never).where(eq(dashboards.id, id));
      return 200;
    });
    if (status !== 200) {
      const error = status === 410 ? "Deleted more than 30 days ago" : status === 403 ? "forbidden" : "not found";
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
