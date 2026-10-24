-- 0236 — A risk profile that states its own expiry (the firm's request, 2026-10-15).
--
-- A client who already holds a risk profile from elsewhere (another
-- distributor, a signed paper form) is recorded by uploading it with its own
-- "Expire On" date. Everything that asks "is this profile current?" used to
-- work it out as signed date + 1 year; a profile that says it lapses on a
-- different date needs that date kept.
--
--   investors.risk_profile_expires_on   the stated expiry
--   investors.risk_profile_expiry_for   the signed date that expiry belongs to
--
-- The expiry counts only while risk_profile_expiry_for equals
-- risk_profile_signed_at. The risk profile is written from many places (the
-- questionnaire, the client link, the RM form, imports, bulk age-based
-- profiling, a lead's conversion); the moment any of them records a new signed
-- date, the stated expiry no longer matches and the one-year rule applies
-- again — no writer has to remember to clear it. lib/risk-profile/expiry.ts
-- is the one place that reads the pair.
--
-- A minor's profile is the guardian's (0234), so the pair is copied with it.
-- Additive only.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS risk_profile_expires_on date,
  ADD COLUMN IF NOT EXISTS risk_profile_expiry_for timestamptz;

CREATE OR REPLACE FUNCTION minor_risk_from_guardian() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  g_profile text;
  g_score integer;
  g_signed timestamptz;
  g_provisional boolean;
  g_expires date;
  g_expiry_for timestamptz;
BEGIN
  SELECT risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional,
         risk_profile_expires_on, risk_profile_expiry_for
    INTO g_profile, g_score, g_signed, g_provisional, g_expires, g_expiry_for
    FROM investors g
   WHERE g.id = NEW.guardian_investor_id AND g.tenant_id = NEW.tenant_id;
  IF FOUND THEN
    NEW.risk_profile := g_profile;
    NEW.risk_profile_score := g_score;
    NEW.risk_profile_signed_at := g_signed;
    NEW.risk_profile_provisional := COALESCE(g_provisional, false);
    NEW.risk_profile_expires_on := g_expires;
    NEW.risk_profile_expiry_for := g_expiry_for;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guardian_risk_to_minors() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE investors m
     SET risk_profile = NEW.risk_profile,
         risk_profile_score = NEW.risk_profile_score,
         risk_profile_signed_at = NEW.risk_profile_signed_at,
         risk_profile_provisional = COALESCE(NEW.risk_profile_provisional, false),
         risk_profile_expires_on = NEW.risk_profile_expires_on,
         risk_profile_expiry_for = NEW.risk_profile_expiry_for,
         updated_at = now()
   WHERE m.tenant_id = NEW.tenant_id
     AND m.guardian_investor_id = NEW.id
     AND m.investor_category = 'minor'
     AND m.id <> NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS investors_guardian_risk_to_minors ON investors;
CREATE TRIGGER investors_guardian_risk_to_minors
  AFTER UPDATE OF risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional,
                  risk_profile_expires_on, risk_profile_expiry_for ON investors
  FOR EACH ROW
  WHEN (OLD.risk_profile IS DISTINCT FROM NEW.risk_profile
     OR OLD.risk_profile_score IS DISTINCT FROM NEW.risk_profile_score
     OR OLD.risk_profile_signed_at IS DISTINCT FROM NEW.risk_profile_signed_at
     OR OLD.risk_profile_provisional IS DISTINCT FROM NEW.risk_profile_provisional
     OR OLD.risk_profile_expires_on IS DISTINCT FROM NEW.risk_profile_expires_on
     OR OLD.risk_profile_expiry_for IS DISTINCT FROM NEW.risk_profile_expiry_for)
  EXECUTE FUNCTION guardian_risk_to_minors();
