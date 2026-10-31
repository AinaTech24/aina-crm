/**
 * GET /api/settings/privacy-notice → { notice, contact }
 * PUT /api/settings/privacy-notice   { extraPurposes, extraRecipients, mentionsAi,
 *                                      contact: { name?, email?, phone? } }
 *
 * The firm's DPDP privacy notice (lib/privacy/notice.ts), public at
 * /privacy/<tenant id>. The contact is the firm's data protection officer
 * (tenants.dpo — the same field Organisation profile edits). A change to what
 * the notice says bumps its version; consent records carry the version the
 * person saw. Needs `settings.users`, like the rest of the firm's profile.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { PrivacyNoticeSettingsSchema, readPrivacyNotice } from "@/lib/privacy/notice";

export const dynamic = "force-dynamic";

const Body = PrivacyNoticeSettingsSchema.extend({
  contact: z
    .object({
      name: z.string().trim().max(120).optional().default(""),
      email: z.string().trim().email("Enter a valid email for the privacy contact").or(z.literal("")).optional().default(""),
      phone: z.string().trim().max(30).optional().default(""),
    })
    .default({}),
});

export async function GET() {
  try {
    const session = await requireSession();
    const out = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ privacyNotice: tenants.privacyNotice, dpo: tenants.dataProtectionOfficer })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId));
      return { notice: readPrivacyNotice(t?.privacyNotice), contact: t?.dpo ?? {} };
    });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
    }
    const { contact, ...settings } = parse.data;
    const saved = await withTenant(session.tenantId, async (tx) => {
      const [t] = await tx
        .select({ privacyNotice: tenants.privacyNotice, dpo: tenants.dataProtectionOfficer })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId));
      const before = readPrivacyNotice(t?.privacyNotice);
      const beforeContact = { name: t?.dpo?.name ?? "", email: t?.dpo?.email ?? "", phone: t?.dpo?.phone ?? "" };
      const changed =
        JSON.stringify({ p: before.extraPurposes, r: before.extraRecipients, a: before.mentionsAi, c: beforeContact }) !==
        JSON.stringify({ p: settings.extraPurposes, r: settings.extraRecipients, a: settings.mentionsAi, c: contact });
      // Any change is a new version — version 1 is the standard text, which
      // consents recorded before the firm's first edit refer to.
      const next = {
        ...settings,
        version: changed ? before.version + 1 : before.version,
        publishedAt: changed ? new Date().toISOString() : before.publishedAt,
      };
      const dpo = contact.name || contact.email || contact.phone ? contact : null;
      await tx
        .update(tenants)
        .set({ privacyNotice: next as Record<string, unknown>, dataProtectionOfficer: dpo, updatedAt: new Date() })
        .where(eq(tenants.id, session.tenantId));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "settings.privacy_notice",
        entityType: "tenant", entityId: session.tenantId,
        before: { ...before, contact: beforeContact }, after: { ...next, contact },
      });
      return next;
    });
    return NextResponse.json({ ok: true, notice: saved });
  } catch (err) {
    return handleApiError(err);
  }
}
