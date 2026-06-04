/**
 * WAina (ainatech.in) WhatsApp adapter.
 *
 * WAina is the operator's OWN WhatsApp Business sender — no third-party BSP
 * markup. It exposes a single outbound endpoint that accepts a Meta-style
 * template payload:
 *
 *   POST {WAINA_WEBHOOK_URL}?api_key={WAINA_API_KEY}
 *   {
 *     "phone_number": "<wa_id, country code + number, no '+'>",
 *     "contact_name": "<display name>",
 *     "message_type": "template",
 *     "template_name": "<Meta-approved template name>",
 *     "language_code": "en_US",
 *     "template_components": [
 *       { "type": "body", "parameters": [ { "type": "text", "text": "<value>" } ] }
 *     ]
 *   }
 *
 * This is a DROP-IN for the AiSensy adapter on the *send* path; the active
 * provider is chosen in ./whatsapp.ts via WHATSAPP_PROVIDER=waina. It implements
 * the same method surface (send / listTemplates / submitTemplate /
 * verifyWebhookSignature) so every existing importer keeps type-checking, even
 * though WAina manages templates + inbound webhooks in its own console.
 *
 * Template-name resolution (first non-empty wins):
 *   templateVersion.body.wainaTemplateName
 *   templateVersion.body.metaTemplateName
 *   templateVersion.externalRef            (Meta template id/name synced in)
 *   templateVersion.body.aisensyCampaignName
 *
 * Body parameters map from the template's ordered `variables[]` → resolved
 * `tokens`. For templates with header media / buttons / multiple components,
 * set `body.wainaTemplateComponents` to the full component array using
 * `${tokenKey}` placeholders — it is sent verbatim after token substitution.
 */

import axios from "axios";
import type { SendWhatsappArgs } from "./aisensy";

interface WainaConfig {
  url: string;
  apiKey: string;
  defaultLanguage: string;
}

/** WAina's shared platform send endpoint (the api_key identifies the MFD). */
const DEFAULT_WAINA_URL = "https://beckend.ainatech.in/api/extension/zoho-workflow";

/**
 * Resolve credentials with this precedence:
 *   1. Per-tenant config saved in Settings → Integrations (args.*)
 *   2. Platform env (WAINA_*)
 *   3. Built-in default URL
 * Only the api_key is mandatory; each MFD provides their own once.
 */
function resolveConfig(args: SendWhatsappArgs): WainaConfig {
  const url = args.webhookUrl ?? process.env.WAINA_WEBHOOK_URL ?? DEFAULT_WAINA_URL;
  const apiKey = args.apiKey ?? process.env.WAINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WAina: no API key — connect WAina in Settings → Integrations, or set WAINA_API_KEY"
    );
  }
  return {
    url,
    apiKey,
    defaultLanguage:
      args.defaultLanguage ?? process.env.WAINA_DEFAULT_LANGUAGE ?? "en_US",
  };
}

/** Recursively replace `${key}` placeholders inside an arbitrary structure. */
function substituteTokens(value: unknown, tokens: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_m, k) => tokens[String(k).trim()] ?? "");
  }
  if (Array.isArray(value)) return value.map((v) => substituteTokens(v, tokens));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteTokens(v, tokens);
    }
    return out;
  }
  return value;
}

/** WAina outbound template payload (mirrors the documented request body). */
export interface WainaPayload {
  phone_number: string;
  contact_name: string;
  message_type: "template";
  template_name: string;
  language_code: string;
  template_components: any[];
}

/**
 * Pure mapper: SendWhatsappArgs (+ default language) → WAina request body.
 * Separated from the HTTP call so it can be unit-tested without a network send.
 */
export function buildWainaPayload(
  args: SendWhatsappArgs,
  defaultLanguage = "en_US"
): WainaPayload {
  const body = (args.templateVersion.body ?? {}) as Record<string, any>;

  const templateName =
    body.wainaTemplateName ??
    body.metaTemplateName ??
    args.templateVersion.externalRef ??
    body.aisensyCampaignName;
  if (!templateName) {
    throw new Error(
      "WAina send: no template name — set templateVersion.body.wainaTemplateName or externalRef"
    );
  }

  const languageCode = body.languageCode ?? body.wainaLanguage ?? defaultLanguage;

  // Build template_components.
  let templateComponents: any[];
  if (Array.isArray(body.wainaTemplateComponents)) {
    // Full escape hatch — caller supplied the complete component tree.
    templateComponents = substituteTokens(body.wainaTemplateComponents, args.tokens) as any[];
  } else {
    // Common case: positional body params from ordered template variables.
    const variables = (args.templateVersion.variables as Array<{ key: string }>) ?? [];
    const parameters = variables.map((v) => ({
      type: "text",
      text: args.tokens[v.key] ?? "",
    }));
    templateComponents = parameters.length ? [{ type: "body", parameters }] : [];
  }

  return {
    phone_number: normalizeWaId(args.recipient),
    contact_name:
      args.tokens.name ?? args.tokens.investor_name ?? args.tokens.contact_name ?? "Investor",
    message_type: "template",
    template_name: templateName,
    language_code: languageCode,
    template_components: templateComponents,
  };
}

export const wainaWhatsappAdapter = {
  async send(
    args: SendWhatsappArgs
  ): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const cfg = resolveConfig(args);
    const payload = buildWainaPayload(args, cfg.defaultLanguage);

    try {
      const res = await axios.post(cfg.url, payload, {
        // api_key travels as a query param, per the WAina endpoint contract.
        params: { api_key: cfg.apiKey },
        timeout: 15_000,
        headers: {
          "Content-Type": "application/json",
          // Best-effort dedup across step retries (ignored if WAina doesn't use it).
          ...(args.idempotencyKey ? { "X-Idempotency-Key": args.idempotencyKey } : {}),
        },
      });
      const data = (res.data ?? {}) as Record<string, any>;
      const externalId =
        data.message_id ??
        data.messageId ??
        data.data?.message_id ??
        data.id ??
        `waina-${args.idempotencyKey ?? Date.now()}`;
      return { externalId: String(externalId), status: "sent" };
    } catch (err: any) {
      const detail = err.response?.data ?? err.message;
      throw new Error(
        `WAina send failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
      );
    }
  },

  // --- Parity stubs (WAina manages these in its own console) -------------
  async listTemplates(): Promise<Array<any>> {
    // Nothing to sync from here; templates live in the WAina dashboard.
    return [];
  },

  async submitTemplate(): Promise<{ ok: boolean; metaTemplateId?: string; raw: unknown }> {
    throw new Error("WAina adapter: create/submit templates in the WAina console, not via this API");
  },

  verifyWebhookSignature(): boolean {
    // WAina inbound webhooks are configured separately (see the WAina Webhooks
    // screen). No shared-secret HMAC is wired on this path yet.
    return false;
  },
};

/** Country-code + number, no '+', assume India for bare 10-digit numbers. */
function normalizeWaId(num: string): string {
  let n = (num ?? "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
