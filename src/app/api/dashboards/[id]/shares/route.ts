/**
 * PUT /api/dashboards/[id]/shares — who can see a dashboard, and the lock.
 *
 *   A custom dashboard: { mode: "me" | "all" | "custom", shares: [...], locked }
 *   A role dashboard:   { roleAudience: boolean, shares: [...] }
 *     roleAudience keeps it for everyone in the roles it is for (the 'all'
 *     row); `shares` are the particular users / roles / branches / teams it is
 *     shared with besides — or instead, with roleAudience off. A role
 *     dashboard is always locked.
 *
 * A custom dashboard: its creator or someone who may manage dashboards
 * (canShare). A branch head without "Manage dashboards" may share only inside
 * their own branch (allowedShares); "All users" is for managers. A role
 * dashboard: managers only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import {
  allowedShares, canShare, loadDashboard, replaceShares, viewerFacts, type ShareRow,
} from "@/lib/dashboards/platform";

export const dynamic = "force-dynamic";

const Body = z.object({
  mode: z.enum(["me", "all", "custom"]).optional(),
  roleAudience: z.boolean().optional(),
  shares: z.array(z.object({
    shareType: z.enum(["user", "role", "branch", "team"]),
    shareRef: z.string().min(1).max(64),
    includeSubordinates: z.boolean().default(false),
  })).max(200).default([]),
  locked: z.boolean().default(false),
});

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
    const b = parsed.data;
    const manager = session.roles.includes("owner") || can(session.roles, "dashboards.manage", session.permissions);
    if (b.mode === "all" && !manager) {
      return NextResponse.json({ error: "Only an admin can share a dashboard with everyone" }, { status: 403 });
    }
    const result = await withTenant(session.tenantId, async (tx) => {
      const v = await viewerFacts(tx, session);
      const hit = await loadDashboard(tx, v, id);
      if (!hit || hit.d.deletedAt) return { status: 404, error: "not found" };
      if (!canShare(v, hit.d)) {
        return { status: 403, error: hit.d.isSystem ? "Only an admin can share a role dashboard" : "Only its owner or an admin can share it" };
      }
      const all: ShareRow = { shareType: "all", shareRef: "", includeSubordinates: false };
      let rows: ShareRow[];
      if (hit.d.isSystem) {
        rows = [...((b.roleAudience ?? true) ? [all] : []), ...b.shares];
      } else {
        const mode = b.mode ?? "me";
        rows = mode === "all" ? [all] : mode === "custom" ? b.shares : [];
      }
      const checked = await allowedShares(tx, v, rows);
      if ("error" in checked) return { status: 403, error: checked.error };
      await replaceShares(tx, session, hit.d, checked, b.locked);
      return { status: 200, error: null };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
