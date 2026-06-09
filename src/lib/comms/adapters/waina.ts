/**
 * Aina WhatsApp (Wapi) adapter — the operator's OWN WhatsApp Business sender on
 * https://beckend.ainatech.in (no third-party BSP markup).
 *
 * Implements the documented "Wapi WhatsApp API" (https://beckend.ainatech.in/api/docs):
 *
 *   Auth      header  x-api-key: <key>          (long-lived workspace API key)
 *   Send      POST    {base}/whatsapp/send
 *               text     → { to, message }
 *               template → { to, template_name, language, components: [...] }
 *               (phone_number_id optional → defaults to the primary number)
 *   Response  { success: bool, data: { message_id, wa_message_id, status: "sent"|"queued"|"failed" } }
 *   Templates GET     {base}/extension/templates    → { success, data: [...] }
 *   Numbers   GET     {base}/extension/phone-numbers → { success, data: [...] }
 *   Status    GET     {base}/extension/status        → { success, data: { workspace_name, phone_numbers } }
 *
 * Base URL precedence: tenant-saved override (args.webhookUrl) → WAINA_BASE_URL →
 * WAINA_WEBHOOK_URL (legacy) → the platform default. Any legacy full send URL is
 * normalised back to the `/api` base.
 *
 * Template-name resolution (first non-empty wins):
 *   templateVersion.body.wainaTemplateName
 *   templateVersion.body.metaTemplateName
 *   templateVersion.externalRef            (Meta template id/name synced in)
 *   templateVersion.body.aisensyCampaignName
 *
 * Body parameters map from the template's ordered `variables[]` → resolved
 * `tokens` into the Meta `components` payload. For header media / buttons /
 * multiple components, set `body.wainaTemplateComponents` (or `body.components`)
 * to the full component array using `${tokenKey}` placeholders — it is sent
 * verbatim after token substitution. With no template name, a plain-text body is
 * sent as `{ to, message }` (only valid inside the 24-hour customer-care window).
 */

import axios from "axios";
import type { SendWhatsappArgs } from "./whatsapp-types";

/** Platform default API base (per the Wapi docs `servers` block). */
const DEFAULT_BASE_URL = "https://beckend.ainatech.in/api";

interface WapiConfig {
  baseUrl: string;
  apiKey: string;
  defaultLanguage: string;
}

/** Normalise any configured URL — a base, or a legacy full send endpoint — back
 *  to the `/api` base so we can append the documented paths. */
function toApiBase(raw?: string | null): string {
  let u = (raw ?? "").trim().replace(/\/+$/, "");
  if (!u) return DEFAULT_BASE_URL;
  // Strip a known endpoint suffix if someone configured the full send URL.
  u = u.replace(/\/(extension\/(zoho-workflow|send-message)|whatsapp\/send)$/i, "");
  return u || DEFAULT_BASE_URL;
}

function resolveConfig(args: SendWhatsappArgs): WapiConfig {
  const baseUrl = toApiBase(
    args.webhookUrl ?? process.env.WAINA_BASE_URL ?? process.env.WAINA_WEBHOOK_URL ?? DEFAULT_BASE_URL
  );
  const apiKey = args.apiKey ?? process.env.WAINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Aina WhatsApp: no API key — connect it in Settings → Integrations, or set WAINA_API_KEY"
    );
  }
  return {
    baseUrl,
    apiKey,
    defaultLanguage: args.defaultLanguage ?? process.env.WAINA_DEFAULT_LANGUAGE ?? "en_US",
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

/** Wapi `POST /whatsapp/send` request body — text or template form. */
export type WapiSendBody =
  | { to: string; message: string; phone_number_id?: string }
  | { to: string; template_name: string; language: string; components: any[]; phone_number_id?: string };

/**
 * Pure mapper: SendWhatsappArgs (+ default language) → Wapi request body.
 * Separated from the HTTP call so it can be unit-tested without a network send.
 */
export function buildWainaPayload(args: SendWhatsappArgs, defaultLanguage = "en_US"): WapiSendBody {
  const body = (args.templateVersion.body ?? {}) as Record<string, any>;
  const to = normalizeWaId(args.recipient);
  const phoneNumberId: string | undefined = body.wainaPhoneNumberId ?? body.phoneNumberId ?? undefined;

  const templateName =
    body.wainaTemplateName ?? body.metaTemplateName ?? args.templateVersion.externalRef ?? body.aisensyCampaignName;

  // No template → plain-text send (only valid inside the 24h customer-care window).
  if (!templateName) {
    const raw = body.text ?? body.body?.text ?? body.message ?? "";
    const message = String(substituteTokens(raw, args.tokens) ?? "");
    if (!message) {
      throw new Error(
        "Aina WhatsApp send: no template name (set templateVersion.body.wainaTemplateName or externalRef) and no plain-text body"
      );
    }
    return { to, message, ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}) };
  }

  const language = body.languageCode ?? body.wainaLanguage ?? defaultLanguage;

  // Build the Meta `components` array.
  let components: any[];
  if (Array.isArray(body.wainaTemplateComponents)) {
    components = substituteTokens(body.wainaTemplateComponents, args.tokens) as any[];
  } else if (Array.isArray(body.components)) {
    components = substituteTokens(body.components, args.tokens) as any[];
  } else {
    const variables = (args.templateVersion.variables as Array<{ key: string }>) ?? [];
    const parameters = variables.map((v) => ({ type: "text", text: args.tokens[v.key] ?? "" }));
    components = parameters.length ? [{ type: "body", parameters }] : [];
  }

  return {
    to,
    template_name: templateName,
    language,
    components,
    ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
  };
}

