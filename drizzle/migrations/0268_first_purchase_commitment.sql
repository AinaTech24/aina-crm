-- 0268 — A new firm's first purchase is a 6-month commitment (or yearly).
--
-- The owner's rule of 2026-11-18 (lib/billing/aum-pricing.ts `cyclesOffered`):
-- a firm that has never paid buys either the commitment (6 × the monthly base,
-- no discount, + GST) or yearly. After the commitment the firm continues on
-- the cycle it chose, else monthly (lib/billing/renewal-review.ts).
--
--   · pricing_quotes.chosen_cycle may now record 'commitment'.
--   · subscriptions.razorpay_plan_paise — what the Razorpay plan in force debits
--     each cycle (incl. GST). For a commitment the plan is the MONTHLY plan that
--     follows it, so the renewal review can tell whether the plan must move.
--     NULL on older rows means "the cycle total" (cycle_total_paise).
--
-- subscriptions.billing_cycle is a text column with no CHECK: 'commitment'
-- joins monthly | half_yearly | yearly | custom without a change here.
-- No new table, so no new RLS policy: both tables keep their 0265 policies.

ALTER TABLE pricing_quotes DROP CONSTRAINT IF EXISTS pricing_quotes_chosen_cycle_check;
ALTER TABLE pricing_quotes
  ADD CONSTRAINT pricing_quotes_chosen_cycle_check
  CHECK (chosen_cycle IN ('monthly', 'half_yearly', 'yearly', 'commitment'));

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS razorpay_plan_paise integer;
