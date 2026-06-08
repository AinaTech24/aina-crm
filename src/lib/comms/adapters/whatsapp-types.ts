/**
 * Shared WhatsApp adapter contract. The comms pipeline builds a `SendWhatsappArgs`
 * and the active provider adapter (Wapi / Aina WhatsApp) turns it into a send.
 * Kept provider-neutral so the pipeline never imports a concrete adapter.
 */
import type { TemplateVersion } from "@/db/schema";

export interface SendWhatsappArgs {
  tenantId: string;
  templateVersion: TemplateVersion;
  tokens: Record<string, string>;
  recipient: string; // E.164 number — "+91XXXXXXXXXX"
  apiKey?: string;
  /** Per-tenant send endpoint / base-URL override (defaults to env / platform URL). */
  webhookUrl?: string;
  /** Per-tenant default WhatsApp language code, e.g. "en_US". */
  defaultLanguage?: string;
  /** Stable across step retries; sent as a best-effort dedup header. */
  idempotencyKey?: string;
}
