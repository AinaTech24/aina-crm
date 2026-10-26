/**
 * PUT /api/settings/daily-tracker   { remindAt: "HH:MM" | null }
 *
 * When the team is reminded, once, to fill in the day's Daily Job Tracker
 * (lib/team/daily-discipline.ts). Gated on `settings.dashboard`, like the
 * other settings stored in the same row.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { TrackerSettingsSchema, loadTrackerSettings, saveTrackerSettings } from "@/lib/team/daily-discipline";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const parse = TrackerSettingsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Pick a time, or no reminder." }, { status: 400 });
    const saved = await withTenant(session.tenantId, async (tx) => {
      const before = await loadTrackerSettings(tx, session.tenantId);
      const after = await saveTrackerSettings(tx, session.tenantId, session.userId, parse.data);
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "settings.daily_tracker",
        entityType: "tenant", entityId: session.tenantId, before, after,
      });
      return after;
    });
    return NextResponse.json({ ok: true, settings: saved });
  } catch (err) {
    return handleApiError(err);
  }
}
