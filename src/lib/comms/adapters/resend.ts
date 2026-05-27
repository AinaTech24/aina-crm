/**
 * Resend email adapter.
 *
 * Resend has a clean REST API + idempotency keys + webhook for delivery
 * events. For each tenant we use the same Resend API key initially but
 * route through tenant-specific verified domains.
 *
 * Migration path: when we exceed ~1M emails/month or need dedicated IPs
 * for marketing, swap to AWS SES via the same interface — the rest of the
 * codebase will not change.
 */

import { Resend } from "resend";
import { renderEmailTemplate } from "../email_renderer";
import type { TemplateVersion } from "@/db/schema";

let client: Resend | null = null;
function getClient(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not set");
    client = new Resend(key);
  }
  return client;
}

export interface SendEmailArgs {
  tenantId: string;
  templateVersion: TemplateVersion;
  tokens: Record<string, string>;
  rendered: { subject?: string; text: string; tokens: Record<string, string> };
  recipient: string;
  category: "transactional" | "marketing";
  cc?: string[];
  bcc?: string[];
}

export const emailAdapter = {
  async send(args: SendEmailArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const from =
      args.category === "marketing"
        ? process.env.EMAIL_FROM_MARKETING ?? "no-reply@example.com"
        : process.env.EMAIL_FROM_TRANSACTIONAL ?? "no-reply@example.com";

    const html = renderEmailTemplate(args.templateVersion.body as any, args.tokens);

    const c = getClient();
    const res = await c.emails.send({
      from,
      to: [args.recipient],
      cc: args.cc?.length ? args.cc : undefined,
      bcc: args.bcc?.length ? args.bcc : undefined,
      subject: args.rendered.subject ?? "(no subject)",
      html,
      text: args.rendered.text,
      tags: [
        { name: "tenant_id", value: args.tenantId },
        { name: "template_key", value: args.templateVersion.id },
      ],
    });
    if (res.error) {
      throw new Error(`Resend error: ${res.error.message}`);
    }
    return { externalId: res.data?.id ?? "", status: "sent" };
  },

  /** Verify Resend webhook (uses Svix-style headers). */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return false;
    const signature = headers["svix-signature"] ?? headers["resend-signature"];
    if (!signature) return false;
    const crypto = require("crypto") as typeof import("crypto");
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    // Resend uses comma-separated multiple signatures; check any match
    return signature.split(",").some((s) => safeEqual(s.trim(), `v1,${expected}`) || safeEqual(s.trim(), expected));
  },
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
