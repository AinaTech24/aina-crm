/**
 * POST /api/public/pricing/signup — "Get pricing", step 3: create the firm's
 * account for the chosen package, then start the Razorpay checkout.
 *
 * Body: { quoteId, token, cycle, password, state, gstin? }
 *
 * The quote (AUM, users, contact) is loaded by its id AND claim token — never
 * taken from the body — and the price is recomputed here. The account is made
 * by the same code as every other signup (lib/onboarding/create-firm.ts):
 * tenant, owner, branch, seeds, email verification. The owner is signed in;
 * if they leave before paying, Billing offers the same three packages and the
 * license gate keeps the firm to Billing and Support until it pays.
 *
 * Abuse controls: 5 accounts per IP per hour, a claim token per quote, one
 * account per quote and per email.
 */

import { NextRequest, NextResponse } from "next/server";
import { withSystem } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce } from "@/lib/rate-limit";
import { issueSessionToken } from "@/lib/auth/issue-session";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { issueEmailVerification } from "@/lib/auth/email-verification";
import { parseCycle, quoteCycle } from "@/lib/billing/aum-pricing";
import { loadPricingSettings } from "@/lib/billing/pricing-settings";
import { loadQuoteByToken, markQuoteChosen } from "@/lib/billing/quotes";
import { CheckoutError, startCheckout } from "@/lib/billing/checkout";
import { createFirmAccount, emailInUse, FirmCreateError } from "@/lib/onboarding/create-firm";
import { checkGstin, gstState } from "@/lib/legal/gst";

export const dynamic = "force-dynamic";

const bad = (error: string, field?: string, status = 400) => NextResponse.json({ error, field: field ?? null }, { status });

export async function POST(req: NextRequest) {
  const limited = enforce(req, "pricing.signup", { limit: 5, windowSec: 60 * 60 });
  if (limited) return limited;
  try {
    const settings = await loadPricingSettings();
    if (!settings.onlineSignup) return bad("Online sign-up is paused. Please contact Aina.", undefined, 403);

    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const cycle = parseCycle(b.cycle);
    if (!cycle) return bad("Please choose a package.");
    const password = String(b.password ?? "");
    if (password.length < 8 || password.length > 200) return bad("Choose a password of at least 8 characters.", "password");
    const state = gstState(String(b.state ?? ""));
    if (!state) return bad("Please choose your firm's state.", "state");
    let gstin: string | null = null;
    if (String(b.gstin ?? "").trim()) {
      const g = checkGstin(String(b.gstin));
      if (!g.ok) return bad(g.error, "gstin");
      if (g.stateCode !== state.code) return bad(`This GSTIN is registered in ${gstState(g.stateCode)?.name ?? "another state"}, not ${state.name}.`, "gstin");
      gstin = g.gstin;
    }

    const quote = await withSystem((tx) => loadQuoteByToken(tx, String(b.quoteId ?? ""), String(b.token ?? "")));
    if (!quote) return bad("This quote has expired — please get pricing again.", undefined, 404);
    if (quote.convertedTenantId) return bad("An account was already created from this quote. Please sign in.", undefined, 409);
    if (await emailInUse(quote.email)) {
      return bad("An account with this email already exists — please sign in, then use Billing.", "email", 409);
    }
    // Recomputed here: the price is never taken from the browser.
    const priced = quoteCycle({ aumCrore: quote.aumCrore, users: quote.users, cycle }, settings);

    let firm;
    try {
      firm = await createFirmAccount({
        firmName: quote.firmName,
        arn: quote.arn,
        ownerName: quote.contactName,
        ownerEmail: quote.email,
        password,
        mobile: quote.mobile,
        state: state.name,
        gstin,
        pricing: { quoteId: quote.id, aumCrore: quote.aumCrore, users: quote.users, cycle, quote: priced, packageKey: settings.packageKey },
      });
    } catch (err) {
      if (err instanceof FirmCreateError) {
        if (err.code === "arn_taken") return bad("This ARN already has an account. Please sign in.", "arn", 409);
        if (err.code === "email_taken") return bad("An account with this email already exists — please sign in.", "email", 409);
        return bad("Sign-ups are temporarily unavailable. Please contact Aina.", undefined, 503);
      }
      throw err;
    }
    await withSystem((tx) => markQuoteChosen(tx, quote.id, cycle, firm.tenantId));

    try {
      await issueEmailVerification({ userId: firm.userId, tenantId: firm.tenantId, email: quote.email, name: quote.contactName, firmName: quote.firmName });
    } catch (err) {
      console.error("[pricing-signup] email verification failed:", err);
    }
    const token = await issueSessionToken({
      userId: firm.userId,
      tenantId: firm.tenantId,
      branchId: firm.branchId,
      roles: ["owner", "rm", "compliance"],
      email: quote.email,
      name: quote.contactName,
    });

    let body: Record<string, unknown>;
    try {
      const c = await startCheckout(firm.tenantId, { cycle, users: quote.users, aumCrore: quote.aumCrore }, settings, firm.userId);
      body = { ok: true, checkout: { keyId: c.keyId, subscriptionId: c.subscriptionId, amountPaise: c.amountPaise, description: c.description }, next: "/onboarding/setup" };
    } catch (err) {
      if (err instanceof CheckoutError && err.code === "payments_off") {
        body = { ok: true, paymentsOff: true, next: "/dashboard/billing" };
      } else {
        console.error("[pricing-signup] checkout could not start:", err);
        body = { ok: true, next: "/dashboard/billing" };
      }
    }
    const res = NextResponse.json(body);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
