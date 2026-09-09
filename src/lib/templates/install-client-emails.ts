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

/** Keys seeded into every firm. Keep in step with migration 0206. */
export const CLIENT_EMAIL_TEMPLATE_KEYS = [
  "risk_profile_result",
  "risk_profile_assigned",
  "feedback_nps",
  "suitability_review",
] as const;

export async function installClientEmailTemplates(
  tx: Tx,
  tenantId: string,
  userId?: string | null
): Promise<{ installed: string[]; skipped: string[] }> {
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const key of CLIENT_EMAIL_TEMPLATE_KEYS) {
    const starter = STARTER_TEMPLATES.find((s) => s.key === key);
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
