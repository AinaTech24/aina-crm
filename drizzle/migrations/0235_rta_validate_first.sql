-- 0235 — Validate-first RTA import: posting ledger, posting outcomes, canonical
-- SIP Master (Phase 3F, 2026-10-08).
--
-- DEVELOPMENT ONLY until reviewed. Posting from staging is behind a fail-closed
-- gate in code (lib/rta/posting/gate.ts) that refuses unless the environment is
-- explicitly a local development database; this migration only adds the
-- places its results are recorded. Nothing existing is rewritten; every new
-- column is nullable or has a constant default (catalogue-only ALTERs).
--
--   rta_staging_batches        mode may be 'validate_first'; posting_state,
--                              posted_at, posting_counts record what the
--                              posting step committed for the batch.
--   rta_staging_economic_txns  posting_outcome / posting_reason / posted_at:
--                              each economic transaction's committed outcome.
--   rta_posted_transactions    the ledger: ONE row per (tenant, registrar
--                              identity key) ever posted or matched — the
--                              retry / overlap / concurrency guard, and the
--                              lineage from a CRM transaction back to its
--                              economic transaction, rows and lots.
--   rta_sip_registrations      the canonical SIP Master (lib/rta/sip-master.ts)
--                              as last built, one row per registration key.
--
-- Tenant isolation: RLS ENABLE + FORCE + tenant_isolation on both new tables;
-- staging references are composite (tenant_id, id). Rollback: the posting gate
-- off; the tables can stay empty. Dropping them once populated is a separate,
-- signed-off step after an export.

SET LOCAL lock_timeout = '5s';

ALTER TABLE rta_staging_batches DROP CONSTRAINT IF EXISTS rta_staging_batches_mode_check;
ALTER TABLE rta_staging_batches ADD CONSTRAINT rta_staging_batches_mode_check CHECK (mode IN ('shadow', 'validate_first')) NOT VALID;
ALTER TABLE rta_staging_batches ADD COLUMN IF NOT EXISTS posting_state text NOT NULL DEFAULT 'not_posted';
ALTER TABLE rta_staging_batches ADD COLUMN IF NOT EXISTS posted_at timestamptz;
ALTER TABLE rta_staging_batches ADD COLUMN IF NOT EXISTS posting_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rta_staging_batches_posting_state_ck') THEN
    ALTER TABLE rta_staging_batches ADD CONSTRAINT rta_staging_batches_posting_state_ck
      CHECK (posting_state IN ('not_posted', 'posted', 'partially_posted', 'blocked', 'nothing_to_post')) NOT VALID;
  END IF;
END $$;

ALTER TABLE rta_staging_economic_txns ADD COLUMN IF NOT EXISTS posting_outcome text;
ALTER TABLE rta_staging_economic_txns ADD COLUMN IF NOT EXISTS posting_reason text;
ALTER TABLE rta_staging_economic_txns ADD COLUMN IF NOT EXISTS posted_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rta_staging_econ_posting_outcome_ck') THEN
    ALTER TABLE rta_staging_economic_txns ADD CONSTRAINT rta_staging_econ_posting_outcome_ck
      CHECK (posting_outcome IS NULL OR posting_outcome IN (
        'posted', 'matched_existing', 'rejected_recorded', 'already_posted', 'duplicate',
        'quarantined', 'unsupported', 'correction_held', 'held_dependent', 'blocked')) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rta_posted_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  -- The registrar's identity (kfin.v1:<Fund>:<No> / cams.v1:<amc>:<No>) — never a row number.
  identity_key      text NOT NULL,
  economic_txn_id   uuid NOT NULL,
  batch_id          uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('posted_new', 'matched_existing', 'rejected_recorded')),
  -- The CRM record it became (or matched). A purged client's transaction
  -- leaves the ledger row, so a re-import never re-creates it silently.
  transaction_id    uuid REFERENCES transactions(id) ON DELETE SET NULL,
  sip_rejection_id  uuid REFERENCES sip_rejections(id) ON DELETE SET NULL,
  posted_at         timestamptz NOT NULL DEFAULT now(),
  posted_by         uuid,
  CONSTRAINT rta_posted_econ_fk FOREIGN KEY (tenant_id, economic_txn_id) REFERENCES rta_staging_economic_txns (tenant_id, id),
  CONSTRAINT rta_posted_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES rta_staging_batches (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS rta_posted_identity_uidx ON rta_posted_transactions (tenant_id, identity_key);
CREATE INDEX IF NOT EXISTS rta_posted_txn_idx ON rta_posted_transactions (tenant_id, transaction_id);
ALTER TABLE rta_posted_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_posted_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_posted_transactions;
CREATE POLICY tenant_isolation ON rta_posted_transactions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

CREATE TABLE IF NOT EXISTS rta_sip_registrations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  registration_key            text NOT NULL,
  rta                         text NOT NULL CHECK (rta IN ('cams', 'kfintech')),
  amc_code                    text,
  registration_id             text,
  investor_id                 uuid REFERENCES investors(id) ON DELETE SET NULL,
  folio_id                    uuid REFERENCES folios(id) ON DELETE SET NULL,
  folio_number                text,
  scheme_code                 text,
  target_scheme_code          text,
  kind                        text NOT NULL CHECK (kind IN ('sip', 'stp', 'swp', 'other', 'unknown')),
  amount                      numeric(18, 2),
  frequency                   text,
  start_date                  date,
  end_date                    date,
  state                       text NOT NULL CHECK (state IN ('VERIFIED_ACTIVE', 'OBSERVED_ACTIVITY', 'PENDING', 'PAUSED', 'STOPPED', 'EXPIRED', 'REJECTED', 'UNKNOWN')),
  state_basis                 text,
  status_effective_date       date,
  last_successful_instalment  date,
  described                   boolean NOT NULL,
  confidence                  text NOT NULL CHECK (confidence IN ('verified', 'partial', 'unverified')),
  lifecycle_events            jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The CRM SIP it was posted to (or matched), when its state is verified.
  sip_id                      uuid REFERENCES sips(id) ON DELETE SET NULL,
  as_of                       date NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
-- Posting reads a transaction's staged rows by economic transaction (first
-- row's facts, row dispositions); without this every lookup scans the batch.
CREATE INDEX IF NOT EXISTS rta_staging_rows_econ_idx ON rta_staging_rows (tenant_id, economic_txn_id);

CREATE UNIQUE INDEX IF NOT EXISTS rta_sip_registrations_key_uidx ON rta_sip_registrations (tenant_id, registration_key);
CREATE INDEX IF NOT EXISTS rta_sip_registrations_state_idx ON rta_sip_registrations (tenant_id, state);
ALTER TABLE rta_sip_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_sip_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_sip_registrations;
CREATE POLICY tenant_isolation ON rta_sip_registrations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
