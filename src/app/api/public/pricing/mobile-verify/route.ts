/**
 * POST /api/public/pricing/mobile-verify — check the code texted by
 * /mobile-code. Body: { quoteId, token, code }. A right code stamps
 * pricing_quotes.mobile_verified_at (copied onto the owner when the account is
 * created); a wrong one costs one of its 5 tries.
 *
 * Abuse controls: 30 per IP per hour, the quote's claim token, 5 tries a code.
 */

import { NextRequest, NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce } from "@/lib/rate-limit";
import { loadQuoteByToken } from "@/lib/billing/quotes";
import { verifyMobileOtp } from "@/lib/onboarding/mobile-otp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = enforce(req, "pricing.mobile_verify", { limit: 30, windowSec: 60 * 60 });
  if (limited) return limited;
  try {
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const code = String(b.code ?? "").trim();
    const r = await withSystem(async (tx) => {
      const quote = await loadQuoteByToken(tx, String(b.quoteId ?? ""), String(b.token ?? ""));
      if (!quote) return null;
      return verifyMobileOtp(tx, quote.id, code);
    });
    if (!r) return NextResponse.json({ error: "This quote has expired — please get pricing again." }, { status: 404 });
    if (!r.ok) return NextResponse.json({ error: r.message, field: "mobileCode", reason: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    return handleApiError(err);
  }
}
