-- 0269 — Smoother self-serve onboarding (the owner's request of 2026-11-18).
--
--   · pricing_quotes.followup_sent_at — the one "continue where you left off"
--     email to a quote that never became a firm (lib/onboarding/quote-followup.ts).
--     Set once, so it is never sent twice.
--   · pricing_quotes.resume_token_hash — the SHA-256 of the token in that
--     email's resume link (/pricing?quote=…&t=…). The browser's own claim token
--     (claim_token_hash) keeps working beside it; only hashes are stored.
--   · pricing_quotes.mobile_* — the optional SMS code that verifies the mobile
--     at the account step (lib/onboarding/mobile-otp.ts). Only the code's keyed
--     hash is stored; it expires in 10 minutes, allows 5 wrong tries, and
--     resends are throttled. mobile_verified_at stays NULL when SMS is not
--     configured — sign-up is never blocked by it.
--   · users.mobile_verified_at — copied from the quote onto the owner when the
--     firm is created.
--   · tenants.onboarding_nudged_at — the one "need a hand importing your
--     clients?" email to a firm that paid 3+ days ago and has no clients yet
--     (lib/onboarding/stalled.ts).
--
-- Columns only, no new table: pricing_quotes keeps its 0265 platform_only
-- policy, users and tenants keep theirs. Additive and idempotent.

ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS resume_token_hash text;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS mobile_verified_at timestamptz;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS mobile_otp_hash text;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS mobile_otp_expires_at timestamptz;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS mobile_otp_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS mobile_otp_sent_at timestamptz;
ALTER TABLE pricing_quotes ADD COLUMN IF NOT EXISTS mobile_otp_sends integer NOT NULL DEFAULT 0;

-- The follow-up scan: open quotes, oldest first.
CREATE INDEX IF NOT EXISTS pricing_quotes_followup_idx ON pricing_quotes (created_at)
  WHERE followup_sent_at IS NULL AND converted_tenant_id IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_verified_at timestamptz;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_nudged_at timestamptz;
