/**
 * Work that follows a recorded payment, OUTSIDE its transaction: none of it may
 * undo the payment, and each step is retried elsewhere if it fails here.
 *  - cancel the Razorpay subscription the new checkout replaced (so the old
 *    mandate cannot debit again);
 *  - email the tax invoice (lib/billing/invoice-email.ts; failures are retried
 *    by the worker's billing job).
 */

import { cancelRazorpaySubscription } from "./razorpay";
import { deliverInvoiceEmail } from "./invoice-email";
import type { PaymentOutcome } from "./payments";

export async function afterPayment(outcome: PaymentOutcome): Promise<void> {
  if (outcome.status !== "recorded") return;
  if (outcome.previousRazorpaySubscriptionId) {
    try {
      await cancelRazorpaySubscription(outcome.previousRazorpaySubscriptionId, false);
    } catch (err) {
      console.error("[billing] could not cancel the replaced Razorpay subscription:", (err as Error)?.message);
    }
  }
  try {
    await deliverInvoiceEmail(outcome.invoiceId);
  } catch (err) {
    console.error("[billing] invoice email failed (will retry):", (err as Error)?.message);
  }
}
