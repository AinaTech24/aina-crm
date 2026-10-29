/**
 * GET /api/settings/escalation   the firm's escalation ladder for overdue tasks
 * PUT /api/settings/escalation   { ladder } — save it (switching it on stamps activeSince)
 *
 * lib/tasks/escalation-ladder.ts holds the rules; the task reminder scanner
 * climbs them. Gated on `settings.dashboard`, like the dashboard thresholds
 * that share its settings row.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { LadderSchema, loadLadder, saveLadder } from "@/lib/tasks/escalation-ladder";

export const dynamic = "force-dynamic";

const Body = z.object({ ladder: LadderSchema });

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const ladder = await withTenant(session.tenantId, (tx) => loadLadder(tx, session.tenantId));
    return NextResponse.json({ ladder });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "Check the hours — each is a whole number from 1 to 1440.", issues: parse.error.issues }, { status: 400 });
    }
    const ladder = await withTenant(session.tenantId, async (tx) => {
      const before = await loadLadder(tx, session.tenantId);
      const saved = await saveLadder(tx, session.tenantId, session.userId, parse.data.ladder);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "settings.escalation_ladder",
        entityType: "tenant",
        entityId: session.tenantId,
        before,
        after: saved,
      });
      return saved;
    });
    return NextResponse.json({ ok: true, ladder });
  } catch (err) {
    return handleApiError(err);
  }
}
