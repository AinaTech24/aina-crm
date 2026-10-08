-- 0238 — Registrar scheme codes → the CRM Scheme Master (Phase 3H)
--
-- The CRM already has ONE scheme reference: the AMFI scheme code, which is the
-- key of scheme_nav (the daily AMFI feed) and the scheme_code of each firm's
-- scheme_master copy. Registrar files do not use it: CAMS names a scheme by
-- amc_code + product code, KFintech by Fund + Product Code. Nothing mapped one
-- to the other, so RTA transactions kept registrar codes the valuation and
-- reporting joins never match. This is the smallest extension that closes it —
-- a crosswalk, not a second scheme master: it holds no scheme names, plans,
-- categories or NAVs of its own, only "registrar code X IS AMFI scheme Y" and
-- the evidence for it.
--
-- Evidence, never a name:
--   resolved_isin  the registrar's own rows printed one ISIN for the code, and
--                  exactly one AMFI scheme carries that ISIN.
--   confirmed      a person chose the AMFI scheme (audited), and the code checks
--                  it against any ISIN evidence.
--   unresolved     no evidence yet (CAMS reports print no ISIN).
--   conflict       the evidence disagrees (two ISINs, an ISIN on two AMFI
--                  schemes, a confirmation contradicted by an ISIN).
-- A transaction whose scheme is not resolved_isin / confirmed is held before
-- posting (in the controlled pilot) with an exception naming the code.
--
-- Original registrar identifiers are kept next to the canonical code
-- (rta_scheme_code) so every posted row can be traced to the file.
-- All new columns are nullable (catalogue-only adds); no existing value changes.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS scheme_rta_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rta text NOT NULL,
  rta_amc_code text NOT NULL,
  rta_scheme_code text NOT NULL,
  observed_isins text[] NOT NULL DEFAULT '{}',
  observed_name text,
  source_reports text[] NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  amfi_scheme_code text,
  status text NOT NULL DEFAULT 'unresolved',
  status_reason text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  confirm_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheme_rta_codes_key UNIQUE (tenant_id, rta, rta_amc_code, rta_scheme_code),
  CONSTRAINT scheme_rta_codes_rta_ck CHECK (rta IN ('cams', 'kfintech')),
  CONSTRAINT scheme_rta_codes_status_ck CHECK (status IN ('unresolved', 'resolved_isin', 'confirmed', 'conflict')),
  CONSTRAINT scheme_rta_codes_resolved_ck CHECK (status NOT IN ('resolved_isin', 'confirmed') OR amfi_scheme_code IS NOT NULL),
  CONSTRAINT scheme_rta_codes_confirm_ck CHECK (status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(coalesce(confirm_note, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS scheme_rta_codes_amfi_idx ON scheme_rta_codes (tenant_id, amfi_scheme_code);
CREATE INDEX IF NOT EXISTS scheme_rta_codes_status_idx ON scheme_rta_codes (tenant_id, status);
ALTER TABLE scheme_rta_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_rta_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheme_rta_codes;
CREATE POLICY tenant_isolation ON scheme_rta_codes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- The registrar's own code, kept beside the canonical scheme_code.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rta_scheme_code text;
ALTER TABLE sips ADD COLUMN IF NOT EXISTS rta_scheme_code text;
ALTER TABLE sip_rejections ADD COLUMN IF NOT EXISTS scheme_code text;
ALTER TABLE sip_rejections ADD COLUMN IF NOT EXISTS rta_scheme_code text;
ALTER TABLE rta_sip_registrations ADD COLUMN IF NOT EXISTS amfi_scheme_code text;
ALTER TABLE rta_sip_registrations ADD COLUMN IF NOT EXISTS scheme_status text;
ALTER TABLE rta_staging_economic_txns ADD COLUMN IF NOT EXISTS amfi_scheme_code text;
ALTER TABLE rta_staging_economic_txns ADD COLUMN IF NOT EXISTS scheme_status text;
