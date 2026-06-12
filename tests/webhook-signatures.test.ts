/**
 * Webhook signature verification — valid signatures pass, tampered ones fail,
 * and a missing secret fails CLOSED (never open). These guard the three inbound
 * doors (Razorpay billing, Resend email events, Wapi WhatsApp).
 */

import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyRazorpayWebhook } from "@/lib/billing/razorpay";
import { emailAdapter } from "@/lib/comms/adapters/resend";

describe("Razorpay webhook signature", () => {
  const body = JSON.stringify({ event: "subscription.activated", payload: { id: "sub_123" } });

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_secret_rzp";
  });

  it("accepts a correctly-signed payload", () => {
    const sig = crypto.createHmac("sha256", "test_secret_rzp").update(body).digest("hex");
    expect(verifyRazorpayWebhook(body, sig)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const sig = crypto.createHmac("sha256", "test_secret_rzp").update(body).digest("hex");
    expect(verifyRazorpayWebhook(body + "x", sig)).toBe(false);
  });

  it("rejects a signature minted with the wrong secret", () => {
    const sig = crypto.createHmac("sha256", "attacker_secret").update(body).digest("hex");
    expect(verifyRazorpayWebhook(body, sig)).toBe(false);
  });

  it("fails CLOSED when no secret is configured", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const sig = crypto.createHmac("sha256", "anything").update(body).digest("hex");
    expect(verifyRazorpayWebhook(body, sig)).toBe(false);
  });
});

describe("Resend webhook signature", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });

  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = "test_secret_resend";
  });

  function sign(raw: string, secret: string): string {
    return `v1,${crypto.createHmac("sha256", secret).update(raw).digest("base64")}`;
  }

  it("accepts a correctly-signed payload (svix header)", () => {
    expect(
      emailAdapter.verifyWebhookSignature(body, { "svix-signature": sign(body, "test_secret_resend") })
    ).toBe(true);
  });

  it("accepts when one of multiple comma-separated signatures matches", () => {
    const sigs = `${sign(body, "old_rotated_secret")},${sign(body, "test_secret_resend")}`;
    expect(emailAdapter.verifyWebhookSignature(body, { "svix-signature": sigs })).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(
      emailAdapter.verifyWebhookSignature(body + "x", { "svix-signature": sign(body, "test_secret_resend") })
    ).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(emailAdapter.verifyWebhookSignature(body, {})).toBe(false);
  });

  it("fails CLOSED when no secret is configured", () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect(
      emailAdapter.verifyWebhookSignature(body, { "svix-signature": sign(body, "anything") })
    ).toBe(false);
  });
});
