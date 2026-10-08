-- 0239 — AMFI feed fidelity, provenance and verified registrar mappings (Phase 3I)
--
-- A FORWARD migration (0233–0238 are applied history and are not edited).
-- The Scheme Master stays what it is — the AMFI scheme code, keyed in
-- scheme_nav and copied per firm into scheme_master. Nothing here is a second
-- master: no names, categories or NAVs are duplicated.
--
-- scheme_nav (platform reference data, no tenant) — what AMFI's current
-- eight-column NAVAll prints, kept as printed:
--   isin_payout_growth  column "ISIN Div Payout/ ISIN Growth" EXACTLY (the
--                       older `isin` column falls back to the reinvestment ISIN
--                       when this is blank; kept for compatibility)
--   plan, option_name   the explicit "Plan" / "Option" columns (null in the
--                       legacy six-column layout)
--   first_seen_feed / last_seen_feed
--                       the dates of the first and latest AMFI feed that listed
--                       the scheme — a scheme absent from the latest feed is
--                       inactive / historical, its NAV is not current.
--
-- amfi_feed_imports (platform) — one row per AMFI file applied or refused:
--   source (download / file), its SHA-256, header, layout, feed date, counts,
--   duplicates and ambiguous ISINs found, the schemes AMFI lists WITHOUT a NAV
--   (unpriced: code, ISINs, plan, option, AMC — identity only, never priced; they
--   cannot enter scheme_nav, whose NAV is NOT NULL), who imported it. AMFI publishes no
--   signature; the hash and source are the audit trail.
--
-- scheme_registrar_map (platform) — a registrar code → AMFI scheme code
--   relationship that is the same for every firm: VERIFIED by the registrar's
--   own ISIN against the AMFI feed, or APPROVED by two platform operators.
--   Firms read it; only the system (ISIN evidence) and operators write it.
--   scheme_registrar_map_events is its append-only history.
--
-- scheme_rta_codes (per firm, RLS) — review fields for the Scheme codes
--   screen: why the code is in its state (reason_code), a deferral or a
--   rejected candidate, and the evidence a person cited when approving.
--
-- Lock risk: nullable column adds (catalogue-only) on scheme_nav and
-- scheme_rta_codes; new tables. lock_timeout bounds it.

SET LOCAL lock_timeout = '5s';

ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS isin_payout_growth text;
ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS option_name text;
ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS first_seen_feed date;
ALTER TABLE scheme_nav ADD COLUMN IF NOT EXISTS last_seen_feed date;
CREATE INDEX IF NOT EXISTS scheme_nav_isin_reinvest_idx ON scheme_nav (isin_reinvest);
CREATE INDEX IF NOT EXISTS scheme_nav_isin_pg_idx ON scheme_nav (isin_payout_growth);

CREATE TABLE IF NOT EXISTS amfi_feed_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_ref text,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  header text,
  layout text,
  feed_date date,
  rows_total integer NOT NULL DEFAULT 0,
  schemes integer NOT NULL DEFAULT 0,
  with_nav integer NOT NULL DEFAULT 0,
  without_nav integer NOT NULL DEFAULT 0,
  duplicate_codes integer NOT NULL DEFAULT 0,
  isin_on_many_codes integer NOT NULL DEFAULT 0,
  written integer NOT NULL DEFAULT 0,
  kept_newer integer NOT NULL DEFAULT 0,
  unpriced jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,
  reject_reason text,
  imported_by uuid,
  note text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amfi_feed_imports_source_ck CHECK (source IN ('download', 'file')),
  CONSTRAINT amfi_feed_imports_layout_ck CHECK (layout IS NULL OR layout IN ('current8', 'legacy6')),
  CONSTRAINT amfi_feed_imports_status_ck CHECK (status IN ('applied', 'rejected'))
);
CREATE INDEX IF NOT EXISTS amfi_feed_imports_at_idx ON amfi_feed_imports (imported_at DESC);

CREATE TABLE IF NOT EXISTS scheme_registrar_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rta text NOT NULL,
  rta_amc_code text NOT NULL,
  rta_scheme_code text NOT NULL,
  amfi_scheme_code text NOT NULL,
  basis text NOT NULL,
  evidence_isin text,
  isin_column text,
  status text NOT NULL,
  evidence_note text,
  requested_by uuid,
  approved_by uuid,
  verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheme_registrar_map_rta_ck CHECK (rta IN ('cams', 'kfintech')),
  CONSTRAINT scheme_registrar_map_basis_ck CHECK (basis IN ('isin', 'platform_approval')),
  CONSTRAINT scheme_registrar_map_status_ck CHECK (status IN ('verified', 'approved', 'revoked')),
  CONSTRAINT scheme_registrar_map_isin_ck CHECK (basis <> 'isin' OR (evidence_isin IS NOT NULL AND isin_column IN ('payout_growth', 'reinvest'))),
  CONSTRAINT scheme_registrar_map_approval_ck CHECK (basis <> 'platform_approval' OR (requested_by IS NOT NULL AND approved_by IS NOT NULL AND requested_by <> approved_by
                                                     AND length(btrim(coalesce(evidence_note, ''))) >= 10)),
  CONSTRAINT scheme_registrar_map_revoke_ck CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS scheme_registrar_map_live_key ON scheme_registrar_map (rta, rta_amc_code, rta_scheme_code) WHERE status <> 'revoked';
CREATE INDEX IF NOT EXISTS scheme_registrar_map_amfi_idx ON scheme_registrar_map (amfi_scheme_code);

CREATE TABLE IF NOT EXISTS scheme_registrar_map_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES scheme_registrar_map(id),
  action text NOT NULL,
  before jsonb,
  after jsonb,
  actor uuid,
  second_actor uuid,
  reason text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION scheme_registrar_map_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'scheme_registrar_map_events is append-only';
END $fn$;
DROP TRIGGER IF EXISTS scheme_registrar_map_events_immutable ON scheme_registrar_map_events;
CREATE TRIGGER scheme_registrar_map_events_immutable BEFORE UPDATE OR DELETE ON scheme_registrar_map_events
  FOR EACH ROW EXECUTE FUNCTION scheme_registrar_map_events_immutable();

ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS review_state text;
ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS rejected_candidates text[] NOT NULL DEFAULT '{}';
ALTER TABLE scheme_rta_codes ADD COLUMN IF NOT EXISTS evidence_source text;
ALTER TABLE scheme_rta_codes DROP CONSTRAINT IF EXISTS scheme_rta_codes_review_ck;
ALTER TABLE scheme_rta_codes ADD CONSTRAINT scheme_rta_codes_review_ck CHECK (review_state IS NULL OR review_state IN ('deferred'));
