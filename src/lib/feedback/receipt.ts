/**
 * A receipt for one response to the firm's public feedback link
 * (/feedback/<token>). That link has no per-person token, so the submit
 * endpoint hands back this signed reference; it lets the person who just
 * answered fetch THEIR response as a PDF, and nothing else.
 *
 *   "<tenantId>.<serviceRequestId>.<hmac>"
 *
 * Signed with the app's auth secret. With no secret configured, no receipt is
 * issued and the PDF buttons simply do not appear.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(`feedback-receipt:${payload}`).digest("base64url");
}

export function feedbackReceipt(tenantId: string, serviceRequestId: string): string | null {
  const key = secret();
  if (!key) return null;
  const payload = `${tenantId}.${serviceRequestId}`;
  return `${payload}.${sign(payload, key)}`;
}

export function readFeedbackReceipt(receipt: string): { tenantId: string; serviceRequestId: string } | null {
  const key = secret();
  if (!key) return null;
  const [tenantId, serviceRequestId, sig, ...rest] = String(receipt).split(".");
  if (rest.length || !UUID.test(tenantId ?? "") || !UUID.test(serviceRequestId ?? "") || !sig) return null;
  const want = Buffer.from(sign(`${tenantId}.${serviceRequestId}`, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { tenantId, serviceRequestId };
}
