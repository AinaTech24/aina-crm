-- 0234 — Folio holder relationships (owner decisions of 2026-10-08).
--
-- DEVELOPMENT ONLY until reviewed: no importer writes these yet (the shadow
-- pipeline proposes them; posting is a later, separately approved phase).
--
-- A folio has ONE legal owner — folios.investor_id, unchanged. Everyone else
-- named on it is a relationship TO that owner, kept here per folio:
--   first     the owner as the registrar names them (mirrors folios.investor_id)
--   second / third   joint holders — not owners of a copy; AUM counts the folio once
--   guardian  a minor owner's guardian
--   karta     an HUF owner's Karta (no registrar report carries a Karta field —
--             verified on R9 / R2 / MFSD211 / MFSD201 / MFSD203; set from KYC or by staff)
-- A holder is linked to a client record when they are one (investor_id), and is
-- otherwise described by what the registrar printed. A change of Karta, or a
-- minor's guardian ending at majority, closes the old row (effective_to) and
-- opens a new one: the folio and its history never move.
--
-- investors gains two descriptive columns, both nullable, nothing backfilled:
--   identity_confidence  how the client's identity is established
--   majority_status      a minor-to-major transition, set only from registrar
--                        evidence (never from the date of birth alone)
--
-- Additive only; tenant isolation by RLS (ENABLE + FORCE + tenant_isolation)
-- plus a tenant-consistency trigger. No existing row is written.
-- Rollback: nothing reads these until the posting phase; the columns and the
-- empty table can stay. Dropping folio_holders once populated is a separate,
-- signed-off step after an export.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS folio_holders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  -- A holder row describes a folio; it goes when the folio goes (client purge).
  folio_id         uuid NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('first', 'second', 'third', 'guardian', 'karta')),
  -- A holder who is also a client: purging that client keeps the row (and what
  -- the registrar printed), only the link goes.
  investor_id      uuid REFERENCES investors(id) ON DELETE SET NULL,
  -- PAN privacy (Phase 3E): never the PAN in clear. A holder who is a client
  -- has their PAN on investors (under its own access rules); otherwise only a
  -- keyed token (pt1:, lib/rta/staging/pan-token.ts) to compare, and a masked
  -- form (last four characters) to show.
  holder_pan_token  text CHECK (holder_pan_token IS NULL OR holder_pan_token LIKE 'pt1:%'),
  holder_pan_masked text CHECK (holder_pan_masked IS NULL OR holder_pan_masked ~ '^[*]{6}[A-Z0-9]{4}$'),
  holder_name      text,
  holder_dob       date,
  source           text NOT NULL CHECK (source IN ('registrar', 'kyc', 'staff')),
  source_report    text,
  source_batch_id  uuid,
  source_as_of     date,
  verified         boolean NOT NULL DEFAULT false,
  effective_from   date,
  effective_to     date,
  -- Audit: who recorded the row, who closed it and why. A change of holder is
  -- a closed row plus a new one, never an edit (trigger below).
  closed_reason    text,
  created_by       uuid,
  closed_by        uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folio_holders_dates_ck CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
-- One CURRENT holder per role per folio.
CREATE UNIQUE INDEX IF NOT EXISTS folio_holders_current_role_uidx ON folio_holders (tenant_id, folio_id, role) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS folio_holders_investor_idx ON folio_holders (tenant_id, investor_id) WHERE investor_id IS NOT NULL;
-- One person holds at most one current role on a folio (by client, or by PAN token).
CREATE UNIQUE INDEX IF NOT EXISTS folio_holders_current_investor_uidx ON folio_holders (tenant_id, folio_id, investor_id) WHERE effective_to IS NULL AND investor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS folio_holders_current_pan_uidx ON folio_holders (tenant_id, folio_id, holder_pan_token) WHERE effective_to IS NULL AND holder_pan_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS folio_holders_pan_idx ON folio_holders (tenant_id, holder_pan_token) WHERE holder_pan_token IS NOT NULL;

ALTER TABLE folio_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_holders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON folio_holders;
CREATE POLICY tenant_isolation ON folio_holders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- Tenant consistency: folio_id / investor_id are plain foreign keys (folios
-- and investors have no (tenant_id, id) key, and adding one would lock two
-- large tables during deploy). The trigger refuses a row whose folio or client
-- belongs to another firm — under RLS the lookup sees only the caller's firm,
-- in system context the explicit tenant_id comparison does the same.
CREATE OR REPLACE FUNCTION folio_holders_tenant_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM folios f WHERE f.id = NEW.folio_id AND f.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'folio_holders: folio % is not a folio of tenant %', NEW.folio_id, NEW.tenant_id USING ERRCODE = '23503';
  END IF;
  IF NEW.investor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.id = NEW.investor_id AND i.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'folio_holders: client % is not a client of tenant %', NEW.investor_id, NEW.tenant_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$fn$;
-- History is kept by closing rows, not editing them: what the registrar
-- printed (folio, role, PAN token, name, date of birth, source) never changes
-- in place. Only the closing fields, verification and the client link (which
-- a merge re-points and a client purge clears) may change.
CREATE OR REPLACE FUNCTION folio_holders_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.folio_id IS DISTINCT FROM OLD.folio_id OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.holder_pan_token IS DISTINCT FROM OLD.holder_pan_token OR NEW.holder_pan_masked IS DISTINCT FROM OLD.holder_pan_masked
     OR NEW.holder_name IS DISTINCT FROM OLD.holder_name OR NEW.holder_dob IS DISTINCT FROM OLD.holder_dob
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.source_report IS DISTINCT FROM OLD.source_report
     OR NEW.source_batch_id IS DISTINCT FROM OLD.source_batch_id OR NEW.source_as_of IS DISTINCT FROM OLD.source_as_of
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to) THEN
    RAISE EXCEPTION 'folio_holders: a holder row is closed and replaced, never edited' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS folio_holders_append_only ON folio_holders;
CREATE TRIGGER folio_holders_append_only BEFORE UPDATE ON folio_holders
  FOR EACH ROW EXECUTE FUNCTION folio_holders_append_only();

DROP TRIGGER IF EXISTS folio_holders_tenant_check ON folio_holders;
CREATE TRIGGER folio_holders_tenant_check BEFORE INSERT OR UPDATE OF tenant_id, folio_id, investor_id ON folio_holders
  FOR EACH ROW EXECUTE FUNCTION folio_holders_tenant_check();

-- Two nullable columns, no default: a catalogue-only change. Their CHECKs are
-- added NOT VALID so no full scan of investors runs under the ALTER's lock —
-- every existing row is NULL and satisfies them anyway; new writes are checked.
ALTER TABLE investors ADD COLUMN IF NOT EXISTS identity_confidence text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS majority_status text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investors_identity_confidence_ck') THEN
    ALTER TABLE investors ADD CONSTRAINT investors_identity_confidence_ck
      CHECK (identity_confidence IN ('verified_pan', 'provisional_folio', 'manual')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investors_majority_status_ck') THEN
    ALTER TABLE investors ADD CONSTRAINT investors_majority_status_ck
      CHECK (majority_status IN ('minor', 'major_pending_regularisation', 'major_verified')) NOT VALID;
  END IF;
END $$;
