/**
 * GET /api/settings/qa-sampling   the firm's QA sampling settings
 * PUT /api/settings/qa-sampling   { qa: { enabled, percent, types } }
 *
 * lib/qa/sampling.ts. Gated on `settings.dashboard`, like the other settings
 * in the same row (dashboard thresholds, escalation ladder).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { QaSettingsSchema, loadQaSettings, saveQaSettings } from "@/lib/qa/sampling";

export const dynamic = "force-dynamic";

const Body = z.object({ qa: QaSettingsSchema });

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const qa = await withTenant(session.tenantId, (tx) => loadQaSettings(tx, session.tenantId));
    return NextResponse.json({ qa });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "The share is a whole number from 1 to 100." }, { status: 400 });
    const qa = await withTenant(session.tenantId, async (tx) => {
      const before = await loadQaSettings(tx, session.tenantId);
      const saved = await saveQaSettings(tx, session.tenantId, session.userId, parse.data.qa);
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "settings.qa_sampling",
        entityType: "tenant", entityId: session.tenantId, before, after: saved,
      });
      return saved;
    });
    return NextResponse.json({ ok: true, qa });
  } catch (err) {
    return handleApiError(err);
  }
}
