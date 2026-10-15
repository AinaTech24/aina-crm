-- ROLLBACK FOR THE PROPOSED 0245 — FOR SEPARATE REVIEW. NOT APPLIED.
-- Re-creates the two 0234 triggers and their functions, verbatim from
-- drizzle/migrations/0234_minor_risk_from_guardian.sql (lines 21–73).
--
-- Deliberately WITHOUT 0234's closing backfill
--   (UPDATE investors SET updated_at = updated_at WHERE … minor … guardian …)
-- so a rollback changes no row. With the triggers back, a linked minor takes
-- the guardian's copy again on its next write; the application (G-1) never
-- reads that copy either way.
--
-- In the migration chain a rollback is itself a NEW forward migration (the
-- next free number at the time), never an edit of 0245. Tested forward →
-- rollback on a disposable copy, 2026-10-15 (G1_GUARDIAN_HOTFIX.md §11).

CREATE OR REPLACE FUNCTION minor_risk_from_guardian() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  g_profile text;
  g_score integer;
  g_signed timestamptz;
  g_provisional boolean;
BEGIN
  SELECT risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional
    INTO g_profile, g_score, g_signed, g_provisional
    FROM investors g
   WHERE g.id = NEW.guardian_investor_id AND g.tenant_id = NEW.tenant_id;
  IF FOUND THEN
    NEW.risk_profile := g_profile;
    NEW.risk_profile_score := g_score;
    NEW.risk_profile_signed_at := g_signed;
    NEW.risk_profile_provisional := COALESCE(g_provisional, false);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS investors_minor_risk_from_guardian ON investors;
CREATE TRIGGER investors_minor_risk_from_guardian
  BEFORE INSERT OR UPDATE ON investors
  FOR EACH ROW
  WHEN (NEW.investor_category = 'minor' AND NEW.guardian_investor_id IS NOT NULL)
  EXECUTE FUNCTION minor_risk_from_guardian();

CREATE OR REPLACE FUNCTION guardian_risk_to_minors() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE investors m
     SET risk_profile = NEW.risk_profile,
         risk_profile_score = NEW.risk_profile_score,
         risk_profile_signed_at = NEW.risk_profile_signed_at,
         risk_profile_provisional = COALESCE(NEW.risk_profile_provisional, false),
         updated_at = now()
   WHERE m.tenant_id = NEW.tenant_id
     AND m.guardian_investor_id = NEW.id
     AND m.investor_category = 'minor'
     AND m.id <> NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS investors_guardian_risk_to_minors ON investors;
CREATE TRIGGER investors_guardian_risk_to_minors
  AFTER UPDATE OF risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional ON investors
  FOR EACH ROW
  WHEN (OLD.risk_profile IS DISTINCT FROM NEW.risk_profile
     OR OLD.risk_profile_score IS DISTINCT FROM NEW.risk_profile_score
     OR OLD.risk_profile_signed_at IS DISTINCT FROM NEW.risk_profile_signed_at
     OR OLD.risk_profile_provisional IS DISTINCT FROM NEW.risk_profile_provisional)
  EXECUTE FUNCTION guardian_risk_to_minors();
