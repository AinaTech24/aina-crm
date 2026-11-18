/**
 * The billing jobs the worker runs (src/workers/index.ts, `ops` group):
 *  - daily: the renewal review — re-price each renewal from the CRM's AUM
 *    7 days before it (lib/billing/renewal-review.ts);
 *  - hourly: retry the emails that did not go — tax invoices and onboarding
 *    welcome emails. Neither ever blocks a payment or an onboarding.
 */
import { runRenewalReviews } from "./renewal-review";
import { retryInvoiceEmails } from "./invoice-email";
import { retryWelcomeEmails } from "@/lib/onboarding/welcome";

export async function runBillingDaily(now = new Date()) {
  return runRenewalReviews(now);
}

export async function runBillingEmailRetries() {
  const invoices = await retryInvoiceEmails();
  const welcome = await retryWelcomeEmails();
  return { invoices, welcome };
}
