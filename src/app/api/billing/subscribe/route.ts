/**
 * Start a Razorpay recurring subscription (yearly auto-debit) for the MFD's firm.
 *
 *   POST /api/billing/subscribe
 *
 * Owner-only. Computes the firm's annual amount from its package
 * (base yearly + seats × per-user yearly), creates a Razorpay Plan + Subscription
 * (yearly), and returns { subscriptionId, keyId } so the browser can open
 * Razorpay Checkout to authorize the e-mandate (UPI Autopay / card / netbanking).
 *
 * Trial firms: the mandate is authorized now, but the first debit is deferred to
 * the trial-end date (start_at) — so it auto-charges when the trial ends.
 *
 * Razorpay then drives the lifecycle via /api/webhooks/razorpay.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { subscriptions, packages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import {
  razorpayConfigured,
  razorpayPublicKeyId,
  createRazorpayPlan,
  createRazorpaySubscription,
  computeAnnualAmountPaise,
} from "@/lib/billing/razorpay";

export const dynamic = "force-dynamic";

/** Yearly billing cycles to authorize the mandate for (Razorpay max 100). */
const YEARLY_TOTAL_COUNT = 10;

export async function POST(_req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);

    if (!(await razorpayConfigured())) {
      return NextResponse.json(
        { error: "Online payments are not configured yet. Please contact AINA." },
        { status: 503 }
      );
    }

    // Load the firm's subscription + its package (catalog is world-readable).
    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1);
      if (!sub) return null;
      const [pkg] = await tx.select().from(packages).where(eq(packages.id, sub.packageId)).limit(1);
      return { sub, pkg };
    });
    if (!ctx?.sub) return NextResponse.json({ error: "No subscription to bill" }, { status: 404 });
    if (!ctx.pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

    const { amountPaise, seats } = computeAnnualAmountPaise(ctx.pkg as any, ctx.sub as any);
    if (amountPaise <= 0) {
      return NextResponse.json({ error: "This package has no recurring price set." }, { status: 400 });
    }

    // Defer first charge to trial end so the trial auto-converts (mandate now,
    // debit at trial end). 60s buffer keeps start_at safely in the future.
    const trialEnd = ctx.sub.trialEndsAt ? new Date(ctx.sub.trialEndsAt).getTime() : 0;
    const startAtUnix = trialEnd > Date.now() + 60_000 ? Math.floor(trialEnd / 1000) : undefined;

    const plan = await createRazorpayPlan({
      amountPaise,
      period: "yearly",
      interval: 1,
      name: `${ctx.pkg.name} — ${seats} user${seats === 1 ? "" : "s"} (yearly)`,
      notes: { tenant_id: session.tenantId, package_key: ctx.pkg.key },
    });

    const subscription = await createRazorpaySubscription({
      planId: plan.id,
      totalCount: YEARLY_TOTAL_COUNT,
      customerNotify: true,
      startAtUnix,
      notes: { tenant_id: session.tenantId, package_key: ctx.pkg.key },
    });

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          razorpaySubscriptionId: subscription.id,
          razorpayPlanId: plan.id,
          mandateStatus: "pending",
          billingCycle: "yearly",
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.tenantId, session.tenantId));
    });

    return NextResponse.json({
      subscriptionId: subscription.id,
      keyId: await razorpayPublicKeyId(),
      amountPaise,
      seats,
      shortUrl: subscription.short_url ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
