/**
 * Aina Admin → Pricing & billing. Read and save the platform admin's override
 * of the AUM pricing numbers (lib/billing/aum-pricing.ts defaults). DELETE puts
 * the defaults back. Platform-admin only; the save is validated as a whole.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadPricingForAdmin, savePricingOverride } from "@/lib/billing/pricing-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    return NextResponse.json(await loadPricingForAdmin());
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const body = await req.json().catch(() => null);
    const r = await savePricingOverride(body?.override ?? {}, session.userId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await loadPricingForAdmin()) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    await savePricingOverride(null, session.userId);
    return NextResponse.json({ ok: true, ...(await loadPricingForAdmin()) });
  } catch (err) {
    return handleApiError(err);
  }
}
