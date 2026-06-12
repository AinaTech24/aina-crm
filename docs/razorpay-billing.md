# Razorpay recurring billing (auto-debit)

MFD firms pay their AINA subscription by **yearly e-mandate auto-debit** (UPI
Autopay / card / netbanking). The firm authorizes a mandate once; Razorpay then
debits automatically each year and notifies us by webhook.

## Flow

```
Owner → /dashboard/billing → "Set up auto-pay"
  └─ POST /api/billing/subscribe
       ├─ computeAnnualAmountPaise(pkg, sub)  = base yearly + seats × per-user yearly
       ├─ createRazorpayPlan({ period: yearly, amount })
       └─ createRazorpaySubscription({ planId, total_count, start_at?, notes.tenant_id })
            (start_at = trial-end → first debit defers to trial end = auto-convert)
  └─ Razorpay Checkout opens (subscription_id) → owner authorizes the mandate
       │
       ▼
  Razorpay → POST /api/webhooks/razorpay  (HMAC-verified)
       subscription.authenticated → mandate_status = active
       subscription.activated     → subscriptions.status = active
       subscription.charged       → active + record payment + advance renewal,
                                     reset failed_payment_count
       subscription.pending       → past_due (retrying)
       subscription.halted        → suspended (retries exhausted)
       subscription.cancelled     → cancelled
       payment.failed             → failed_payment_count++  (dunning)
```

`subscriptions.status` is the source of truth for gating (`loadTenantLicense`).

## Environment variables (`.env.production` — gitignored, never committed)

```
RAZORPAY_MODE=test            # informational; test vs live is chosen by the key prefix
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx          # secret — server only
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx      # the secret you set when creating the webhook
```

Test and live both call `https://api.razorpay.com`; the key **prefix**
(`rzp_test_` vs `rzp_live_`) selects the environment. The app calls the real API
whenever the keys are present; with no keys it returns stubs (local dev).

## Dashboard setup

1. **Subscriptions** product enabled on the account.
2. **API Keys → Generate** (Test first) → put Key Id + Secret in `.env.production`.
3. **Webhooks → Add**: URL `https://crm.ainatech.in/api/webhooks/razorpay`,
   set a signing secret (→ `RAZORPAY_WEBHOOK_SECRET`), subscribe to:
   `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
   `subscription.pending`, `subscription.halted`, `subscription.cancelled`,
   `subscription.completed`, `payment.failed`, `payment.captured`.

## RBI note

E-mandate auto-debit is silent up to **₹15,000 per transaction**; above that the
customer must approve each debit via OTP (AFA). Yearly amounts over ₹15k will
prompt the customer each cycle — bill monthly to stay silent if that matters.

## Go-live

Swap the test keys for **live** keys in `.env.production`, recreate the webhook
in Live mode, and redeploy. Regenerate any test secret that was shared in plain
text before going live.
