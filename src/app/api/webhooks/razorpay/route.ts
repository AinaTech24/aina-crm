/**
 * POST /api/webhooks/razorpay
 *
 * Drives the firm's recurring-billing lifecycle. The authoritative state is the
 * `subscriptions` row (loadTenantLicense reads subscriptions.status for gating),
 * so this updates THAT (not just tenants.status), plus an append-only
 * subscription_events audit log.
 *
 *   subscription.authenticated → mandate is set up (mandate_status = active)
 *   subscription.activated     → status = active
 *   subscription.charged       → active + record payment + advance renewal,
 *                                reset the failed-payment counter
 *   subscription.pending       → past_due (a debit failed; Razorpay is retrying)
 *   subscription.halted        → suspended (retries exhausted — access restricted)
 *   subscription.cancelled     → cancelled
 *   subscription.completed     → expired (all cycles billed)
 *   payment.failed             → bump the dunning counter (suspension itself is
 *                                driven by subscription.halted, so redelivery
 *                                can't wrongly suspend a firm)
 *
 * Signature verified via HMAC SHA256 over the raw body. Resolves the firm by the
 * stored razorpay_subscription_id, falling back to notes.tenant_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { subscriptions, subscriptionEvents } from "@/db/schema";
import { verifyRazorpayWebhook } from "@/lib/billing/razorpay";
import { captureError } from "@/lib/observability/capture";

export const dynamic = "force-dynamic";

const toDate = (unix?: number | null) => (unix ? new Date(unix * 1000) : null);

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!(await verifyRazorpayWebhook(rawBody, sig))) {
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
  const subEntity = payload.payload?.subscription?.entity;
  const payEntity = payload.payload?.payment?.entity;
  const rzpSubId: string | undefined = subEntity?.id ?? payEntity?.subscription_id;
  const tenantId: string | undefined = subEntity?.notes?.tenant_id ?? payEntity?.notes?.tenant_id;
  // Razorpay delivers at-least-once; the SAME event redelivered carries the same
  // x-razorpay-event-id. We dedup on it so a redelivered payment.failed can't
  // double-bump the dunning counter and a redelivered charge can't write a
  // duplicate payment row into the subscription_events audit.
  const eventId = req.headers.get("x-razorpay-event-id");

  if (!rzpSubId && !tenantId) return NextResponse.json({ ok: true });

  try {
    await withSystem(async (tx) => {
      // Idempotency guard — insert the event id in the SAME tx as processing, so
      // a duplicate is skipped while a processing failure (rollback) still retries.
      if (eventId) {
        const seen = await tx.execute(sql`
          INSERT INTO webhook_events (provider, event_id) VALUES ('razorpay', ${eventId})
          ON CONFLICT (provider, event_id) DO NOTHING
          RETURNING id
        `);
        if (seen.rows.length === 0) return; // already processed — ack + skip
      }
      // Resolve OUR subscription row by the Razorpay subscription id, else tenant.
      const rows = rzpSubId
        ? await tx.select().from(subscriptions).where(eq(subscriptions.razorpaySubscriptionId, rzpSubId)).limit(1)
        : await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId!)).limit(1);
      const sub = rows[0];
      if (!sub) return;

      const set: Record<string, unknown> = { updatedAt: new Date() };
      let logType: string | null = null;
      let amountPaise: number | null = null;

      switch (event) {
        case "subscription.authenticated":
          set.mandateStatus = "active";
          set.razorpaySubscriptionId = rzpSubId ?? sub.razorpaySubscriptionId;
          logType = "created";
          break;
        case "subscription.activated":
          set.status = "active";
          set.mandateStatus = "active";
          logType = "activated";
          break;
        case "subscription.charged": {
          amountPaise = Number(payEntity?.amount ?? 0) || null;
          set.status = "active";
          set.mandateStatus = "active";
          set.failedPaymentCount = 0;
          if (amountPaise) {
            set.lastPaymentAt = new Date();
            set.lastPaymentPaise = amountPaise;
          }
          if (subEntity?.charge_at) set.nextRenewalAt = toDate(subEntity.charge_at);
          if (subEntity?.current_end) set.licenseEndAt = toDate(subEntity.current_end);
          set.licenseStartAt = sub.licenseStartAt ?? new Date();
          logType = "payment_received";
          break;
        }
        case "subscription.pending":
          set.status = "past_due";
          logType = "payment_failed";
          break;
        case "subscription.halted":
          set.status = "suspended";
          set.suspendedAt = new Date();
          set.suspendedReason = "Auto-debit failed after retries";
          logType = "suspended";
          break;
        case "subscription.cancelled":
          set.status = "cancelled";
          set.cancelledAt = new Date();
          logType = "cancelled";
          break;
        case "subscription.completed":
          set.status = "expired";
          logType = "expired";
          break;
        case "payment.failed":
          set.failedPaymentCount = sql`${subscriptions.failedPaymentCount} + 1`;
          logType = "payment_failed";
          break;
        default:
          return; // unhandled event — ack and ignore
      }

      await tx.update(subscriptions).set(set as any).where(eq(subscriptions.id, sub.id));

      if (logType) {
        await tx.insert(subscriptionEvents).values({
          subscriptionId: sub.id,
          tenantId: sub.tenantId,
          eventType: logType as any,
          actor: "razorpay_webhook",
          toStatus: (set.status as string) ?? null,
          amountPaise,
          notes: event,
          meta: { event, razorpaySubscriptionId: rzpSubId ?? null },
        });
      }
    });
  } catch (err) {
    captureError("webhook.razorpay_failed", err, { event });
    // 500 → Razorpay retries the webhook later.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
