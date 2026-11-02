/**
 * GET /api/settings/data-retention?lostLeadMonths=&formerClientYears=
 *   → { settings, preview: { leads, clients } } — what those values would erase tonight
 * PUT /api/settings/data-retention { lostLeadMonths: number|null, formerClientYears: number|null }
 *
 * The firm's DPDP retention policy (lib/privacy/retention-core.ts), run nightly
 * by workers/daily-ops-scanner.ts. Off (null) until set. Needs `settings.users`
 * or `compliance.edit`.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { RetentionSettingsSchema, readRetention } from "@/lib/privacy/retention-core";
import { previewRetention } from "@/lib/privacy/retention";

export const dynamic = "force-dynamic";

const num = (v: string | null) => (v == null || v === "" ? null : Number(v));

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["settings.users", "compliance.edit"], session.permissions);
    const sp = req.nextUrl.searchParams;
    const out = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx.select({ r: tenants.dataRetention }).from(tenants).where(eq(tenants.id, session.tenantId));
      const settings = readRetention(t?.r);
      const asked = RetentionSettingsSchema.safeParse({
        lostLeadMonths: sp.has("lostLeadMonths") ? num(sp.get("lostLeadMonths")) : settings.lostLeadMonths,
        formerClientYears: sp.has("formerClientYears") ? num(sp.get("formerClientYears")) : settings.formerClientYears,
      });
      const preview = asked.success ? await previewRetention(tx, session.tenantId, asked.data) : null;
      return { settings, preview };
    });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["settings.users", "compliance.edit"], session.permissions);
    const parse = RetentionSettingsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the values and try again." }, { status: 400 });
    }
    await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx.select({ r: tenants.dataRetention }).from(tenants).where(eq(tenants.id, session.tenantId));
      const before = readRetention(t?.r);
      await tx.execute(sql`
        UPDATE tenants SET data_retention = data_retention || ${JSON.stringify(parse.data)}::jsonb, updated_at = now()
         WHERE id = ${session.tenantId}::uuid`);
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "settings.data_retention",
        entityType: "tenant", entityId: session.tenantId,
        before: { lostLeadMonths: before.lostLeadMonths, formerClientYears: before.formerClientYears }, after: parse.data,
      });
    });
    return NextResponse.json({ ok: true, settings: parse.data });
  } catch (err) {
    return handleApiError(err);
  }
}
