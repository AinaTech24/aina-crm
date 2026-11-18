/**
 * POST /api/public/pricing/quote — "Get pricing", step 1 → step 2.
 *
 * No session: anyone may ask for a price. The server computes the three
 * packages a NEW firm may buy (the commitment and yearly — `cyclesOffered`;
 * lib/billing/aum-pricing.ts with the admin's numbers) and SAVES the
 * request (pricing_quotes) so the super-admin area can follow it up.
 *
 * Abuse controls, as on the website complaint form:
 *   - 20 quotes per IP per hour (wide on purpose — mobile networks share
 *     addresses) and 5 per email per hour;
 *   - a honeypot field, answered with a fake success so a bot learns nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit, clientIdentifier, enforce } from "@/lib/rate-limit";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { parseQuoteRequest } from "@/lib/billing/quote-request";
import { buildStoredQuote, saveQuote } from "@/lib/billing/quotes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = enforce(req, "pricing.quote", { limit: 20, windowSec: 60 * 60 });
  if (limited) return limited;
  try {
    const settings = await loadPricingSettings();
    const parsed = parseQuoteRequest(await req.json().catch(() => null), settings);
    if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    if (parsed.kind === "trap") {
      // Looks like a success; nothing is stored.
      return NextResponse.json({ ok: true, quoteId: null, token: null, ...buildStoredQuote({ aumCrore: 100, users: 1 }, settings, { firstPurchase: true }), onlineSignup: false });
    }
    const perEmail = checkRateLimit("pricing.quote.email", parsed.value.email, { limit: 5, windowSec: 60 * 60 });
    if (!perEmail.ok) {
      return NextResponse.json({ error: "Too many quotes for this email. Please try again in an hour." }, { status: 429 });
    }
    const stored = buildStoredQuote(parsed.value, settings, { firstPurchase: true });
    const ip = clientIdentifier(req);
    const saved = await withSystem((tx) =>
      saveQuote(tx, parsed.value, stored, { ip, userAgent: req.headers.get("user-agent") })
    );
    return NextResponse.json({ ok: true, quoteId: saved.id, token: saved.token, ...stored, onlineSignup: settings.onlineSignup });
  } catch (err) {
    return handleApiError(err);
  }
}
