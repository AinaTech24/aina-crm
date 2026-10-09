-- 0241 — the verified AMC-identity crosswalk (pilot preflight, 2026-10-09)
--
-- A FORWARD migration. Which AMFI AMC a registrar's AMC code IS — the same
-- for every firm (registrar AMC codes are the registrar's), so a platform
-- table with no tenant id, like scheme_registrar_map (0239).
--
--   role 'primary'    the AMC the registrar code belongs to.
--   role 'successor'  another AMFI AMC name the registrar code's schemes may
--                     legitimately carry — a DOCUMENTED merger, succession or
--                     rename (AMFI keeps historical schemes under the old
--                     AMC's name). Never inferred.
--   basis 'isin'      recorded by the system when every ISIN-verified code
--                     under the registrar AMC points to one AMFI AMC (primary
--                     only).
--   basis 'platform_approval'
--                     two different platform operators and an evidence note
--                     (the registrar's or AMC's own document) — the only way
--                     for CAMS, which prints no ISIN, and the only way to add
--                     a successor.
--
-- Name suggestions and manual scheme approvals for a registrar code are
-- confined to its verified AMCs. Approving the AMC identity approves NO
-- scheme. registrar_amc_identity_events is append-only.
--
-- Lock risk: new tables only.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS registrar_amc_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rta text NOT NULL,
  rta_amc_code text NOT NULL,
  amfi_amc text NOT NULL,
  role text NOT NULL,
  basis text NOT NULL,
  status text NOT NULL,
  evidence_note text,
  evidence_isins integer,
  requested_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registrar_amc_identity_rta_ck CHECK (rta IN ('cams', 'kfintech')),
  CONSTRAINT registrar_amc_identity_role_ck CHECK (role IN ('primary', 'successor')),
  CONSTRAINT registrar_amc_identity_basis_ck CHECK (basis IN ('isin', 'platform_approval')),
  CONSTRAINT registrar_amc_identity_status_ck CHECK (status IN ('verified', 'approved', 'revoked')),
  CONSTRAINT registrar_amc_identity_isin_ck CHECK (basis <> 'isin' OR (role = 'primary' AND coalesce(evidence_isins, 0) > 0)),
  CONSTRAINT registrar_amc_identity_approval_ck CHECK (basis <> 'platform_approval' OR (requested_by IS NOT NULL AND approved_by IS NOT NULL AND requested_by <> approved_by
                                                     AND length(btrim(coalesce(evidence_note, ''))) >= 10)),
  CONSTRAINT registrar_amc_identity_revoke_ck CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS registrar_amc_identity_one_primary ON registrar_amc_identity (rta, rta_amc_code) WHERE role = 'primary' AND status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS registrar_amc_identity_live_key ON registrar_amc_identity (rta, rta_amc_code, lower(amfi_amc)) WHERE status <> 'revoked';

CREATE TABLE IF NOT EXISTS registrar_amc_identity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES registrar_amc_identity(id),
  action text NOT NULL,
  before jsonb,
  after jsonb,
  actor uuid,
  second_actor uuid,
  reason text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION registrar_amc_identity_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'registrar_amc_identity_events is append-only';
END $fn$;
DROP TRIGGER IF EXISTS registrar_amc_identity_events_immutable ON registrar_amc_identity_events;
CREATE TRIGGER registrar_amc_identity_events_immutable BEFORE UPDATE OR DELETE ON registrar_amc_identity_events
  FOR EACH ROW EXECUTE FUNCTION registrar_amc_identity_events_immutable();
