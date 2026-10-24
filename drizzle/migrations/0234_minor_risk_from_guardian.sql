-- 0234 — A minor's risk profile IS the guardian's (the firm's rule, 2026-10-13).
--
-- A minor cannot sign a risk profile; the guardian answers for them. So a
-- minor linked to a guardian's client record (investors.guardian_investor_id)
-- always carries the guardian's category, score, signed date and provisional
-- flag. The risk profile is written from many places (the questionnaire, the
-- RM form, imports, bulk age-based profiling, discovery), so the rule lives
-- here, where every one of them passes:
--
--   investors_minor_risk_from_guardian   BEFORE INSERT / UPDATE of a minor
--       with a guardian: copy the guardian's risk fields onto the row.
--   investors_guardian_risk_to_minors    AFTER the guardian's risk fields
--       change: the same change on every minor they are guardian of.
--
-- A minor with no linked guardian keeps whatever it has. Additive only.

CREATE INDEX IF NOT EXISTS investors_guardian_idx
  ON investors (tenant_id, guardian_investor_id)
  WHERE guardian_investor_id IS NOT NULL;

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

-- Minors already linked to a guardian take the guardian's profile now.
UPDATE investors SET updated_at = updated_at
 WHERE investor_category = 'minor' AND guardian_investor_id IS NOT NULL;
