-- Provisional risk profiles + per-firm age bands.
--
-- A risk profile is meant to come from the CLIENT'S OWN answers — that is what
-- SEBI expects and what the firm's DDQ ("Investor risk-profiling process &
-- form") is judged on. But an MFD onboarding a migrated book of several hundred
-- clients has nobody profiled at all, and chasing every client for a
-- questionnaire before any advice can be given is not workable.
--
-- So: allow a category to be assigned in bulk from the client's AGE (a proxy
-- for investment horizon) — but mark it PROVISIONAL. A provisional profile:
--   · is visibly flagged in the register and excluded from "profiled" counts,
--   · states in the client's email that it is a suggestion to confirm,
--   · is REPLACED by a real signed profile the moment the client submits the
--     questionnaire through their link (the public submit route clears it).
--
-- Storing this as a flag rather than a separate table keeps every existing
-- reader (client 360, suitability checks, reports) working unchanged — they
-- see a category as before, and only the surfaces that care about provenance
-- need to know the difference.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS risk_profile_provisional boolean NOT NULL DEFAULT false;

ALTER TABLE risk_profile_responses
  ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false,
  -- How the category was arrived at when there was no questionnaire:
  -- 'age_band' today; leaves room for 'segment' / 'migrated' later.
  ADD COLUMN IF NOT EXISTS basis text;

-- The register's "Provisional" filter and the notify step both scan for these,
-- and they are a small slice of the book — a partial index keeps that cheap
-- without carrying every properly-profiled row.
CREATE INDEX IF NOT EXISTS investors_risk_provisional_idx
    ON investors (tenant_id)
 WHERE risk_profile_provisional = true;

-- Per-firm age → category bands, edited in the bulk-assign dialog. NULL/absent
-- means "use the product defaults" (src/lib/risk-profile/age-bands.ts) — we do
-- not copy the defaults into every tenant row, so improving the default later
-- reaches every firm that never customised it.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS risk_age_bands jsonb;
