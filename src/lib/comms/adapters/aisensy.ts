/**
 * AiSensy WhatsApp Business adapter.
 *
 * AiSensy is a Meta-approved WhatsApp BSP popular with Indian MFDs. Their
 * v2 API provides:
 *   - POST /campaign/t1/api/v2  — send template-based message to a single recipient
 *   - GET  /v2/templates        — list templates synced from Meta
 *   - Webhook POST callback     — delivery status + inbound messages
 *
 * Each tenant configures their own AiSensy API key + WhatsApp number. We
 * store per-tenant credentials in `tenants.feature_flags` for now (move to a
 * dedicated `integrations` table later).
 *
 * Note: AiSensy's API surface changes occasionally — keep the request payload
 * conservative and watch for version updates.
 */

import axios from "axios";
import type { TemplateVersion } from "@/db/schema";

interface AiSensyConfig {
  apiKey: string;
  baseUrl: string;
  defaultCampaignName?: string;
}

async function getTenantConfig(tenantId: string): Promise<AiSensyConfig> {
  // TODO: load tenant-specific config from DB. For now, fall back to env.
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    throw new Error("AISENSY_API_KEY not set");
  }
  return {
    apiKey,
    baseUrl: process.env.AISENSY_BASE_URL ?? "https://backend.aisensy.com",
  };
}

export interface SendWhatsappArgs {
  tenantId: string;
  templateVersion: TemplateVersion;
  tokens: Record<string, string>;
  recipient: string; // E.164 number — "+91XXXXXXXXXX"
}

export const whatsappAdapter = {
  async send(args: SendWhatsappArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const cfg = await getTenantConfig(args.tenantId);

    const recipient = normalizeE164(args.recipient);
    const body = args.templateVersion.body as any;
    const campaignName = body.aisensyCampaignName ?? args.templateVersion.externalRef ?? "default";

    // Convert tokens map to AiSensy positional templateParams array.
    // Templates declare ordered variable keys in `variables[]`; we map by order.
    const variables = (args.templateVersion.variables as Array<{ key: string }>) ?? [];
    const templateParams = variables.map((v) => args.tokens[v.key] ?? "");

    const payload = {
      apiKey: cfg.apiKey,
      campaignName,
      destination: recipient,
      userName: args.tokens.name ?? args.tokens.investor_name ?? "Investor",
      templateParams,
      source: "mfd-platform",
      media: body.header?.media ?? {},
      buttons: body.buttons ?? [],
      carouselCards: [],
      location: {},
    };

    try {
      const res = await axios.post(`${cfg.baseUrl}/campaign/t1/api/v2`, payload, {
        timeout: 15_000,
        headers: { "Content-Type": "application/json" },
      });
      const externalId = res.data?.messageId ?? res.data?.data?.messageId ?? `aisensy-${Date.now()}`;
      return { externalId, status: "sent" };
    } catch (err: any) {
      const detail = err.response?.data ?? err.message;
      throw new Error(`AiSensy send failed: ${JSON.stringify(detail)}`);
    }
  },

  /** Fetch the latest template list from AiSensy. Used by the sync worker. */
  async listTemplates(tenantId: string): Promise<Array<any>> {
    const cfg = await getTenantConfig(tenantId);
    const res = await axios.get(`${cfg.baseUrl}/v2/templates`, {
      params: { apiKey: cfg.apiKey },
      timeout: 30_000,
    });
    return res.data?.templates ?? res.data?.data ?? [];
  },

  /** Submit a new template for Meta approval via AiSensy. */
  async submitTemplate(
    tenantId: string,
    input: {
      name: string;
      category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
      language: string;
      components: any[];
    }
  ): Promise<{ ok: boolean; metaTemplateId?: string; raw: unknown }> {
    const cfg = await getTenantConfig(tenantId);
    const res = await axios.post(
      `${cfg.baseUrl}/v2/templates`,
      { apiKey: cfg.apiKey, ...input },
      { timeout: 30_000 }
    );
    return { ok: !!res.data?.success, metaTemplateId: res.data?.template?.id, raw: res.data };
  },

  /** Verify HMAC signature from AiSensy webhook. */
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const secret = process.env.AISENSY_WEBHOOK_SECRET;
    if (!secret) return false;
    // AiSensy uses HMAC-SHA256 over raw body
    const crypto = require("crypto") as typeof import("crypto");
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  },
};

function normalizeE164(num: string): string {
  let n = num.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`; // assume India if 10 digits
  return n;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
