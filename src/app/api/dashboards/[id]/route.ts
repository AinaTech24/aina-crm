/**
 * PATCH  /api/dashboards/[id]  → name / description / layout / filter configuration
 * DELETE /api/dashboards/[id]  → soft delete → Recently deleted (restorable 30 days)
 *
 * Editing needs canEdit (creator, a manager, or a share while unlocked);
 * deleting needs the creator or a manager. System dashboards are locked.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { dashboards } from "@/db/schema";
import { canEdit, canShareOrDelete, loadDashboard, viewerFacts } from "@/lib/dashboards/platform";
import { sanitizeLayoutItems } from "@/lib/dashboards/system/catalog";
import { sanitizeFilterConfig } from "@/lib/dashboards/system/filters";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  layout: z.array(z.unknown()).max(40).optional(),
  filterConfig: z.unknown().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
    const status = await withTenant(session.tenantId, async (tx) => {
      const v = await viewerFacts(tx, session);
      const hit = await loadDashboard(tx, v, id);
      if (!hit || hit.d.deletedAt) return 404;
      if (!canEdit(v, hit.d, hit.shares)) return 403;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.description !== undefined) patch.description = parsed.data.description;
      if (parsed.data.layout !== undefined) {
        const layout = sanitizeLayoutItems(parsed.data.layout);
        if (!layout.length) return 400;
        patch.layout = layout;
      }
      if (parsed.data.filterConfig !== undefined) patch.filterConfig = sanitizeFilterConfig(parsed.data.filterConfig);
      await tx.update(dashboards).set(patch as never).where(eq(dashboards.id, id));
      return 200;
    });
    if (status === 400) return NextResponse.json({ error: "Add at least one widget" }, { status });
    if (status !== 200) return NextResponse.json({ error: status === 404 ? "not found" : "This dashboard is locked" }, { status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const status = await withTenant(session.tenantId, async (tx) => {
      const v = await viewerFacts(tx, session);
      const hit = await loadDashboard(tx, v, id);
      if (!hit || hit.d.deletedAt) return 404;
      if (!canShareOrDelete(v, hit.d)) return 403;
      await tx.update(dashboards).set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() } as never)
        .where(eq(dashboards.id, id));
      return 200;
    });
    if (status !== 200) {
      return NextResponse.json({ error: status === 404 ? "not found" : "Only its owner or an admin can delete it" }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
