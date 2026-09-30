/**
 * PUT /api/dashboards/defaults — the firm's default dashboard for a role, or a
 * dashboard assigned to one user (which beats their role's default).
 *   { targetType: "role" | "user", targetRef, dashboardId | null }
 *
 * "Manage dashboards" only (owner, or the capability ticked for a user).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadDashboard, setRoleDefault, setUserAssignment, viewerFacts } from "@/lib/dashboards/platform";
import { ROLE_DEFAULTS } from "@/lib/dashboards/system/definitions";

export const dynamic = "force-dynamic";

const Body = z.object({
  targetType: z.enum(["role", "user"]),
  targetRef: z.string().min(1).max(64),
  dashboardId: z.string().uuid().nullable(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session.roles.includes("owner") && !can(session.roles, "dashboards.manage", session.permissions)) {
      return NextResponse.json({ error: "You need the Manage dashboards permission" }, { status: 403 });
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
    const b = parsed.data;
    if (b.targetType === "role" && !ROLE_DEFAULTS.some((r) => r.role === b.targetRef)) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }
    const status = await withTenant(session.tenantId, async (tx) => {
      if (b.targetType === "user") {
        const [u] = await tx.select({ id: users.id }).from(users)
          .where(and(eq(users.id, b.targetRef), eq(users.tenantId, session.tenantId))).limit(1);
        if (!u) return 404;
      }
      if (b.dashboardId) {
        const hit = await loadDashboard(tx, await viewerFacts(tx, session), b.dashboardId);
        if (!hit || hit.d.deletedAt) return 404;
      }
      if (b.targetType === "role") await setRoleDefault(tx, session, b.targetRef, b.dashboardId);
      else await setUserAssignment(tx, session, b.targetRef, b.dashboardId);
      return 200;
    });
    if (status !== 200) return NextResponse.json({ error: "not found" }, { status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
