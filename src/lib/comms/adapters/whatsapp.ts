/**
 * WhatsApp provider.
 *
 * The platform sends WhatsApp through **Wapi** — the operator's own WhatsApp
 * Business API on https://beckend.ainatech.in (no third-party BSP). The comms
 * pipeline imports `whatsappAdapter` from here so the send path never depends on
 * a concrete adapter module.
 *
 * Credentials are per-tenant (saved in Settings → Integrations under the
 * `waina` provider) with an env fallback (WAINA_API_KEY / WAINA_BASE_URL).
 */

import { wainaWhatsappAdapter } from "./waina";

export type { SendWhatsappArgs } from "./whatsapp-types";

/** The active WhatsApp provider id — imported by the pipeline so the per-tenant
 *  integration row it loads always matches the adapter that will send. */
export const whatsappProviderId = "waina" as const;

export const whatsappAdapter = wainaWhatsappAdapter;
