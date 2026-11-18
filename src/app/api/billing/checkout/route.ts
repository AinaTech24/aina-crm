/**
 * POST /api/billing/checkout — pay for a package from Billing.
 * Body: { cycle, users, aumCrore? }
 *
 * For a firm that has not paid yet, or a renewal that is due (in grace, or
 * after it with the late charge). The server prices it
 * (lib/billing/checkout.ts) and returns what Razorpay Checkout needs. An
 * active, paid-up firm changes its package from the next renewal instead
 * (POST /api/billing/change). Owner-only (settings.billing).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { CheckoutError, startCheckout } from "@/lib/billing/checkout";

export const dynamic = "force-dynamic";

const Body = z.object({
  cycle: z.enum(["monthly", "half_yearly", "yearly"]),
  users: z.number().int().min(1).max(10000),
  aumCrore: z.number().min(0).max(1_000_000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Choose a package, users and AUM." }, { status: 400 });
    const settings = await loadPricingSettings();
    if (parsed.data.users < settings.minUsers || parsed.data.users > settings.maxUsers) {
      return NextResponse.json({ error: `Users must be from ${settings.minUsers} to ${settings.maxUsers}.` }, { status: 400 });
    }
    try {
      const c = await startCheckout(session.tenantId, parsed.data, settings, session.userId);
      return NextResponse.json({ keyId: c.keyId, subscriptionId: c.subscriptionId, amountPaise: c.amountPaise, description: c.description, kind: c.plan.kind });
    } catch (err) {
      if (err instanceof CheckoutError) return NextResponse.json({ error: err.message, code: err.code ?? null }, { status: err.status });
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
