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
-- Additive only; tenant isolation by RLS (ENABLE + FORCE + tenant_isolation).
-- Rollback: nothing reads these until the posting phase.

CREATE TABLE IF NOT EXISTS folio_holders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  folio_id         uuid NOT NULL REFERENCES folios(id) ON DELETE RESTRICT,
  role             text NOT NULL CHECK (role IN ('first', 'second', 'third', 'guardian', 'karta')),
  investor_id      uuid REFERENCES investors(id) ON DELETE RESTRICT,
  holder_pan       text,
  holder_name      text,
  holder_dob       date,
  source           text NOT NULL CHECK (source IN ('registrar', 'kyc', 'staff')),
  source_report    text,
  source_batch_id  uuid,
  source_as_of     date,
  verified         boolean NOT NULL DEFAULT false,
  effective_from   date,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folio_holders_dates_ck CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
-- One CURRENT holder per role per folio.
CREATE UNIQUE INDEX IF NOT EXISTS folio_holders_current_role_uidx ON folio_holders (tenant_id, folio_id, role) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS folio_holders_investor_idx ON folio_holders (tenant_id, investor_id) WHERE investor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS folio_holders_pan_idx ON folio_holders (tenant_id, holder_pan) WHERE holder_pan IS NOT NULL;

ALTER TABLE folio_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_holders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON folio_holders;
CREATE POLICY tenant_isolation ON folio_holders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE investors ADD COLUMN IF NOT EXISTS identity_confidence text
  CHECK (identity_confidence IN ('verified_pan', 'provisional_folio', 'manual'));
ALTER TABLE investors ADD COLUMN IF NOT EXISTS majority_status text
  CHECK (majority_status IN ('minor', 'major_pending_regularisation', 'major_verified'));
