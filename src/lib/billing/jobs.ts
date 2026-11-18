/**
 * The billing jobs the worker runs (src/workers/index.ts, `ops` group):
 *  - daily: the renewal review — re-price each renewal from the CRM's AUM
 *    7 days before it (lib/billing/renewal-review.ts);
 *  - hourly: retry the emails that did not go — tax invoices and onboarding
 *    welcome emails — and follow up quotes that never became a firm
 *    (lib/onboarding/quote-followup.ts). None of them ever blocks a payment
 *    or an onboarding, and each runs even when another fails;
 *  - daily: nudge firms that paid 3+ days ago and have no clients yet
 *    (lib/onboarding/stalled.ts).
 */
import { runRenewalReviews } from "./renewal-review";
import { retryInvoiceEmails } from "./invoice-email";
import { retryWelcomeEmails } from "@/lib/onboarding/welcome";
import { runQuoteFollowups } from "@/lib/onboarding/quote-followup";
import { runStalledNudges } from "@/lib/onboarding/stalled";

export async function runBillingDaily(now = new Date()) {
  return runRenewalReviews(now);
}

const settle = async <T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> => {
  try {
    return await fn();
  } catch (err) {
    console.error(`[billing-hourly] ${label} failed:`, (err as Error)?.message);
    return { error: (err as Error)?.message ?? "failed" };
  }
};

export async function runBillingEmailRetries() {
  const invoices = await settle("invoice emails", () => retryInvoiceEmails());
  const welcome = await settle("welcome emails", () => retryWelcomeEmails());
  const quoteFollowups = await settle("quote follow-ups", () => runQuoteFollowups());
  return { invoices, welcome, quoteFollowups };
}

export async function runOnboardingNudges(now = new Date()) {
  return runStalledNudges(now);
}
