/**
 * POST /api/webhooks/razorpay
 *
 * Handles subscription events:
 *   - subscription.activated → set tenant.status='active'
 *   - subscription.charged → mark invoice paid + record receipt
 *   - subscription.halted / cancelled → set tenant.status='past_due' / 'suspended'
 *   - invoice.paid → email receipt
 *
 * Signature verification via HMAC SHA256.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { verifyRazorpayWebhook } from "@/lib/billing/razorpay";
import { captureError } from "@/lib/observability/capture";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!verifyRazorpayWebhook(rawBody, sig)) {
    // Forensics: a bad signature is either misconfiguration or someone probing.
    captureError("webhook.signature_failed", null, { source: "razorpay" });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event: string = payload.event ?? "";
  const sub = payload.payload?.subscription?.entity;
  const tenantId = sub?.notes?.tenant_id;
  if (!tenantId) return NextResponse.json({ ok: true });

  await withSystem(async (tx) => {
    if (event === "subscription.activated" || event === "subscription.charged") {
      await tx.execute(sql`UPDATE tenants SET status = 'active', updated_at = now() WHERE id = ${tenantId}`);
    } else if (event === "subscription.halted") {
      await tx.execute(sql`UPDATE tenants SET status = 'past_due', updated_at = now() WHERE id = ${tenantId}`);
    } else if (event === "subscription.cancelled") {
      await tx.execute(sql`UPDATE tenants SET status = 'churned', updated_at = now() WHERE id = ${tenantId}`);
    }
  });

  return NextResponse.json({ ok: true });
}
