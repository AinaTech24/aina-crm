-- 0242 — which registrars a firm's activation covers (final pilot corrections, 2026-10-09)
--
-- A FORWARD migration. A KFintech-only pilot must not post a CAMS file: before
-- this, an activation covered every registrar, so a CAMS master or holdings
-- file sent to the pilot firm would have posted clients, folios and legs (CAMS
-- transactions were held by the scheme gate only because no CAMS code is
-- mapped yet).
--
--   registrars  the registrars the activation covers ('cams', 'kfintech').
--               NULL only on rows written before this migration (no such row
--               exists in production: 0236 is not deployed). The application
--               requires a non-empty list for every activation that enables
--               posting, and the posting gate refuses — inside the posting
--               transaction — any batch, held transaction, SIP registration
--               or manual resolution of a registrar the list does not name.
--
-- The column is part of the decision, so the append-only trigger now also
-- refuses any edit of it (an activation is revoked once and otherwise never
-- edited).
--
-- Lock risk: a nullable column with no default (catalogue-only) and a
-- function replacement.

SET LOCAL lock_timeout = '5s';

ALTER TABLE rta_pipeline_activations ADD COLUMN IF NOT EXISTS registrars text[];
ALTER TABLE rta_pipeline_activations DROP CONSTRAINT IF EXISTS rta_pipeline_activations_registrars_ck;
ALTER TABLE rta_pipeline_activations ADD CONSTRAINT rta_pipeline_activations_registrars_ck
  CHECK (registrars IS NULL OR (cardinality(registrars) > 0 AND registrars <@ ARRAY['cams', 'kfintech']::text[]));

CREATE OR REPLACE FUNCTION rta_pipeline_activations_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rta_pipeline_activations rows are revoked, never deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.posting_enabled IS DISTINCT FROM OLD.posting_enabled OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.approval_ref IS DISTINCT FROM OLD.approval_ref OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.registrars IS DISTINCT FROM OLD.registrars THEN
    RAISE EXCEPTION 'rta_pipeline_activations: an activation is revoked once and otherwise never edited' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;
