/**
 * POST /api/public/pricing/mobile-code — text a 6-digit code to the quote's
 * mobile (lib/onboarding/mobile-otp.ts). Body: { quoteId, token }.
 *
 * Answers `skipped` whenever SMS is not configured or fails, and the page then
 * carries on without the step — a sign-up is never blocked by it. A quote that
 * already became a firm has nothing left to verify.
 *
 * Abuse controls: 10 per IP per hour, the quote's claim token, and the quote's
 * own limits (60 s between codes, 5 codes per quote).
 */

import { NextRequest, NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce } from "@/lib/rate-limit";
import { loadQuoteByToken } from "@/lib/billing/quotes";
import { sendMobileOtp } from "@/lib/onboarding/mobile-otp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = enforce(req, "pricing.mobile_code", { limit: 10, windowSec: 60 * 60 });
  if (limited) return limited;
  try {
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const r = await withSystem(async (tx) => {
      const quote = await loadQuoteByToken(tx, String(b.quoteId ?? ""), String(b.token ?? ""));
      if (!quote) return null;
      if (quote.convertedTenantId) return { status: "skipped" as const };
      return sendMobileOtp(tx, quote.id);
    });
    if (!r) return NextResponse.json({ error: "This quote has expired — please get pricing again." }, { status: 404 });
    if (r.status === "wait") {
      return NextResponse.json({ status: "wait", waitSec: r.waitSec, error: `Please wait ${r.waitSec} seconds before asking for another code.` }, { status: 429 });
    }
    if (r.status === "too_many") {
      return NextResponse.json({ status: "too_many", error: "Too many codes for this mobile. You can carry on without verifying it." }, { status: 429 });
    }
    return NextResponse.json(r);
  } catch (err) {
    return handleApiError(err);
  }
}
