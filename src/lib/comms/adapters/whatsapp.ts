/**
 * WhatsApp provider selector.
 *
 * The comms pipeline imports `whatsappAdapter` from here (not from a concrete
 * adapter) so the operator can switch BSPs with a single env var — no call-site
 * changes. Both adapters expose the same `send(args)` contract.
 *
 *   WHATSAPP_PROVIDER=aisensy   (default) → AiSensy v2 API
 *   WHATSAPP_PROVIDER=waina               → own WAina sender (ainatech.in)
 *
 * Provider-specific surfaces (AiSensy template sync, AiSensy inbound webhook)
 * still import the AiSensy adapter directly — those are not part of the send
 * path and don't apply when WAina is active.
 */

import { whatsappAdapter as aisensyWhatsappAdapter } from "./aisensy";
import { wainaWhatsappAdapter } from "./waina";

export type { SendWhatsappArgs } from "./aisensy";

const provider = (process.env.WHATSAPP_PROVIDER ?? "aisensy").trim().toLowerCase();

export const whatsappAdapter =
  provider === "waina" ? wainaWhatsappAdapter : aisensyWhatsappAdapter;
