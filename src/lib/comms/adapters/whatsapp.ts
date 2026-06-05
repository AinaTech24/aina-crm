/**
 * WhatsApp provider selector.
 *
 * The comms pipeline imports `whatsappAdapter` from here (not from a concrete
 * adapter) so the operator can switch BSPs with no call-site changes. Both
 * adapters expose the same `send(args)` contract.
 *
 *   WHATSAPP_PROVIDER=aisensy → AiSensy v2 API
 *   WHATSAPP_PROVIDER=waina   → Aina WhatsApp (Wapi) sender (beckend.ainatech.in)
 *
 * If WHATSAPP_PROVIDER isn't set, we auto-detect: presence of WAINA_API_KEY
 * selects Aina WhatsApp, otherwise we fall back to AiSensy. So setting the Aina
 * key is enough to switch — no extra flag needed.
 *
 * Provider-specific surfaces (AiSensy template sync, AiSensy inbound webhook)
 * still import the AiSensy adapter directly — those are not part of the send
 * path and don't apply when Aina WhatsApp is active.
 */

import { whatsappAdapter as aisensyWhatsappAdapter } from "./aisensy";
import { wainaWhatsappAdapter } from "./waina";

export type { SendWhatsappArgs } from "./aisensy";

function resolveProvider(): "waina" | "aisensy" {
  const explicit = (process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "waina" || explicit === "aisensy") return explicit;
  return process.env.WAINA_API_KEY ? "waina" : "aisensy";
}

/** The active WhatsApp provider id — imported by the pipeline so the per-tenant
 *  integration row it loads always matches the adapter that will send. */
export const whatsappProviderId = resolveProvider();

export const whatsappAdapter =
  whatsappProviderId === "waina" ? wainaWhatsappAdapter : aisensyWhatsappAdapter;
