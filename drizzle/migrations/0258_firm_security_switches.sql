-- DPDP step 4 (2026-11-03): two firm-wide switches (Settings → Security).
--
-- tenants.require_2fa — every member of the firm signs in with a second factor;
--   someone without one is made to set it up at sign-in before any session.
-- tenants.ai_enabled — the firm's data may be sent to the AI provider (drafts,
--   summaries, the assistant). Off = every AI feature refuses for the firm.
-- Additive only; defaults keep today's behaviour.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_2fa boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
