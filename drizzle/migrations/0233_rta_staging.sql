-- 0233 — RTA staging (Phase 3B): a traceable, tenant-isolated record of every
-- source row of every RTA mailback file, what it normalizes to, who it matches,
-- which registrar transaction it belongs to, and why it ended where it did.
--
-- SHADOW ONLY. Nothing here writes to investors / folios / transactions / sips
-- or any other financial table; the pipeline that fills these tables
-- (src/lib/rta/staging) runs only when RTA_PIPELINE_MODE=shadow. Posting to
-- financial tables is a later, separately approved phase.
--
-- Additive only: five new tables plus one new unique index on rta_file_imports
-- (tenant_id, id) so staging can reference an import with a tenant-scoped key.
-- No existing column, constraint or row changes.
--
-- Tenant integrity is structural, not just policy: every relationship between
-- these tables is a composite (tenant_id, id) foreign key, so a row can never
-- point at another firm's batch / row / transaction even through a bug that
-- bypasses RLS. RLS (ENABLE + FORCE + tenant_isolation) is on every table.
--
-- References to live CRM rows (matched investor / folio, a legacy transaction a
-- proposed posting would adopt) are SOFT (no FK): shadow results are proposals
-- and must never block, cascade from or lock a financial record.
--
-- Rollback (non-destructive): set RTA_PIPELINE_MODE=off — nothing reads these
-- tables for business figures. Dropping them is a separate, signed-off step
-- after any audit export, never part of a rollback.

CREATE UNIQUE INDEX IF NOT EXISTS rta_file_imports_tenant_id_uidx ON rta_file_imports (tenant_id, id);

