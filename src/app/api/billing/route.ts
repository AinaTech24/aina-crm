/**
 * GET /api/billing — JSON feed for the mobile Billing screen.
 *
 * Mirrors the web /dashboard/billing RSC (read-only half): current subscription
 * + package, usage against limits (getBillingUsage — the same helper the page
 * uses), recent subscription events, and a trial/expiry countdown. Auto-pay
 * setup stays web-only.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { subscriptions, packages, subscriptionEvents } from "@/db/schema";
import { getBillingUsage } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();

    const { sub, pkg, events, usage } = await withTenant(
      session.tenantId,
      async (tx) => {
        const s = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1))[0] ?? null;
        const p = s ? (await tx.select().from(packages).where(eq(packages.id, s.packageId)).limit(1))[0] ?? null : null;
        const ev = s
          ? await tx
              .select()
              .from(subscriptionEvents)
              .where(eq(subscriptionEvents.tenantId, session.tenantId))
              .orderBy(desc(subscriptionEvents.at))
              .limit(20)
          : [];
        const u = p
          ? await getBillingUsage(tx, session.tenantId, {
              seatLimit: s?.seatsOverride ?? p.maxUsers,
              investorLimit: p.maxInvestors,
              storageGb: p.storageLimitGb,
              messageCap: Number((p.featureFlags as any)?.maxMessagesPerMonth ?? 0),
            })
          : null;
        return { sub: s, pkg: p, events: ev, usage: u };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const endDate = sub?.licenseEndAt ? new Date(sub.licenseEndAt) : null;
    const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000) : null;

    return NextResponse.json({
      subscription: sub
        ? {
            status: sub.status,
            billingCycle: sub.billingCycle,
            licenseStartAt: sub.licenseStartAt,
            licenseEndAt: sub.licenseEndAt,
            trialEndsAt: sub.trialEndsAt,
            nextRenewalAt: sub.nextRenewalAt,
            mandateStatus: sub.mandateStatus,
            failedPaymentCount: sub.failedPaymentCount,
            lastPaymentAt: sub.lastPaymentAt,
            lastPaymentPaise: sub.lastPaymentPaise,
          }
        : null,
      package: pkg
        ? {
            key: pkg.key,
            name: pkg.name,
            description: pkg.description,
            maxUsers: pkg.maxUsers,
            maxInvestors: pkg.maxInvestors,
            storageLimitGb: pkg.storageLimitGb,
            enabledModules: pkg.enabledModules,
          }
        : null,
      usage,
      events: (events as any[]).map((e) => ({
        id: e.id,
        eventType: e.eventType,
        toStatus: e.toStatus ?? null,
        amountPaise: e.amountPaise ?? null,
        notes: e.notes ?? null,
        at: e.at,
      })),
      computed: { daysLeft, isTrial: sub?.status === "trial" },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
