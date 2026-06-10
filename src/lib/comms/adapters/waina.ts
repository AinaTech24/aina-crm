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

/**
 * Normalise ANY configured WAina URL down to the API base `<origin>/api`.
 *
 * The WAina extension/send endpoints always live under `<origin>/api/...`, so we
 * only need the ORIGIN — whatever path was pasted is ignored. This is deliberate:
 * firms routinely paste a webhook/trigger URL (e.g.
 * `…/api/ecommerce-webhook/trigger/<id>`) or a full send URL into the override
 * field; the old logic appended `/extension/templates` to that and 404'd. We now
 * keep the host and rebuild the `/api` base. A deeper `…/api` prefix is preserved
 * for any host that uses one.
 */
function toApiBase(raw?: string | null): string {
  const u = (raw ?? "").trim();
  if (!u) return DEFAULT_BASE_URL;
  try {
    const url = new URL(u);
    const m = url.pathname.match(/^(.*?\/api)(\/|$)/);
    const prefix = m ? m[1] : "/api";
    return `${url.origin}${prefix}`.replace(/\/+$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
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

/**
 * Wapi request: a plain-text send (POST /whatsapp/send, 24h window only) OR a
 * template send (POST /extension/send-message). The template form uses the
 * documented simple shape — `variables` map + optional `header_media_url` /
 * `header_text` — NOT a Meta `components` array (Wapi builds that itself and
 * falls back to the template's saved sample media when no URL is passed).
 */
/** Endpoint + body. We send everything through /extension/send-message (the
 *  "extension" API that only needs `phone_number`): a template send carries
 *  template_name + variables (+ optional header media); a free-form send (24h
 *  window) carries `message`. The old /whatsapp/send needs contact_id +
 *  phone_number_id, which we don't resolve here. */
export type WapiSend = { endpoint: "/extension/send-message"; body: Record<string, unknown> };

/**
 * Pure mapper: SendWhatsappArgs (+ default language) → Wapi request (endpoint + body).
 * Separated from the HTTP call so it can be unit-tested without a network send.
 */
export function buildWainaPayload(args: SendWhatsappArgs, defaultLanguage = "en_US"): WapiSend {
  const body = (args.templateVersion.body ?? {}) as Record<string, any>;
  const to = normalizeWaId(args.recipient);
  const phoneNumberId: string | undefined = body.wainaPhoneNumberId ?? body.phoneNumberId ?? undefined;
  const pn = phoneNumberId ? { phone_number_id: phoneNumberId } : {};

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
    return { endpoint: "/extension/send-message", body: { to, phone_number: to, message, ...pn } };
  }

  const language = body.languageCode ?? body.wainaLanguage ?? defaultLanguage;

  // Body placeholders → variables map ({ "1": "Atul", ... }).
  const vars = (args.templateVersion.variables as Array<{ key: string }>) ?? [];
  const variables: Record<string, string> = {};
  for (const v of vars) variables[v.key] = args.tokens[v.key] ?? "";

  // Optional per-send header overrides (Wapi falls back to the template's saved
  // sample media / header text when these aren't passed).
  const headerMediaRaw = body.headerMediaUrl ?? body.wainaHeaderMediaUrl;
  const headerTextRaw = body.headerText ?? body.wainaHeaderText;
  const header_media_url = headerMediaRaw ? String(substituteTokens(headerMediaRaw, args.tokens)) : undefined;
  const header_text = headerTextRaw ? String(substituteTokens(headerTextRaw, args.tokens)) : undefined;

  return {
    endpoint: "/extension/send-message",
    body: {
      to,
      phone_number: to,
      template_name: templateName,
      language,
      variables,
      ...(header_media_url ? { header_media_url } : {}),
      ...(header_text ? { header_text } : {}),
      ...pn,
    },
  };
}

export const wainaWhatsappAdapter = {
  async send(args: SendWhatsappArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const cfg = resolveConfig(args);
    const { endpoint, body: payload } = buildWainaPayload(args, cfg.defaultLanguage);

    try {
      const res = await axios.post(`${cfg.baseUrl}${endpoint}`, payload, {
        timeout: 15_000,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          // Best-effort dedup across step retries.
          ...(args.idempotencyKey ? { "X-Idempotency-Key": args.idempotencyKey } : {}),
        },
      });
      const data = (res.data ?? {}) as Record<string, any>;
      // Wapi returns HTTP 200 even on errors, with the error in the body.
      if (data.success === false || (typeof data.code === "number" && data.code >= 400)) {
        throw new Error(String(data.msg ?? data.error ?? data.message ?? "send rejected"));
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
   *  env key for the background sync. Errors are swallowed → [] (the background
   *  sync can't surface them); use fetchWainaTemplatesDetailed for diagnostics. */
  async listTemplates(opts?: { apiKey?: string; baseUrl?: string | null }): Promise<Array<any>> {
    return (await fetchWainaTemplatesDetailed(opts)).templates;
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

/**
 * GET /extension/templates — diagnostic variant that SURFACES failures (HTTP
 * status, message, and the exact URL hit) instead of swallowing them to []. The
 * "Fetch from WhatsApp" flow uses this so a wrong key / wrong base-URL shows a
 * real error rather than a misleading "no templates found".
 */
export async function fetchWainaTemplatesDetailed(opts?: {
  apiKey?: string;
  baseUrl?: string | null;
}): Promise<{ ok: boolean; templates: any[]; error?: string; status?: number; url: string }> {
  const apiKey = opts?.apiKey ?? process.env.WAINA_API_KEY;
  const base = toApiBase(opts?.baseUrl ?? process.env.WAINA_BASE_URL ?? process.env.WAINA_WEBHOOK_URL);
  const url = `${base}/extension/templates`;
  if (!apiKey) return { ok: false, templates: [], error: "No API key configured", url };
  try {
    const res = await axios.get(url, { timeout: 30_000, headers: { "x-api-key": apiKey } });
    const body = (res.data ?? {}) as Record<string, any>;
    const arr = body.data ?? body.templates ?? null;
    const bodyCode = typeof body.code === "number" ? body.code : undefined;

    // WAina returns HTTP 200 even for permission/auth failures, with the error in
    // the BODY (e.g. { code: 403, msg: "permission error" }). Detect that so it
    // surfaces as a real error instead of a misleading "0 templates".
    const bodyError = body.msg ?? body.message ?? body.error;
    if (body.success === false || (bodyCode !== undefined && bodyCode >= 400) || (!Array.isArray(arr) && bodyError)) {
      return {
        ok: false,
        templates: [],
        error: String(bodyError ?? `error ${bodyCode ?? ""}`).trim() || "permission/access error",
        status: bodyCode ?? res.status,
        url,
      };
    }
    return { ok: true, templates: Array.isArray(arr) ? arr : [], url };
  } catch (e: any) {
    const status = e.response?.status as number | undefined;
    const d = e.response?.data;
    const detail = d?.msg ?? d?.message ?? d?.error ?? e.message ?? "request failed";
    return { ok: false, templates: [], error: typeof detail === "string" ? detail : JSON.stringify(detail), status, url };
  }
}

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
  const arr = (res.data?.data ?? res.data?.phone_numbers ?? res.data ?? []) as any[];
  return (Array.isArray(arr) ? arr : []).map(normNumber);
}

/** Normalise a WAina phone-number object to our shape, tolerating field variants
 *  (the live API may use `phone_number` / `number` instead of `display_phone_number`). */
function normNumber(x: any): WapiPhoneNumber {
  return {
    id: String(x?.id ?? x?.phone_number_id ?? x?.phoneNumberId ?? ""),
    display_phone_number: String(
      x?.display_phone_number ?? x?.phone_number ?? x?.number ?? x?.phone ?? x?.display ?? x?.msisdn ?? ""
    ),
    quality_rating: x?.quality_rating,
    is_primary: x?.is_primary,
  };
}

/** Pull a workspace display name out of the status payload, tolerating the field
 *  the live API actually uses (the documented `workspace_name` may differ). */
function pickWorkspaceName(d: Record<string, any>, root: Record<string, any>): string | undefined {
  const candidates = [
    d.workspace_name, d.workspaceName, d.name, d.display_name, d.displayName, d.title,
    d.workspace?.name, d.workspace?.workspace_name, d.workspace?.display_name,
    d.account?.name, d.business_name, d.businessName,
    root.workspace_name, root.workspaceName, root.name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

/** GET /extension/status — verify the key + surface the workspace name + numbers. */
export async function wapiCheckConnection(
  apiKey: string,
  baseUrl?: string | null
): Promise<{ ok: boolean; workspaceName?: string; numbers: WapiPhoneNumber[]; error?: string; httpStatus?: number }> {
  const base = toApiBase(baseUrl ?? process.env.WAINA_BASE_URL ?? process.env.WAINA_WEBHOOK_URL);
  try {
    const res = await axios.get(`${base}/extension/status`, {
      timeout: 15_000,
      headers: { "x-api-key": apiKey },
    });
    const root = (res.data ?? {}) as Record<string, any>;
    const d = (root.data ?? root) as Record<string, any>;
    const rawNums = (d.phone_numbers ?? d.phoneNumbers ?? d.numbers ?? root.phone_numbers ?? []) as any[];
    let numbers = rawNums.map(normNumber);
    let workspaceName = pickWorkspaceName(d, root);

    // If status didn't carry a name/numbers, fall back to the phone-numbers
    // endpoint so we can at least identify the workspace by its sender number.
    if ((!numbers || numbers.length === 0) || !workspaceName) {
      try {
        const nums = await wapiListPhoneNumbers(apiKey, baseUrl);
        if ((!numbers || numbers.length === 0) && nums.length) numbers = nums;
        if (!workspaceName && nums[0]?.display_phone_number) {
          workspaceName = `Workspace (${nums[0].display_phone_number})`;
        }
      } catch {
        /* best-effort */
      }
    }

    return {
      ok: root.success !== false,
      workspaceName,
      numbers: numbers ?? [],
      httpStatus: res.status,
    };
  } catch (e: any) {
    const status = e.response?.status as number | undefined;
    const detail = e.response?.data?.message ?? e.response?.data?.error ?? e.response?.data ?? e.message;
    return {
      ok: false,
      numbers: [],
      error: typeof detail === "string" ? detail : JSON.stringify(detail),
      httpStatus: status,
    };
  }
}

/** Country-code + number, no '+', assume India for bare 10-digit numbers. */
function normalizeWaId(num: string): string {
  let n = (num ?? "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
