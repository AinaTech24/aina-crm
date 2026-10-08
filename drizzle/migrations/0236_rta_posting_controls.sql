-- Phase 3G — production-capable controls for validate-first RTA posting.
-- NOT applied to production. Three things:
--
--   1. rta_posting_controls: the kill switch. One row per scope — 'global'
--      (every firm) or a tenant id (one firm). Posting runs only when BOTH the
--      global row and the firm's row (if any) are released. The global row is
--      installed HALTED: a fresh install cannot post until two people release
--      it. Posting reads the rows FOR SHARE inside its own transaction, so
--      halting waits for in-flight batches and every later batch sees it.
--   2. rta_pipeline_activations: per-firm activation, append-only. The current
--      row (latest, effective, unexpired, unrevoked) decides the firm's mode:
--      off · shadow · validate_first. Posting additionally needs
--      posting_enabled, which needs a requester and a DIFFERENT approver.
--      No row = off. Rows are never edited except to revoke them once.
--   3. rta_staging_economic_txns.posting_history: every outcome a registrar
--      transaction has had (held, re-evaluated, posted), oldest first, so a
--      later promotion never erases why it was held.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS rta_posting_controls (
  scope          text PRIMARY KEY,
  posting_halted boolean NOT NULL,
  reason         text NOT NULL,
  changed_by     uuid,
  approved_by    uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rta_posting_controls_scope_ck CHECK (scope = 'global' OR scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- Releasing needs two people; halting needs one.
  CONSTRAINT rta_posting_controls_release_ck CHECK (posting_halted OR (changed_by IS NOT NULL AND approved_by IS NOT NULL AND changed_by <> approved_by))
);
INSERT INTO rta_posting_controls (scope, posting_halted, reason)
VALUES ('global', true, 'installed halted — posting needs an explicit two-person release')
ON CONFLICT (scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS rta_posting_control_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          text NOT NULL,
  posting_halted boolean NOT NULL,
  reason         text NOT NULL,
  changed_by     uuid,
  approved_by    uuid,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rta_posting_control_events_scope_idx ON rta_posting_control_events (scope, at DESC);

CREATE OR REPLACE FUNCTION rta_posting_control_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'rta_posting_control_events is append-only' USING ERRCODE = '55000';
END
$fn$;
DROP TRIGGER IF EXISTS rta_posting_control_events_immutable ON rta_posting_control_events;
CREATE TRIGGER rta_posting_control_events_immutable BEFORE UPDATE OR DELETE ON rta_posting_control_events
  FOR EACH ROW EXECUTE FUNCTION rta_posting_control_events_immutable();

CREATE TABLE IF NOT EXISTS rta_pipeline_activations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  mode            text NOT NULL,
  posting_enabled boolean NOT NULL DEFAULT false,
  reason          text NOT NULL,
  approval_ref    text,
  requested_by    uuid,
  approved_by     uuid NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid,
  revoke_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rta_pipeline_activations_mode_ck CHECK (mode IN ('off', 'shadow', 'validate_first')),
  CONSTRAINT rta_pipeline_activations_reason_ck CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT rta_pipeline_activations_posting_mode_ck CHECK (NOT posting_enabled OR mode = 'validate_first'),
  CONSTRAINT rta_pipeline_activations_two_person_ck CHECK (NOT posting_enabled OR (requested_by IS NOT NULL AND requested_by <> approved_by)),
  CONSTRAINT rta_pipeline_activations_expiry_ck CHECK (expires_at IS NULL OR expires_at > effective_from),
  CONSTRAINT rta_pipeline_activations_revoke_ck CHECK (revoked_at IS NULL OR (revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 5))
);
CREATE INDEX IF NOT EXISTS rta_pipeline_activations_tenant_idx ON rta_pipeline_activations (tenant_id, created_at DESC);
ALTER TABLE rta_pipeline_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_pipeline_activations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_pipeline_activations;
CREATE POLICY tenant_isolation ON rta_pipeline_activations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- An activation is decided once; the only later change is a single revocation.
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
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rta_pipeline_activations: an activation is revoked once and otherwise never edited' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_pipeline_activations_append_only ON rta_pipeline_activations;
CREATE TRIGGER rta_pipeline_activations_append_only BEFORE UPDATE OR DELETE ON rta_pipeline_activations
  FOR EACH ROW EXECUTE FUNCTION rta_pipeline_activations_append_only();

-- Constant default: a catalogue-only change in Postgres 11+, no table rewrite.
ALTER TABLE rta_staging_economic_txns ADD COLUMN IF NOT EXISTS posting_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The distributor code (ARN) a registration is reported under, when the report
-- states one (MFSD243 AgentCode, MFSD230 Agent; WBR49 carries none). Nullable,
-- no default: catalogue-only.
ALTER TABLE rta_sip_registrations ADD COLUMN IF NOT EXISTS arn text;

-- Recovery of an incorrect posting batch (Phase 3G): the CRM rows a batch
-- wrote are archived WHOLE (transactions, SIP rejections, business-entry
-- matches, ledger rows) in one append-only reversal record, then removed; an
-- undo re-inserts them from that record. A reversal needs two people, like a
-- release. A feature flag stops future writes; this undoes past ones.
ALTER TABLE rta_staging_batches DROP CONSTRAINT IF EXISTS rta_staging_batches_posting_state_ck;
ALTER TABLE rta_staging_batches ADD CONSTRAINT rta_staging_batches_posting_state_ck
  CHECK (posting_state IN ('not_posted', 'posted', 'partially_posted', 'blocked', 'nothing_to_post', 'reversed')) NOT VALID;
ALTER TABLE rta_staging_economic_txns DROP CONSTRAINT IF EXISTS rta_staging_econ_posting_outcome_ck;
ALTER TABLE rta_staging_economic_txns ADD CONSTRAINT rta_staging_econ_posting_outcome_ck
  CHECK (posting_outcome IS NULL OR posting_outcome IN (
    'posted', 'matched_existing', 'rejected_recorded', 'already_posted', 'duplicate',
    'quarantined', 'unsupported', 'correction_held', 'held_dependent', 'blocked', 'reversed')) NOT VALID;

CREATE TABLE IF NOT EXISTS rta_posting_reversals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  batch_id      uuid NOT NULL,
  reason        text NOT NULL,
  requested_by  uuid NOT NULL,
  approved_by   uuid NOT NULL,
  -- Every row removed, exactly as it was: { transactions: [...], sip_rejections: [...], business_entry_rta_matches: [...], ledger: [...] }
  archived      jsonb NOT NULL,
  counts        jsonb NOT NULL,
  reversed_at   timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by     uuid,
  CONSTRAINT rta_posting_reversals_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES rta_staging_batches (tenant_id, id),
  CONSTRAINT rta_posting_reversals_two_person_ck CHECK (requested_by <> approved_by),
  CONSTRAINT rta_posting_reversals_reason_ck CHECK (length(btrim(reason)) >= 10)
);
CREATE INDEX IF NOT EXISTS rta_posting_reversals_batch_idx ON rta_posting_reversals (tenant_id, batch_id);
ALTER TABLE rta_posting_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_posting_reversals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_posting_reversals;
CREATE POLICY tenant_isolation ON rta_posting_reversals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
CREATE OR REPLACE FUNCTION rta_posting_reversals_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rta_posting_reversals rows are kept' USING ERRCODE = '55000'; END IF;
  IF OLD.undone_at IS NOT NULL OR NEW.archived IS DISTINCT FROM OLD.archived OR NEW.counts IS DISTINCT FROM OLD.counts
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    RAISE EXCEPTION 'rta_posting_reversals: only a single undo is recorded' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_posting_reversals_append_only ON rta_posting_reversals;
CREATE TRIGGER rta_posting_reversals_append_only BEFORE UPDATE OR DELETE ON rta_posting_reversals
  FOR EACH ROW EXECUTE FUNCTION rta_posting_reversals_append_only();
