-- 0243 — two-person control requests, report-type scope, cancelled imports
--        (final pilot security and data-integrity patch, 2026-10-09)
--
-- A FORWARD migration. Before it, a two-person start (activation, release of
-- a kill switch, reversal, undo) trusted a requester id the caller supplied,
-- and the operator CLI trusted both ids. Now:
--
--   rta_control_requests  one immutable request per action, made by an
--       authenticated operator (their user id AND live session id), with its
--       action, firm, scope, payload, change reference, reason and expiry. The
--       server computes payload_hash. It is decided once: executed by a
--       DIFFERENT authenticated operator, or rejected / cancelled.
--       Executing re-checks, in the database, that both people are active
--       platform_admin users with two-factor authentication, that the
--       approver's session is live and the requester's existed, and that the
--       request has not expired.
--   Backstop triggers  an activation that starts a mode, a kill-switch
--       release, a reversal and an undo are REFUSED unless they cite a
--       request of the matching action that was executed in this very
--       transaction (decided_at = now()) and whose people and payload match
--       the row — a request cannot be replayed into a later transaction or a
--       different action, firm or scope.
--   report_codes  the report types an activation covers (the pilot:
--       MFSD211, MFSD201). Required by the application with posting.
--   rta_file_imports  who cancelled a parked import, when and why.
--
-- Lock risk: new table; nullable columns without defaults (catalogue-only);
-- function and trigger replacements.

SET LOCAL lock_timeout = '5s';

