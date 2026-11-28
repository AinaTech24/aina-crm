-- 0302 — A user limit that does not touch pricing, and 70 users for We Care
-- Freedom Wealth Pvt. Ltd. (ARN-249212), the owner's request of 2026-11-28:
-- "don't change the pricing, I only want to increase the users limit".
--
-- subscriptions.seats_override is the number of users BOUGHT: it prices Billing
-- and an online purchase replaces it. The new user_limit_override is only an
-- allowance: how many users the firm may create, never what it pays. The limit is
-- the higher of the two (lib/billing/user-limit.ts), so a purchase never takes
-- the allowance away. Empty for every firm but this one.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_limit_override integer;

-- subscriptions and tenants force row-level security; this finds the firm by ARN
-- across tenants, so it runs with the platform flag the tenant_isolation policy
-- honours. Local to this file's transaction.
SELECT set_config('app.is_platform_admin', 'true', true);

-- The ARN's digits must be exactly 249212 (a longer number that merely contains
-- them is another firm).
UPDATE subscriptions s
   SET user_limit_override = 70, updated_at = now()
 WHERE s.tenant_id IN (SELECT t.id FROM tenants t WHERE regexp_replace(t.arn, '[^0-9]', '', 'g') = '249212')
   AND COALESCE(s.user_limit_override, 0) < 70;
