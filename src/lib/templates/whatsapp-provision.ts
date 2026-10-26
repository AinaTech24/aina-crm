/**
 * Create the firm's required WhatsApp templates and send every one to Meta for
 * approval — the moment the firm connects its own WhatsApp channel (Vartify).
 *
 * Three callers, one function:
 *   - Connecting / updating the key      → `provisionWhatsappTemplates` (creates + submits)
 *   - "Create required templates" button → the same, retrying anything that failed
 *   - The 15-minute Vartify sync worker  → `retryFailedSubmissions`, which only
 *     re-sends templates that already exist. It never creates, so a template a
 *     firm archived is never brought back.
 *
 * Idempotent per firm: a template is keyed (tenant, key, whatsapp, en-IN), a
 * submission is claimed with one UPDATE so two callers can never both send the
 * same template to Meta, and a name Vartify already has is treated as sent —
 * the sync worker then mirrors its real status.
 *
 * Statuses live where the rest of the CRM already reads them:
 *   templates.status            draft → pending_approval → approved | rejected
 *   template_versions           approval_status submitted · external_status PENDING | FAILED
 * so the Templates screen shows Meta's progress with no new table.
 */

import { v4 as uuid } from "uuid";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";
import { vartifyWhatsappAdapter } from "@/lib/comms/adapters/vartify";
import { buildMetaSubmission } from "@/lib/comms/whatsapp-template-submit";
import { recordAudit } from "@/lib/audit";
import { WHATSAPP_TEMPLATES, WA_LANGUAGE, type CatalogueTemplate } from "./whatsapp-catalogue";

const LOCALE = "en-IN";
const KEYS = WHATSAPP_TEMPLATES.map((t) => t.key);

/** Vartify's wording when the name is already in the workspace. */
const ALREADY_THERE = /already\s+(exist|been|in use|taken)|duplicate|name.*(taken|exists|in use)|exists/i;

export type ProvisionResult = {
  connected: boolean;
  total: number;
  created: number;
  submitted: number;
  failed: Array<{ key: string; error: string }>;
};

export type CatalogueStatus = {
  key: string;
  name: string;
  category: "utility" | "marketing";
  useFor: string;
  /** missing = not created yet · draft = created, not sent · failed = Meta/Vartify refused */
  state: "missing" | "draft" | "failed" | "pending" | "approved" | "rejected" | "archived";
  error?: string | null;
};

function bodyJson(t: CatalogueTemplate) {
  return {
    body: { text: t.body },
    ...(t.footer ? { footer: { text: t.footer } } : {}),
    // What the send needs: the Meta name and the language it was submitted in.
    metaTemplateName: t.key,
    languageCode: WA_LANGUAGE,
    // A later "Fetch from WhatsApp" must update the status of this template, not
    // replace its named variables with Meta's bare {{1}}, {{2}}.
    autoProvisioned: true,
  };
}

/** Write any catalogue template the firm does not have yet (as a draft). */
async function createMissing(tx: Tx, tenantId: string, userId: string | null): Promise<number> {
  const have = await tx
    .select({ key: templates.key })
    .from(templates)
    .where(
      and(
        eq(templates.tenantId, tenantId),
        eq(templates.channel, "whatsapp"),
        eq(templates.locale, LOCALE),
        inArray(templates.key, KEYS)
      )
    );
  const present = new Set(have.map((r) => r.key));
  let created = 0;
  for (const t of WHATSAPP_TEMPLATES) {
    if (present.has(t.key)) continue;
    const templateId = uuid();
    const versionId = uuid();
    await tx.insert(templates).values({
      id: templateId,
      tenantId,
      key: t.key,
      channel: "whatsapp",
      name: t.name,
      description: t.description,
      category: t.category,
      locale: LOCALE,
      status: "draft",
      currentVersionId: versionId,
    });
    await tx.insert(templateVersions).values({
      id: versionId,
      templateId,
      tenantId,
      versionNumber: 1,
      body: bodyJson(t),
      variables: t.variables,
      approvalStatus: "draft",
      createdByUserId: userId,
    });
    created++;
  }
  return created;
}

/**
 * Send every catalogue template that is still a draft to Meta. A template is
 * taken (claimed) before the call, so a second caller skips it; a failed one is
 * retried only once `retryFailedAfterMs` has passed.
 */
