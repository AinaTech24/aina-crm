/**
 * GET /api/settings/firm-intro   → { intro, customFields }
 * PUT /api/settings/firm-intro   { company_intro?, services?, office_timing?, mission?,
 *                                  founder_name?, founder_designation?, founder_photo_url?,
 *                                  founder_intro?, custom?: [{ label, value }] }
 *
 * The firm's introduction for client emails ({{firm.*}}, lib/firm/email-intro.ts).
 * Anyone signed in may read it — the template designer lists the firm's own
 * fields in its picker. Changing it needs `settings.users`, like the rest of
 * the firm's profile.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { FirmEmailIntroSchema, readFirmEmailIntro } from "@/lib/firm/email-intro";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const intro = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx.select({ emailIntro: tenants.emailIntro }).from(tenants).where(eq(tenants.id, session.tenantId));
      return readFirmEmailIntro(t?.emailIntro);
    });
    return NextResponse.json({
      intro,
      customFields: (intro.custom ?? []).map((c) => ({ token: `firm.${c.key}`, label: c.label, example: c.value })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const parse = FirmEmailIntroSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
    }
    const saved = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx.select({ emailIntro: tenants.emailIntro }).from(tenants).where(eq(tenants.id, session.tenantId));
      const before = readFirmEmailIntro(t?.emailIntro);
      await tx.update(tenants).set({ emailIntro: parse.data as Record<string, unknown>, updatedAt: new Date() }).where(eq(tenants.id, session.tenantId));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "settings.firm_email_intro",
        entityType: "tenant", entityId: session.tenantId, before, after: parse.data,
      });
      return parse.data;
    });
    return NextResponse.json({ ok: true, intro: saved });
  } catch (err) {
    return handleApiError(err);
  }
}