export const wainaWhatsappAdapter = {
  async send(args: SendWhatsappArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const cfg = resolveConfig(args);
    const payload = buildWainaPayload(args, cfg.defaultLanguage);

    try {
      const res = await axios.post(`${cfg.baseUrl}/whatsapp/send`, payload, {
        timeout: 15_000,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          // Best-effort dedup across step retries.
          ...(args.idempotencyKey ? { "X-Idempotency-Key": args.idempotencyKey } : {}),
        },
      });
      const data = (res.data ?? {}) as Record<string, any>;
      if (data.success === false) {
        throw new Error(String(data.error ?? data.message ?? "send rejected"));
      }
      const d = (data.data ?? data) as Record<string, any>;
      const externalId =
        d.wa_message_id ?? d.message_id ?? d.id ?? `aina-${args.idempotencyKey ?? Date.now()}`;
      if (d.status === "failed") {
        throw new Error(`Aina WhatsApp marked the message failed (${externalId})`);
      }
      const status: "sent" | "queued" = d.status === "queued" ? "queued" : "sent";
      return { externalId: String(externalId), status };
    } catch (err: any) {
      const detail = err.response?.data ?? err.message;
      throw new Error(
        `Aina WhatsApp send failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
      );
    }
  },

  /** List templates from the Aina WhatsApp workspace. Pass the tenant's connected
   *  key (opts.apiKey) to fetch THAT firm's templates; falls back to the shared
   *  env key for the background sync. */
  async listTemplates(opts?: { apiKey?: string; baseUrl?: string | null }): Promise<Array<any>> {
    const apiKey = opts?.apiKey ?? process.env.WAINA_API_KEY;
    if (!apiKey) return [];
    const base = toApiBase(opts?.baseUrl ?? process.env.WAINA_BASE_URL ?? process.env.WAINA_WEBHOOK_URL);
    try {
      const res = await axios.get(`${base}/extension/templates`, {
        timeout: 30_000,
        headers: { "x-api-key": apiKey },
      });
      return (res.data?.data ?? []) as any[];
    } catch {
      return [];
    }
  },

  async submitTemplate(): Promise<{ ok: boolean; metaTemplateId?: string; raw: unknown }> {
    throw new Error("Aina WhatsApp adapter: create/submit templates in the Aina WhatsApp console, not via this API");
  },

  verifyWebhookSignature(): boolean {
    // Aina WhatsApp inbound webhooks are configured separately. No shared-secret
    // HMAC is wired on this path yet.
    return false;
  },
};

/* ── Standalone helpers for the Settings UI (live connection + numbers) ──── */

export interface WapiPhoneNumber {
  id: string;
  display_phone_number: string;
  quality_rating?: string;
  is_primary?: boolean;
}

/** GET /extension/phone-numbers — the WABA numbers the key can send from. */
export async function wapiListPhoneNumbers(
  apiKey: string,
  baseUrl?: string | null
): Promise<WapiPhoneNumber[]> {
  const base = toApiBase(baseUrl ?? process.env.WAINA_BASE_URL ?? process.env.WAINA_WEBHOOK_URL);
  const res = await axios.get(`${base}/extension/phone-numbers`, {
    timeout: 15_000,
    headers: { "x-api-key": apiKey },
  });
  return (res.data?.data ?? []) as WapiPhoneNumber[];
}

/** GET /extension/status — verify the key + surface the workspace name + numbers. */
export async function wapiCheckConnection(
  apiKey: string,
  baseUrl?: string | null
): Promise<{ ok: boolean; workspaceName?: string; numbers: WapiPhoneNumber[]; error?: string }> {
  const base = toApiBase(baseUrl ?? process.env.WAINA_BASE_URL ?? process.env.WAINA_WEBHOOK_URL);
  try {
    const res = await axios.get(`${base}/extension/status`, {
      timeout: 15_000,
      headers: { "x-api-key": apiKey },
    });
    const d = (res.data?.data ?? {}) as Record<string, any>;
    return {
      ok: res.data?.success !== false,
      workspaceName: d.workspace_name,
      numbers: (d.phone_numbers ?? []) as WapiPhoneNumber[],
    };
  } catch (e: any) {
    const detail = e.response?.data ?? e.message;
    return { ok: false, numbers: [], error: typeof detail === "string" ? detail : JSON.stringify(detail) };
  }
}

/** Country-code + number, no '+', assume India for bare 10-digit numbers. */
function normalizeWaId(num: string): string {
  let n = (num ?? "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