async function submitDrafts(
  tenantId: string,
  creds: { apiKey: string; baseUrl?: string },
  retryFailedAfterMs: number
): Promise<{ submitted: number; failed: Array<{ key: string; error: string }> }> {
  const rows = await withTenant(tenantId, async (tx) =>
    tx
      .select({ tpl: templates, ver: templateVersions })
      .from(templates)
      .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.channel, "whatsapp"),
          eq(templates.locale, LOCALE),
          inArray(templates.key, KEYS),
          ne(templates.status, "archived"),
          eq(templateVersions.approvalStatus, "draft")
        )
      )
  );

  let submitted = 0;
  const failed: Array<{ key: string; error: string }> = [];
  const retrySecs = Math.max(0, Math.floor(retryFailedAfterMs / 1000));

  for (const { tpl, ver } of rows) {
    const claimed = await withTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`
        UPDATE template_versions
        SET external_status = 'SUBMITTING', external_synced_at = now(), updated_at = now()
        WHERE id = ${ver.id}::uuid AND tenant_id = ${tenantId}::uuid AND approval_status = 'draft'
          AND (
            external_status IS NULL
            OR (external_status = 'FAILED'
                AND external_synced_at <= now() - make_interval(secs => ${retrySecs}::int))
            OR (external_status = 'SUBMITTING' AND external_synced_at < now() - interval '30 minutes')
          )
        RETURNING id
      `);
      return (r.rows?.length ?? 0) > 0;
    });
    if (!claimed) continue;

    const sub = buildMetaSubmission(tpl, ver);
    let outcome: { ok: boolean; metaTemplateId?: string; error?: string };
    try {
      outcome = await vartifyWhatsappAdapter.submitTemplate({ ...creds, ...sub });
    } catch (err: any) {
      outcome = { ok: false, error: String(err?.message ?? err) };
    }
    const alreadyThere = !outcome.ok && ALREADY_THERE.test(outcome.error ?? "");

    await withTenant(tenantId, async (tx) => {
      if (outcome.ok || alreadyThere) {
        await tx
          .update(templateVersions)
          .set({
            approvalStatus: "submitted",
            externalRef: outcome.metaTemplateId ?? sub.templateName,
            externalStatus: "PENDING",
            externalSyncedAt: new Date(),
            rejectionReason: null,
          })
          .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, tenantId)));
        await tx
          .update(templates)
          .set({ status: "pending_approval" })
          .where(and(eq(templates.id, tpl.id), eq(templates.tenantId, tenantId)));
      } else {
        await tx
          .update(templateVersions)
          .set({
            externalStatus: "FAILED",
            externalSyncedAt: new Date(),
            rejectionReason: String(outcome.error ?? "Submission failed").slice(0, 500),
          })
          .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, tenantId)));
      }
    });

    if (outcome.ok || alreadyThere) submitted++;
    else failed.push({ key: tpl.key, error: String(outcome.error ?? "Submission failed") });

    // Meta rate-limits template creation; ~20 calls are far under it, but a
    // short gap keeps a burst from looking like abuse.
    await new Promise((r) => setTimeout(r, 300));
  }
  return { submitted, failed };
}

async function credentialsFor(tenantId: string): Promise<{ apiKey: string; baseUrl?: string } | null> {
  const integ = await withTenant(tenantId, async (tx) => getTenantIntegration(tx, tenantId, whatsappProviderId));
  const apiKey = integ?.config?.apiKey;
  if (!integ?.isActive || !apiKey) return null;
  return { apiKey, baseUrl: integ.config.webhookUrl };
}

/**
 * Create the required templates and send them all to Meta. Safe to call as often
 * as you like — it only creates what is missing and only sends what is unsent.
 */
export async function provisionWhatsappTemplates(opts: {
  tenantId: string;
  userId?: string | null;
  /** How long a failed submission waits before it is tried again. 0 = now. */
  retryFailedAfterMs?: number;
}): Promise<ProvisionResult> {
  const { tenantId } = opts;
  const creds = await credentialsFor(tenantId);
  if (!creds) return { connected: false, total: WHATSAPP_TEMPLATES.length, created: 0, submitted: 0, failed: [] };

  const created = await withTenant(tenantId, async (tx) => createMissing(tx, tenantId, opts.userId ?? null));
  const { submitted, failed } = await submitDrafts(tenantId, creds, opts.retryFailedAfterMs ?? 0);

  if (created || submitted || failed.length) {
    await withTenant(tenantId, async (tx) => {
      await recordAudit(tx, {
        tenantId,
        actorUserId: opts.userId ?? null,
        action: "template.create",
        entityType: "whatsapp_templates",
        entityId: tenantId,
        after: { source: "whatsapp_connect", created, submitted, failed: failed.map((f) => f.key) },
      });
    });
  }
  return { connected: true, total: WHATSAPP_TEMPLATES.length, created, submitted, failed };
}

/**
 * The sync worker's share: re-send templates that exist but never reached Meta
 * (a failed or interrupted submission). Never creates a template.
 */
export async function retryFailedSubmissions(
  tenantId: string,
  retryFailedAfterMs = 6 * 60 * 60 * 1000
): Promise<{ submitted: number; failed: number }> {
  const creds = await credentialsFor(tenantId);
  if (!creds) return { submitted: 0, failed: 0 };
  const r = await submitDrafts(tenantId, creds, retryFailedAfterMs);
  return { submitted: r.submitted, failed: r.failed.length };
}

/** Where each required template stands, for the Settings panel. */
export async function whatsappTemplateStatuses(tenantId: string): Promise<CatalogueStatus[]> {
  const rows = await withTenant(tenantId, async (tx) =>
    tx
      .select({
        key: templates.key,
        status: templates.status,
        approval: templateVersions.approvalStatus,
        external: templateVersions.externalStatus,
        reason: templateVersions.rejectionReason,
      })
      .from(templates)
      .leftJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.channel, "whatsapp"),
          eq(templates.locale, LOCALE),
          inArray(templates.key, KEYS)
        )
      )
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return WHATSAPP_TEMPLATES.map((t) => {
    const base = { key: t.key, name: t.name, category: t.category, useFor: t.useFor };
    const r = byKey.get(t.key);
    if (!r) return { ...base, state: "missing" as const };
    if (r.status === "archived") return { ...base, state: "archived" as const };
    if (r.status === "approved") return { ...base, state: "approved" as const };
    if (r.status === "rejected" || r.approval === "rejected") return { ...base, state: "rejected" as const, error: r.reason };
    if (r.approval === "draft") {
      return r.external === "FAILED"
        ? { ...base, state: "failed" as const, error: r.reason }
        : { ...base, state: "draft" as const };
    }
    return { ...base, state: "pending" as const };
  });
}
