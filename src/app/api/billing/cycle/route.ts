/**
 * Let an MFD owner choose their billing cycle — Monthly or Yearly.
 *
 *   POST /api/billing/cycle  { cycle: "monthly" | "yearly" }
 *
 * Saves the preference on the tenant's subscription. When Razorpay auto-debit
 * is wired, this cycle drives the subscription interval (and the per-charge
 * amount: base + seats × per-user + add-ons, monthly vs yearly).
 * Owner-only (settings.billing).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({ cycle: z.enum(["monthly", "yearly"]) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "cycle must be 'monthly' or 'yearly'" }, { status: 400 });
    }
    const { cycle } = parsed.data;

    const updated = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .update(subscriptions)
        .set({ billingCycle: cycle, updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, session.tenantId))
        .returning({ id: subscriptions.id, billingCycle: subscriptions.billingCycle });
      return row ?? null;
    });

    if (!updated) return NextResponse.json({ error: "No active subscription" }, { status: 404 });
    return NextResponse.json({ ok: true, billingCycle: updated.billingCycle });
  } catch (err) {
    return handleApiError(err);
  }
}
