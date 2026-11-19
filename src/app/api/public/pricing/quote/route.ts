/**
 * POST /api/public/pricing/quote — "Get pricing", step 1 → step 2.
 * GET  /api/public/pricing/quote?quote=<id>&t=<token> — reopen a saved quote.
 *
 * No session: anyone may ask for a price. The server computes the three
 * packages a NEW firm may buy (the commitment and yearly — `cyclesOffered`;
 * lib/billing/aum-pricing.ts with the admin's numbers) and SAVES the
 * request (pricing_quotes) so the super-admin area can follow it up.
 *
 * An email that already signs in somewhere is caught here, at step 1, with the
 * same check (and the same words) the account step uses — it reveals nothing
 * sign-up does not already say, and only after the per-email rate limit.
 *
 * Reopening (the follow-up email's link, or a refresh of /pricing) needs the
 * quote's claim or resume token, and RE-PRICES from the saved AUM and users
 * with today's settings (`resumeQuote`). A quote that already became a firm
 * answers `converted`, so the page can point to sign-in.
 *
 * Abuse controls, as on the website complaint form:
 *   - 20 quotes per IP per hour (wide on purpose — mobile networks share
 *     addresses) and 5 per email per hour; 60 reopenings per IP per hour;
 *   - a honeypot field, answered with a fake success so a bot learns nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit, clientIdentifier, enforce } from "@/lib/rate-limit";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { parseQuoteRequest } from "@/lib/billing/quote-request";
import { buildStoredQuote, loadQuoteByToken, resumeQuote, saveQuote } from "@/lib/billing/quotes";
import { emailInUse } from "@/lib/onboarding/create-firm";
import { EMAIL_TAKEN_MESSAGE } from "@/lib/onboarding/messages";

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
    if (await emailInUse(parsed.value.email)) {
      return NextResponse.json({ error: EMAIL_TAKEN_MESSAGE, field: "email", code: "email_taken", signIn: "/login" }, { status: 409 });
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

export async function GET(req: NextRequest) {
  const limited = enforce(req, "pricing.quote.resume", { limit: 60, windowSec: 60 * 60 });
  if (limited) return limited;
  try {
    const id = req.nextUrl.searchParams.get("quote") ?? "";
    const token = req.nextUrl.searchParams.get("t") ?? "";
    const quote = await withSystem((tx) => loadQuoteByToken(tx, id, token));
    if (!quote) {
      return NextResponse.json({ error: "This link has expired or is not complete. Please get pricing again." }, { status: 404 });
    }
    const settings = await loadPricingSettings();
    const r = resumeQuote(quote, token, settings);
    if (r.kind === "converted") {
      return NextResponse.json({ converted: true, error: "An account was already created from this quote. Please sign in.", signIn: "/login" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return handleApiError(err);
  }
}
