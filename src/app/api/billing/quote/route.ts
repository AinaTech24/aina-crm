/**
 * GET /api/billing/quote?aumCrore=&users= — the three packages for a signed-in
 * firm's re-quote on Billing, priced on the server with the admin's numbers.
 * Read-only; what is charged is recomputed again at checkout.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { buildStoredQuote } from "@/lib/billing/quotes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const s = await loadPricingSettings();
    const aum = Number(req.nextUrl.searchParams.get("aumCrore"));
    const users = Number(req.nextUrl.searchParams.get("users"));
    if (!Number.isFinite(aum) || aum < 0 || aum > 1_000_000) return NextResponse.json({ error: "Enter your AUM in ₹ crore." }, { status: 400 });
    if (!Number.isInteger(users) || users < s.minUsers || users > s.maxUsers) {
      return NextResponse.json({ error: `Users must be from ${s.minUsers} to ${s.maxUsers}.` }, { status: 400 });
    }
    return NextResponse.json(buildStoredQuote({ aumCrore: Math.round(aum * 100) / 100, users }, s));
  } catch (err) {
    return handleApiError(err);
  }
}
