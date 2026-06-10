/**
 * Import the firm's EXISTING WhatsApp templates from their connected WAina
 * workspace into the CRM. WhatsApp templates are authored + approved in the
 * WAina/Meta console (Meta requirement); here we pull them so they show up in
 * Message Templates and become sendable through the comms pipeline.
 *
 * For each Meta template we upsert:
 *   - a `templates` row (key = Meta template name, channel=whatsapp) + version
 *     whose body carries the Meta name/components so the WAina adapter can send
 *     it, with status mirrored from Meta (APPROVED → approved).
 *   - a `whatsapp_templates` row (the Meta status registry, same as the worker).
 */

import { and, eq, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { getTenantIntegration } from "./integrations";
import { whatsappProviderId } from "./adapters/whatsapp";
import { fetchWainaTemplatesDetailed } from "./adapters/waina";

const CATEGORY_MAP: Record<string, string> = { MARKETING: "marketing", UTILITY: "utility", AUTHENTICATION: "authentication" };
function mapCategory(c?: string): string {
  return CATEGORY_MAP[(c ?? "").toString().toUpperCase()] ?? "utility";
}
function mapLocale(lang?: string): string {
  const l = (lang ?? "").toString().toLowerCase();
  if (l.startsWith("hi")) return "hi-IN";
  if (l.startsWith("gu")) return "gu-IN";
  if (l.startsWith("mr")) return "mr-IN";
  return "en-IN";
}
function bodyText(components: any): string {
  if (!Array.isArray(components)) return "";
  const body = components.find((c) => (c?.type ?? "").toString().toUpperCase() === "BODY");
  return (body?.text ?? body?.parameters?.text ?? "") as string;
}

/** Distinct {{N}} placeholder keys in order of first appearance. */
function extractVarKeys(text: string): string[] {
  const seen = new Set<string>();
  for (const m of String(text ?? "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) seen.add(m[1]);
  return [...seen];
}

/** Header type + sample media URL + whether the header carries a {{var}}. */
function headerInfo(components: any): { format: string | null; sampleUrl: string | null; hasVar: boolean } {
  if (!Array.isArray(components)) return { format: null, sampleUrl: null, hasVar: false };
  const h = components.find((c) => (c?.type ?? "").toString().toUpperCase() === "HEADER");
  if (!h) return { format: null, sampleUrl: null, hasVar: false };
  const format = (h.format ?? "").toString().toUpperCase() || null;
  const sampleUrl = h.example?.header_handle?.[0] ?? h.example?.header_url ?? null;
  const hasVar = /\{\{\s*\w+\s*\}\}/.test(String(h.text ?? ""));
  return { format, sampleUrl, hasVar };
}

export interface ImportResult {
  ok: boolean;
  fetched: number;
  imported: number;
  approved: number;
  error?: string;
}

export async function importWhatsappTemplatesForTenant(tx: Tx, tenantId: string, actorUserId?: string | null): Promise<ImportResult> {
  const integ = await getTenantIntegration(tx, tenantId, whatsappProviderId);
  const apiKey = (integ?.config as any)?.apiKey as string | undefined;
  if (!integ?.isActive || !apiKey) {
    return { ok: false, fetched: 0, imported: 0, approved: 0, error: "WhatsApp isn't connected — connect WAina in Settings → Integrations first." };
  }
  const baseUrl = (integ?.config as any)?.webhookUrl as string | undefined;

  const fetched = await fetchWainaTemplatesDetailed({ apiKey, baseUrl });
  if (!fetched.ok) {
    // A real failure (bad key, wrong base URL, permission error, network) —
    // surface it instead of silently reporting "no templates found".
    const isPerm = /permission|forbidden|unauthor/i.test(fetched.error ?? "") || fetched.status === 403;
    const hint = isPerm
      ? "Your WAina key can read the workspace but not its templates — it may be a webhook key or lack the template scope. In WAina → API Keys, generate an API key with template access and paste it via Update key."
      : "Check the WAina API key under Settings → Integrations → WhatsApp.";
    return {
      ok: false,
      fetched: 0,
      imported: 0,
      approved: 0,
      error: `WhatsApp template fetch was rejected${fetched.status ? ` (${fetched.status})` : ""}: ${fetched.error}. ${hint}`,
    };
  }
  const metas = fetched.templates;
  if (!metas.length) {
    // Genuinely empty: the key works but the WAina/Meta workspace has no templates.
    return { ok: true, fetched: 0, imported: 0, approved: 0 };
  }

  let imported = 0;
  let approved = 0;

  for (const meta of metas) {
    const name: string = (meta?.name ?? meta?.template_name ?? "").toString();
    if (!name) continue;

    const language = (meta?.language ?? "en").toString();
    const locale = mapLocale(language);
    const category = mapCategory(meta?.category);
    const metaStatus = (meta?.status ?? "PENDING").toString().toUpperCase();
    const components = meta?.components ?? [];
    const text = bodyText(components);
    const tplStatus = metaStatus === "APPROVED" ? "approved" : metaStatus === "REJECTED" ? "rejected" : "pending_approval";
    const verApproval = metaStatus === "APPROVED" ? "approved_external" : metaStatus === "REJECTED" ? "rejected" : "submitted";

    // Body placeholders {{1}},{{2}} → editable variables in the composer + the send.
    const varKeys = extractVarKeys(text);
    const variables = varKeys.map((k) => ({ key: k, label: `Variable {{${k}}}`, required: true }));
    const hdr = headerInfo(components);

    // Body carries the Meta name + components + header info so the WAina adapter
    // can send via /extension/send-message (variables + optional header media).
    const body = {
      wainaTemplateName: name,
      metaTemplateName: name,
      languageCode: language,
      components,
      body: { text },
      text,
      headerFormat: hdr.format,
      headerSampleUrl: hdr.sampleUrl,
      headerHasVar: hdr.hasVar,
    } as any;

    const [existing] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.tenantId, tenantId), eq(templates.key, name), eq(templates.channel, "whatsapp"), eq(templates.locale, locale)))
      .limit(1);

    let templateId: string;
    if (existing) {
      templateId = existing.id;
      await tx.update(templates).set({ status: tplStatus as any, category: category as any, updatedAt: new Date() } as any).where(eq(templates.id, existing.id));
      if (existing.currentVersionId) {
        await tx
          .update(templateVersions)
          .set({ body, variables, approvalStatus: verApproval as any, externalRef: name, externalStatus: metaStatus, externalSyncedAt: new Date(), updatedAt: new Date() } as any)
          .where(eq(templateVersions.id, existing.currentVersionId));
      }
    } else {
      templateId = uuid();
      const verId = uuid();
      await tx.insert(templates).values({
        id: templateId, tenantId, key: name, channel: "whatsapp",
        name: name.replace(/_/g, " "), category: category as any, locale,
        status: tplStatus as any, currentVersionId: verId,
      } as any);
      await tx.insert(templateVersions).values({
        id: verId, templateId, tenantId, versionNumber: 1, body,
        variables, attachments: [], approvalStatus: verApproval as any,
        externalRef: name, externalStatus: metaStatus, externalSyncedAt: new Date(),
        createdByUserId: actorUserId ?? null,
      } as any);
    }

    imported++;
    if (metaStatus === "APPROVED") approved++;

    // Mirror into the Meta-status registry (same shape as the background sync).
    await tx.execute(sql`
      INSERT INTO whatsapp_templates
        (id, tenant_id, template_id, meta_template_name, meta_language, category, meta_status,
         meta_rejection_reason, components, last_synced_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(), ${tenantId}::uuid, ${templateId}::uuid, ${name}, ${language},
        ${(meta?.category ?? "UTILITY").toString().toUpperCase()}, ${metaStatus},
        ${meta?.rejected_reason ?? meta?.rejection_reason ?? null},
        ${JSON.stringify(components)}::jsonb, now(), now(), now()
      )
      ON CONFLICT (tenant_id, meta_template_name, meta_language) DO UPDATE
        SET meta_status = EXCLUDED.meta_status,
            meta_rejection_reason = EXCLUDED.meta_rejection_reason,
            components = EXCLUDED.components,
            template_id = COALESCE(whatsapp_templates.template_id, EXCLUDED.template_id),
            last_synced_at = now(), updated_at = now()
    `);
  }

  return { ok: true, fetched: metas.length, imported, approved };
}
