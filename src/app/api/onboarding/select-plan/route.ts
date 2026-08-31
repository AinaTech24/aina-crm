/**
 * POST /api/onboarding/select-plan   Body: { packageId }
 *
 * Called from /onboarding/choose-plan by a brand-new (status='pending') owner.
 * Sets the chosen package on their subscription, then:
 *   - If Razorpay is configured + the package has a price → create the Razorpay
 *     subscription and return checkout params; the webhook flips status→active
 *     on successful payment.
 *   - Otherwise (no payment provider, or a free package) → activate immediately.
 * The client then logs out and is sent to /login (per the onboarding flow).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { subscriptions, packages, subscriptionEvents } from "@/db/schema";
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

const Body = z.object({ packageId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Owner-grade — defense-in-depth alongside the pending-status guard below.
    requireCap(session.roles, "settings.billing", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { packageId } = parse.data;

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1);
      const [pkg] = await tx.select().from(packages).where(eq(packages.id, packageId)).limit(1);
      return { sub, pkg };
    });
    if (!ctx.sub) return NextResponse.json({ error: "No subscription found." }, { status: 404 });
    if (!ctx.pkg || !ctx.pkg.isActive) return NextResponse.json({ error: "That plan isn't available." }, { status: 400 });
    // Onboarding only — once active, plan changes go through normal billing.
    if (ctx.sub.status !== "pending") {
      return NextResponse.json({ error: "Your workspace is already set up.", alreadyActive: true }, { status: 409 });
    }

    // Record the chosen package on the subscription up front (status stays pending
    // until paid / activated).
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(subscriptions)
        .set({ packageId: ctx.pkg!.id, packageKey: ctx.pkg!.key, updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, session.tenantId));
    });

    const activate = async () => {
      await withTenant(session.tenantId, async (tx) => {
        await tx
          .update(subscriptions)
          .set({ status: "active", licenseStartAt: new Date(), updatedAt: new Date() })
          .where(eq(subscriptions.tenantId, session.tenantId));
        await tx.insert(subscriptionEvents).values({
          subscriptionId: ctx.sub!.id,
          tenantId: session.tenantId,
          eventType: "activated",
          actor: "system:onboarding",
          fromStatus: "pending",
          toStatus: "active",
          toPackage: ctx.pkg!.key,
          notes: "Onboarding — plan selected (no charge: payments not configured / free plan).",
        } as any);
      });
    };

    const { amountPaise, seats } = computeAnnualAmountPaise(ctx.pkg as any, ctx.sub as any);

    // A genuinely free plan (₹0) has nothing to pay — activate it.
    if (amountPaise <= 0) {
      await activate();
      return NextResponse.json({ activated: true });
    }

    // PAID plan → payment is MANDATORY. Strictly no dashboard access without it.
    // If no payment provider is configured, there is no way to pay, so we refuse
    // to activate (the owner stays on the choose-plan / payment screen).
    if (!(await razorpayConfigured())) {
      return NextResponse.json(
        {
          error:
            "Online payments aren't enabled yet. Ask your administrator to set up billing (Razorpay) before this plan can be activated.",
        },
        { status: 503 }
      );
    }

    const plan = await createRazorpayPlan({
      amountPaise,
      period: "yearly",
      interval: 1,
      name: `${ctx.pkg.name} — ${seats} user${seats === 1 ? "" : "s"} (yearly)`,
      notes: { tenant_id: session.tenantId, package_key: ctx.pkg.key },
    });
    const subscription = await createRazorpaySubscription({
      planId: plan.id,
      totalCount: 10,
      customerNotify: true,
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
      needsPayment: true,
      razorpaySubscriptionId: subscription.id,
      keyId: await razorpayPublicKeyId(),
      amountPaise,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
