/**
 * Provision the client-facing email templates into a tenant's Templates list.
 *
 * These ship as designer STARTERS, but a starter is only a gallery entry an
 * author can pick from — it is not a row, so a new firm's Templates list is
 * empty and nothing can actually be sent. This turns the starters into real
 * template + version rows.
 *
 * Idempotent per (tenant, key, channel, locale): a firm that already has the
 * key is left alone, so this never duplicates and never overwrites a firm's own
 * edits. Existing tenants were backfilled by migration 0206, which generates
 * its SQL from the same starter definitions; this covers tenants created after.
 *
 * Seeded as approved — they are vendor-provided and compliance-reviewed, and
 * the 11-rule compliance gate still runs on every individual send.
 */

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { STARTER_TEMPLATES } from "@/lib/email-designer/starters";

const LOCALE = "en-IN";

/**
 * Keys seeded into every firm. The first four were backfilled by migration
 * 0206; `risk_profile_request` came later and reaches older firms on first use
 * (the Risk Profiles bulk "Send link" installs before it sends).
 */
export const CLIENT_EMAIL_TEMPLATE_KEYS = [
  "risk_profile_result",
  "risk_profile_assigned",
  "feedback_nps",
  "suitability_review",
  "risk_profile_request",
] as const;

/**
 * Emails sent about one RECORD of a client's — a rejected SIP, a switch / STP /
 * SWP — from the SIP Rejections and Transactions screens. Installed the first
 * time one is sent (installEmailStarters), not at signup.
 */
export const RECORD_EMAIL_TEMPLATE_KEYS = ["sip_rejection", "switch_stp_swp"] as const;

/**
 * Names a published workflow may still carry for a starter email. The "SIP
 * rejection follow-up" recipe once named `sip_rejection_mandate_expired_email`,
 * a template that never existed; a firm's installed copy of the workflow keeps
 * that name (published versions are immutable), so it resolves to the starter
 * now and is installed under the name the workflow uses.
 */
export const EMAIL_STARTER_ALIASES: Record<string, string> = {
  sip_rejection_mandate_expired_email: "sip_rejection",
};

export async function installClientEmailTemplates(
  tx: Tx,
  tenantId: string,
  userId?: string | null
): Promise<{ installed: string[]; skipped: string[] }> {
  return installEmailStarters(tx, tenantId, CLIENT_EMAIL_TEMPLATE_KEYS, userId);
}

/**
 * Install designer starters, by key, as the firm's own approved email templates.
 * Idempotent: a key the firm already has — in any status, so one it archived
 * stays archived — is left alone.
 */
export async function installEmailStarters(
  tx: Tx,
  tenantId: string,
  keys: readonly string[],
  userId?: string | null
): Promise<{ installed: string[]; skipped: string[] }> {
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const key of keys) {
    const starter = STARTER_TEMPLATES.find((s) => s.key === (EMAIL_STARTER_ALIASES[key] ?? key));
    if (!starter) continue;

    const existing = await tx
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.key, key),
          eq(templates.channel, "email"),
          eq(templates.locale, LOCALE)
        )
      )
      .limit(1);
    if (existing.length) {
      skipped.push(key);
      continue;
    }

    const templateId = randomUUID();
    const versionId = randomUUID();

    await tx.insert(templates).values({
      id: templateId,
      tenantId,
      key,
      channel: "email",
      name: starter.name,
      description: starter.description ?? null,
      category: starter.category,
      locale: LOCALE,
      status: "approved",
      currentVersionId: versionId,
    } as any);

    await tx.insert(templateVersions).values({
      id: versionId,
      templateId,
      tenantId,
      versionNumber: 1,
      body: starter.body as any,
      variables: [],
      attachments: [],
      approvalStatus: "approved_internal",
      createdByUserId: userId ?? null,
      approvedByUserId: userId ?? null,
      approvedAt: new Date(),
    } as any);

    installed.push(key);
  }

  return { installed, skipped };
}

/**
 * A workflow's email step names a template the firm may never have made. When the
 * name is one of the record emails (or an old name for one), install it on the
 * spot. An explicit list, not "any starter": whatever is installed here is
 * approved with nobody's sign-off, so a starter added later must be opted in.
 * Returns whether the key is one of these.
 */
export async function ensureEmailStarter(tx: Tx, tenantId: string, key: string): Promise<boolean> {
  const wanted = EMAIL_STARTER_ALIASES[key] ? [key] : (RECORD_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key) ? [key] : [];
  if (!wanted.length) return false; // not ours — and no query for it
  await installEmailStarters(tx, tenantId, wanted, null);
  return true;
}