-- ── Batches: one per file processed by the pipeline ─────────────────────────
CREATE TABLE IF NOT EXISTS rta_staging_batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  import_id              uuid,
  mode                   text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow')),
  rta                    text CHECK (rta IN ('cams', 'kfintech')),
  report_code            text,
  record_kind            text CHECK (record_kind IN ('transaction', 'holding', 'master')),
  file_name              text NOT NULL,
  file_ref               text NOT NULL,
  file_checksum          text NOT NULL,
  file_size_bytes        bigint,
  parser_version         text NOT NULL,
  identity_scheme        text,
  state                  text NOT NULL DEFAULT 'uploaded' CHECK (state IN
                           ('uploaded', 'identified', 'parsed', 'validated', 'matched', 'reconciled',
                            'ready_to_commit', 'exception', 'failed')),
  attempt                integer NOT NULL DEFAULT 0,
  lease_owner            text,
  lease_until            timestamptz,
  rerun_of_batch_id      uuid,
  same_file_as_batch_id  uuid,
  as_of_date             date,
  period_start           date,
  period_end             date,
  row_count              integer,
  counts                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage_log              jsonb NOT NULL DEFAULT '[]'::jsonb,
  error                  text,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  CONSTRAINT rta_staging_batches_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT rta_staging_batches_import_fk FOREIGN KEY (tenant_id, import_id)
    REFERENCES rta_file_imports (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT rta_staging_batches_rerun_fk FOREIGN KEY (tenant_id, rerun_of_batch_id)
    REFERENCES rta_staging_batches (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT rta_staging_batches_same_file_fk FOREIGN KEY (tenant_id, same_file_as_batch_id)
    REFERENCES rta_staging_batches (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS rta_staging_batches_checksum_idx ON rta_staging_batches (tenant_id, file_checksum, created_at);
CREATE INDEX IF NOT EXISTS rta_staging_batches_state_idx ON rta_staging_batches (tenant_id, state);
CREATE INDEX IF NOT EXISTS rta_staging_batches_import_idx ON rta_staging_batches (tenant_id, import_id);

-- ── Economic transactions: one registrar transaction, proposed ──────────────
CREATE TABLE IF NOT EXISTS rta_staging_economic_txns (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  batch_id               uuid NOT NULL,
  identity_scheme        text NOT NULL,
  identity_key           text NOT NULL,
  rta                    text NOT NULL,
  amc_code               text,
  folio_number           text,
  scheme_code            text,
  registrar_txn_no       text NOT NULL,
  trade_date             date,
  rta_class              text NOT NULL,
  class_confidence       text NOT NULL DEFAULT 'verified' CHECK (class_confidence IN ('verified', 'inferred')),
  direction              text CHECK (direction IN ('inflow', 'outflow')),
  status                 text NOT NULL CHECK (status IN ('complete', 'quarantined', 'duplicate', 'restated', 'conflict')),
  reason                 text,
  row_count              integer NOT NULL,
  lot_count              integer NOT NULL DEFAULT 0,
  -- As the registrar reported them (sums of the source rows):
  reported_units         numeric,
  reported_amount        numeric,
  reported_nav           numeric,
  reported_exit_load     numeric,
  reported_stt           numeric,
  reported_stamp_duty    numeric,
  -- Derived by the pipeline, never written over a reported figure:
  derived_gross_amount   numeric,
  arithmetic_delta       numeric,
  arithmetic_tolerance   numeric,
  invariant_hash         text NOT NULL,
  lot_signature          text NOT NULL,
  duplicate_of_id        uuid,
  match_investor_id      uuid,
  match_folio_id         uuid,
  match_rule             text,
  proposed_action        text NOT NULL CHECK (proposed_action IN
                           ('post_new', 'adopt_legacy', 'legacy_conflict', 'unmatched', 'none')),
  legacy_transaction_id  uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rta_staging_econ_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT rta_staging_econ_batch_key_uq UNIQUE (batch_id, identity_key),
  CONSTRAINT rta_staging_econ_batch_fk FOREIGN KEY (tenant_id, batch_id)
    REFERENCES rta_staging_batches (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT rta_staging_econ_duplicate_fk FOREIGN KEY (tenant_id, duplicate_of_id)
    REFERENCES rta_staging_economic_txns (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS rta_staging_econ_identity_idx ON rta_staging_economic_txns (tenant_id, identity_key, created_at);
CREATE INDEX IF NOT EXISTS rta_staging_econ_batch_status_idx ON rta_staging_economic_txns (tenant_id, batch_id, status);

-- ── Source rows: every row of every file, exactly once per batch ────────────
CREATE TABLE IF NOT EXISTS rta_staging_rows (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  batch_id               uuid NOT NULL,
  row_no                 integer NOT NULL,
  row_hash               text NOT NULL,
  record_kind            text NOT NULL CHECK (record_kind IN ('transaction', 'holding', 'master')),
  state                  text NOT NULL CHECK (state IN
                           ('parsed', 'invalid', 'validated', 'matched', 'unmatched', 'ambiguous',
                            'grouped', 'staged', 'staged_as_part', 'duplicate', 'quarantined', 'rejected')),
  rta_class              text,
  class_confidence       text,
  registrar_txn_no       text,
  economic_key           text,
  economic_txn_id        uuid,
  amc_code               text,
  folio_number           text,
  scheme_code            text,
  isin                   text,
  trade_date             date,
  as_of_date             date,
  units                  numeric,
  amount                 numeric,
  nav                    numeric,
  price                  numeric,
  load_amount            numeric,
  stt                    numeric,
  stamp_duty             numeric,
  holding_value          numeric,
  pan_token              text,
  guardian_pan_token     text,
  match_investor_id      uuid,
  match_folio_id         uuid,
  match_rule             text,
  attrs                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation             jsonb NOT NULL DEFAULT '{}'::jsonb,
  disposition            text,
  reason                 text,
  exception_code         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rta_staging_rows_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT rta_staging_rows_batch_row_uq UNIQUE (batch_id, row_no),
  CONSTRAINT rta_staging_rows_batch_fk FOREIGN KEY (tenant_id, batch_id)
    REFERENCES rta_staging_batches (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT rta_staging_rows_econ_fk FOREIGN KEY (tenant_id, economic_txn_id)
    REFERENCES rta_staging_economic_txns (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS rta_staging_rows_batch_state_idx ON rta_staging_rows (tenant_id, batch_id, state);
CREATE INDEX IF NOT EXISTS rta_staging_rows_key_idx ON rta_staging_rows (tenant_id, economic_key);
CREATE INDEX IF NOT EXISTS rta_staging_rows_hash_idx ON rta_staging_rows (tenant_id, row_hash);
CREATE INDEX IF NOT EXISTS rta_staging_rows_exception_idx ON rta_staging_rows (tenant_id, exception_code) WHERE exception_code IS NOT NULL;

-- ── Redemption lots: one per source lot row, never merged ───────────────────
CREATE TABLE IF NOT EXISTS rta_staging_lots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  economic_txn_id        uuid NOT NULL,
  row_id                 uuid NOT NULL,
  registrar_lot_id       text,
  lot_part               smallint NOT NULL DEFAULT 1,
  purchase_txn_no        text,
  purchase_date          date,
  purchase_units         numeric,
  purchase_amount        numeric,
  units                  numeric,
  amount                 numeric,
  price                  numeric,
  nav                    numeric,
  load_amount            numeric,
  stt                    numeric,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rta_staging_lots_row_uq UNIQUE (tenant_id, row_id),
  CONSTRAINT rta_staging_lots_econ_fk FOREIGN KEY (tenant_id, economic_txn_id)
    REFERENCES rta_staging_economic_txns (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT rta_staging_lots_row_fk FOREIGN KEY (tenant_id, row_id)
    REFERENCES rta_staging_rows (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS rta_staging_lots_econ_idx ON rta_staging_lots (tenant_id, economic_txn_id);

-- ── Reconciliation checks: pass / fail / unverified, per batch ──────────────
CREATE TABLE IF NOT EXISTS rta_staging_checks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  batch_id               uuid NOT NULL,
  check_code             text NOT NULL,
  scope                  text NOT NULL,
  scope_ref              text NOT NULL DEFAULT '',
  status                 text NOT NULL CHECK (status IN ('pass', 'fail', 'unverified')),
  expected               text,
  actual                 text,
  tolerance              text,
  detail                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rta_staging_checks_uq UNIQUE (batch_id, check_code, scope, scope_ref),
  CONSTRAINT rta_staging_checks_batch_fk FOREIGN KEY (tenant_id, batch_id)
    REFERENCES rta_staging_batches (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS rta_staging_checks_batch_idx ON rta_staging_checks (tenant_id, batch_id, status);

-- ── Row-level security on every staging table ──────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rta_staging_batches', 'rta_staging_economic_txns', 'rta_staging_rows', 'rta_staging_lots', 'rta_staging_checks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')$p$, t);
  END LOOP;
END $$;