-- ── A. Requests ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rta_control_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  tenant_id     uuid REFERENCES tenants(id),
  scope         text NOT NULL,
  payload       jsonb NOT NULL,
  payload_hash  text NOT NULL,
  change_ref    text NOT NULL,
  reason        text NOT NULL,
  requested_by  uuid NOT NULL REFERENCES users(id),
  requester_sid text NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  approved_by   uuid REFERENCES users(id),
  approver_sid  text,
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  decision_note text,
  result        jsonb,
  CONSTRAINT rta_control_requests_action_ck CHECK (action IN ('activate', 'release', 'reverse', 'undo', 'approve_scheme_mapping', 'approve_amc_identity')),
  CONSTRAINT rta_control_requests_status_ck CHECK (status IN ('pending', 'executed', 'rejected', 'cancelled')),
  CONSTRAINT rta_control_requests_ref_ck CHECK (length(btrim(change_ref)) >= 3),
  CONSTRAINT rta_control_requests_reason_ck CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT rta_control_requests_expiry_ck CHECK (expires_at > requested_at AND expires_at <= requested_at + interval '24 hours'),
  CONSTRAINT rta_control_requests_two_person_ck CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT rta_control_requests_executed_ck CHECK (status <> 'executed' OR (approved_by IS NOT NULL AND approver_sid IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT rta_control_requests_decided_ck CHECK (status = 'pending' OR decided_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS rta_control_requests_status_idx ON rta_control_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS rta_control_requests_tenant_idx ON rta_control_requests (tenant_id, requested_at DESC);
ALTER TABLE rta_control_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_control_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_control_requests;
CREATE POLICY tenant_isolation ON rta_control_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- An active platform_admin with two-factor authentication on, holding the
-- given session (live, when p_live). Reads under the caller's RLS: run outside
-- a platform-admin transaction it sees nobody, so every check fails closed.
CREATE OR REPLACE FUNCTION rta_operator_ok(p_user uuid, p_sid text, p_live boolean) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.status = 'active' AND u.roles && ARRAY['platform_admin']::text[] AND coalesce(u.two_fa_enabled, false))
     AND EXISTS (SELECT 1 FROM user_sessions s WHERE s.session_id = p_sid AND s.user_id = p_user AND (NOT p_live OR s.revoked_at IS NULL))
$fn$;

CREATE OR REPLACE FUNCTION rta_control_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rta_control_requests rows are never deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.approved_by IS NOT NULL OR NEW.approver_sid IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL THEN
      RAISE EXCEPTION 'a control request starts pending and undecided' USING ERRCODE = '42501';
    END IF;
    IF NOT rta_operator_ok(NEW.requested_by, NEW.requester_sid, true) THEN
      RAISE EXCEPTION 'the requester is not an active two-factor platform operator with a live session' USING ERRCODE = '42501';
    END IF;
    NEW.requested_at := now();
    -- The server's hash of everything the approver is asked to approve.
    NEW.payload_hash := encode(sha256(convert_to(concat_ws('|', NEW.action, NEW.scope, coalesce(NEW.tenant_id::text, ''), NEW.change_ref, NEW.reason,
                         to_char(NEW.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), NEW.payload::text), 'UTF8')), 'hex');
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    -- The one write after the decision: the executed action's result, in the
    -- same transaction, once.
    IF OLD.status = 'executed' AND OLD.result IS NULL AND NEW.result IS NOT NULL AND OLD.decided_at = now()
       AND (to_jsonb(NEW) - 'result') = (to_jsonb(OLD) - 'result') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a decided control request is final' USING ERRCODE = '55000';
  END IF;
  IF NEW.action IS DISTINCT FROM OLD.action OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash OR NEW.change_ref IS DISTINCT FROM OLD.change_ref
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requester_sid IS DISTINCT FROM OLD.requester_sid
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'a control request is immutable; only its decision is recorded' USING ERRCODE = '55000';
  END IF;
  IF NEW.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'a decision is recorded at the time it is made' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'executed' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by THEN
      RAISE EXCEPTION 'a control request is approved by a DIFFERENT operator' USING ERRCODE = '42501';
    END IF;
    IF now() > OLD.expires_at THEN
      RAISE EXCEPTION 'this control request expired at %', OLD.expires_at USING ERRCODE = '42501';
    END IF;
    IF NOT rta_operator_ok(NEW.approved_by, NEW.approver_sid, true) THEN
      RAISE EXCEPTION 'the approver is not an active two-factor platform operator with a live session' USING ERRCODE = '42501';
    END IF;
    IF NOT rta_operator_ok(NEW.requested_by, NEW.requester_sid, false) THEN
      RAISE EXCEPTION 'the requester is no longer an active two-factor platform operator' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    IF NEW.decided_by IS NULL OR NEW.approved_by IS NOT NULL THEN
      RAISE EXCEPTION 'a rejection or cancellation names who decided it and approves nothing' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'a pending request can only be executed, rejected or cancelled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_control_requests_guard ON rta_control_requests;
CREATE TRIGGER rta_control_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON rta_control_requests
  FOR EACH ROW EXECUTE FUNCTION rta_control_requests_guard();

-- The request a guarded row cites: of this action, executed in THIS transaction.
CREATE OR REPLACE FUNCTION rta_request_executed_now(p_id uuid, p_action text) RETURNS rta_control_requests LANGUAGE plpgsql AS $fn$
DECLARE r rta_control_requests;
BEGIN
  IF p_id IS NOT NULL THEN SELECT * INTO r FROM rta_control_requests WHERE id = p_id; END IF;
  IF p_id IS NULL OR r.id IS NULL OR r.action <> p_action OR r.status <> 'executed' OR r.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION '% needs a two-person control request approved in this same transaction', p_action USING ERRCODE = '42501';
  END IF;
  RETURN r;
END
$fn$;

-- ── B. Activations: report-type scope + the request backstop ─────────────
ALTER TABLE rta_pipeline_activations ADD COLUMN IF NOT EXISTS report_codes text[];
ALTER TABLE rta_pipeline_activations ADD COLUMN IF NOT EXISTS control_request_id uuid REFERENCES rta_control_requests(id);
ALTER TABLE rta_pipeline_activations DROP CONSTRAINT IF EXISTS rta_pipeline_activations_report_codes_ck;
ALTER TABLE rta_pipeline_activations ADD CONSTRAINT rta_pipeline_activations_report_codes_ck
  CHECK (report_codes IS NULL OR (cardinality(report_codes) > 0
    AND report_codes <@ ARRAY['MFSD201', 'MFSD211', 'MFSD203', 'MFSD243', 'MFSD230', 'R2', 'R9', 'WBR4', 'WBR10', 'WBR49']::text[]));
CREATE UNIQUE INDEX IF NOT EXISTS rta_pipeline_activations_request_uniq ON rta_pipeline_activations (control_request_id) WHERE control_request_id IS NOT NULL;

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
     OR NEW.registrars IS DISTINCT FROM OLD.registrars OR NEW.report_codes IS DISTINCT FROM OLD.report_codes
     OR NEW.control_request_id IS DISTINCT FROM OLD.control_request_id THEN
    RAISE EXCEPTION 'rta_pipeline_activations: an activation is revoked once and otherwise never edited' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION rta_pipeline_activations_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE r rta_control_requests;
BEGIN
  -- One operator may pause (stop); every other mode is a start and needs the request.
  IF NEW.mode = 'paused' THEN RETURN NEW; END IF;
  r := rta_request_executed_now(NEW.control_request_id, 'activate');
  IF r.tenant_id IS DISTINCT FROM NEW.tenant_id OR r.requested_by IS DISTINCT FROM NEW.requested_by OR r.approved_by IS DISTINCT FROM NEW.approved_by
     OR r.change_ref IS DISTINCT FROM NEW.approval_ref OR r.reason IS DISTINCT FROM NEW.reason
     OR (r.payload->>'mode') IS DISTINCT FROM NEW.mode
     OR (r.payload->>'postingEnabled')::boolean IS DISTINCT FROM NEW.posting_enabled
     OR coalesce(r.payload->'registrars', 'null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(NEW.registrars), 'null'::jsonb)
     OR coalesce(r.payload->'reportCodes', 'null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(NEW.report_codes), 'null'::jsonb)
     OR (r.payload->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at THEN
    RAISE EXCEPTION 'the activation does not match the control request it cites' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_pipeline_activations_request_guard ON rta_pipeline_activations;
CREATE TRIGGER rta_pipeline_activations_request_guard BEFORE INSERT ON rta_pipeline_activations
  FOR EACH ROW EXECUTE FUNCTION rta_pipeline_activations_request_guard();

-- ── C. Kill switch: a release cites its request ───────────────────────────
ALTER TABLE rta_posting_controls ADD COLUMN IF NOT EXISTS control_request_id uuid REFERENCES rta_control_requests(id);
ALTER TABLE rta_posting_control_events ADD COLUMN IF NOT EXISTS control_request_id uuid REFERENCES rta_control_requests(id);
-- Who stopped it, as the server knew them: 'session' (signed-in operator), 'cli' (named on a command line, not verified).
ALTER TABLE rta_posting_control_events ADD COLUMN IF NOT EXISTS actor_source text;

CREATE OR REPLACE FUNCTION rta_posting_controls_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE r rta_control_requests;
BEGIN
  IF NEW.posting_halted THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT OLD.posting_halted AND NEW.control_request_id IS NOT DISTINCT FROM OLD.control_request_id
     AND NEW.changed_by IS NOT DISTINCT FROM OLD.changed_by AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by THEN
    RETURN NEW;  -- no change of state or of who released it
  END IF;
  r := rta_request_executed_now(NEW.control_request_id, 'release');
  IF r.scope IS DISTINCT FROM NEW.scope OR r.requested_by IS DISTINCT FROM NEW.changed_by OR r.approved_by IS DISTINCT FROM NEW.approved_by THEN
    RAISE EXCEPTION 'the release does not match the control request it cites' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_posting_controls_request_guard ON rta_posting_controls;
CREATE TRIGGER rta_posting_controls_request_guard BEFORE INSERT OR UPDATE ON rta_posting_controls
  FOR EACH ROW EXECUTE FUNCTION rta_posting_controls_request_guard();

-- ── D. Reversal and undo cite their requests ──────────────────────────────
ALTER TABLE rta_posting_reversals ADD COLUMN IF NOT EXISTS control_request_id uuid REFERENCES rta_control_requests(id);
ALTER TABLE rta_posting_reversals ADD COLUMN IF NOT EXISTS undo_request_id uuid REFERENCES rta_control_requests(id);
CREATE UNIQUE INDEX IF NOT EXISTS rta_posting_reversals_request_uniq ON rta_posting_reversals (control_request_id) WHERE control_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rta_posting_reversals_undo_request_uniq ON rta_posting_reversals (undo_request_id) WHERE undo_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION rta_posting_reversals_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rta_posting_reversals rows are kept' USING ERRCODE = '55000'; END IF;
  IF OLD.undone_at IS NOT NULL OR NEW.archived IS DISTINCT FROM OLD.archived OR NEW.counts IS DISTINCT FROM OLD.counts
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
     OR NEW.control_request_id IS DISTINCT FROM OLD.control_request_id THEN
    RAISE EXCEPTION 'rta_posting_reversals: only a single undo is recorded' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION rta_posting_reversals_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE r rta_control_requests;
BEGIN
  IF TG_OP = 'INSERT' THEN
    r := rta_request_executed_now(NEW.control_request_id, 'reverse');
    IF r.tenant_id IS DISTINCT FROM NEW.tenant_id OR (r.payload->>'batchId')::uuid IS DISTINCT FROM NEW.batch_id
       OR r.requested_by IS DISTINCT FROM NEW.requested_by OR r.approved_by IS DISTINCT FROM NEW.approved_by THEN
      RAISE EXCEPTION 'the reversal does not match the control request it cites' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL THEN
    r := rta_request_executed_now(NEW.undo_request_id, 'undo');
    IF r.tenant_id IS DISTINCT FROM NEW.tenant_id OR (r.payload->>'reversalId')::uuid IS DISTINCT FROM NEW.id OR r.approved_by IS DISTINCT FROM NEW.undone_by THEN
      RAISE EXCEPTION 'the undo does not match the control request it cites' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_posting_reversals_request_guard ON rta_posting_reversals;
CREATE TRIGGER rta_posting_reversals_request_guard BEFORE INSERT OR UPDATE ON rta_posting_reversals
  FOR EACH ROW EXECUTE FUNCTION rta_posting_reversals_request_guard();

-- ── E. A parked import an operator cancelled ──────────────────────────────
ALTER TABLE rta_file_imports ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE rta_file_imports ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE rta_file_imports ADD COLUMN IF NOT EXISTS cancel_reason text;

-- A cancellation is final: a cancelled import never changes status again (a
-- worker retry, a delayed job or a re-queue cannot resume it), and a
-- cancellation always says who, when and why.
CREATE OR REPLACE FUNCTION rta_file_imports_cancel_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status = 'cancelled' AND (NEW.status IS DISTINCT FROM 'cancelled' OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'a cancelled RTA import is final — upload an approved file again instead' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND (NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL OR length(btrim(coalesce(NEW.cancel_reason, ''))) < 10) THEN
    RAISE EXCEPTION 'cancelling an RTA import records who, when and why' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rta_file_imports_cancel_guard ON rta_file_imports;
CREATE TRIGGER rta_file_imports_cancel_guard BEFORE UPDATE ON rta_file_imports
  FOR EACH ROW EXECUTE FUNCTION rta_file_imports_cancel_guard();
