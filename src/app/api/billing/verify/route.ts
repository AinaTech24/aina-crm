/**
 * POST /api/billing/verify — Razorpay Checkout came back with a payment.
 * Body: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
 *
 * The signature (HMAC of "payment_id|subscription_id" with the API secret) is
 * checked first; then the payment is recorded against the checkout THIS SERVER
 * started for the caller's firm (lib/billing/payments.ts) — idempotent per
 * payment id, so a second call, or the webhook arriving first, changes nothing.
 * Owner-only (settings.billing).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { verifySubscriptionPayment } from "@/lib/billing/razorpay";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { recordCheckoutPayment } from "@/lib/billing/payments";
import { afterPayment } from "@/lib/billing/after-payment";

export const dynamic = "force-dynamic";

const Body = z.object({
  razorpay_payment_id: z.string().min(4).max(80),
  razorpay_subscription_id: z.string().min(4).max(80),
  razorpay_signature: z.string().min(16).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Missing payment details." }, { status: 400 });
    const p = parsed.data;

    const genuine = await verifySubscriptionPayment({
      razorpayPaymentId: p.razorpay_payment_id,
      razorpaySubscriptionId: p.razorpay_subscription_id,
      razorpaySignature: p.razorpay_signature,
    });
    if (!genuine) return NextResponse.json({ error: "The payment could not be verified." }, { status: 400 });

    const settings = await loadPricingSettings();
    const outcome = await withSystem(async (tx) => {
      // The checkout must be THIS firm's.
      const own = await tx.execute(sql`
        SELECT 1 FROM subscriptions
         WHERE tenant_id = ${session.tenantId}::uuid
           AND (razorpay_subscription_id = ${p.razorpay_subscription_id}
                OR pending_checkout->>'razorpaySubscriptionId' = ${p.razorpay_subscription_id})
      `);
      if (own.rows.length === 0) return { status: "unknown" as const };
      return recordCheckoutPayment(tx, {
        razorpaySubscriptionId: p.razorpay_subscription_id,
        paymentId: p.razorpay_payment_id,
        source: "checkout",
        settings,
        actorUserId: session.userId,
      });
    });
    if (outcome.status === "unknown") {
      return NextResponse.json({ error: "This payment does not match a checkout for your firm." }, { status: 404 });
    }
    await afterPayment(outcome);

    const t = await withSystem(async (tx) =>
      (await tx.execute(sql`SELECT onboarding_required, onboarded_at FROM tenants WHERE id = ${session.tenantId}::uuid`)).rows[0] as
        | { onboarding_required: boolean; onboarded_at: string | null }
        | undefined
    );
    const next = t?.onboarding_required && !t.onboarded_at ? "/onboarding/setup" : "/dashboard/billing?paid=1";
    return NextResponse.json({ ok: true, duplicate: outcome.status === "duplicate", next });
  } catch (err) {
    return handleApiError(err);
  }
}
