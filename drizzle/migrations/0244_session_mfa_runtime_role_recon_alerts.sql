-- 0244 — final security patch before the production preflight.
--
-- A. MFA on the SESSION, not the profile.
--    user_sessions records how each session was authenticated and when its
--    second factor was verified. Only a session created by a completed TOTP /
--    backup-code challenge (sign-in or step-up) carries mfa_verified_at; a
--    password-reset, sign-up, invite or re-issued session never does. A change
--    to a user's two-factor or password state downgrades every session they
--    hold. rta_operator_ok (used by every two-person control request, 0243)
--    now requires a live session whose MFA is verified, current (≤ 12 hours)
--    and newer than the user's last security change.
--
-- B. Reconciliation runs and operational alerts.
--    rta_reconciliation_runs / _run_firms record every scheduled run (slot in
--    Asia/Kolkata, start, heartbeat, completion, outcome) per firm.
--    ops_alerts persists an alert until a person acknowledges it: bounded,
--    deduplicated delivery attempts (ops_alert_deliveries, append-only),
--    escalation, and acknowledgement. No PAN, client detail or secret is ever
--    stored in an alert: summaries and counts only.
--
-- Forward-only; touches no financial row.

SET LOCAL lock_timeout = '5s';

-- ── A. Session MFA ──────────────────────────────────────────────────────────
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS auth_method text;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_changed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_auth_method_ck CHECK (auth_method IS NULL OR auth_method IN
    ('password', 'password_totp', 'password_backup_code', 'step_up_totp', 'step_up_backup_code', 'password_reset', 'signup', 'invite', 'reissue'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A session's MFA is set only when the session is created by a completed
-- second-factor challenge, for a user with two-factor on, at "now". It can be
-- cleared later (a downgrade) but never raised or back-dated by an UPDATE.
CREATE OR REPLACE FUNCTION user_sessions_mfa_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.mfa_verified_at IS NOT NULL THEN
      IF coalesce(NEW.auth_method, '') NOT IN ('password_totp', 'password_backup_code', 'step_up_totp', 'step_up_backup_code') THEN
        RAISE EXCEPTION 'a session is MFA-verified only when created by a completed second-factor challenge' USING ERRCODE = '42501';
      END IF;
      IF NEW.mfa_verified_at < now() - interval '1 minute' OR NEW.mfa_verified_at > now() + interval '1 minute' THEN
        RAISE EXCEPTION 'a session''s MFA time is the time it was verified' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND coalesce(u.two_fa_enabled, false)) THEN
        RAISE EXCEPTION 'a session cannot be MFA-verified for a user without two-factor authentication' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.mfa_verified_at IS DISTINCT FROM OLD.mfa_verified_at AND NEW.mfa_verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'a session''s MFA can be cleared, never raised — sign in again or step up' USING ERRCODE = '42501';
  END IF;
  IF NEW.auth_method IS DISTINCT FROM OLD.auth_method THEN
    RAISE EXCEPTION 'a session''s authentication method never changes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS user_sessions_mfa_guard ON user_sessions;
CREATE TRIGGER user_sessions_mfa_guard BEFORE INSERT OR UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION user_sessions_mfa_guard();

-- A security change (two-factor enabled / disabled / re-enrolled, password
-- changed or reset, sessions revoked) stamps mfa_changed_at and downgrades
-- every session of the user: none of them is MFA-verified any more.
CREATE OR REPLACE FUNCTION users_security_change_stamp() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.mfa_changed_at := now();
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS users_security_change_stamp ON users;
CREATE TRIGGER users_security_change_stamp BEFORE UPDATE ON users FOR EACH ROW
  WHEN (OLD.two_fa_enabled IS DISTINCT FROM NEW.two_fa_enabled OR OLD.two_fa_secret IS DISTINCT FROM NEW.two_fa_secret
     OR OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.sessions_invalid_after IS DISTINCT FROM NEW.sessions_invalid_after)
  EXECUTE FUNCTION users_security_change_stamp();

-- SECURITY DEFINER: the change can come from a tenant transaction or a system
-- one; the downgrade must reach every session of THAT user and nothing else.
CREATE OR REPLACE FUNCTION users_security_change_downgrade() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  UPDATE user_sessions SET mfa_verified_at = NULL, updated_at = now()
   WHERE user_id = NEW.id AND mfa_verified_at IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- The audit row never blocks the security change itself. (Even if the
  -- downgrade above were hidden by RLS, rta_operator_ok compares each
  -- session's MFA time with users.mfa_changed_at, stamped on the row itself.)
  BEGIN
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    VALUES (NEW.tenant_id, NEW.id, 'system', 'auth.mfa.sessions_downgraded', 'user', NEW.id,
            jsonb_build_object('sessionsDowngraded', n,
              'twoFactorChanged', OLD.two_fa_enabled IS DISTINCT FROM NEW.two_fa_enabled OR OLD.two_fa_secret IS DISTINCT FROM NEW.two_fa_secret,
              'passwordChanged', OLD.password_hash IS DISTINCT FROM NEW.password_hash,
              'sessionsRevoked', OLD.sessions_invalid_after IS DISTINCT FROM NEW.sessions_invalid_after));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION users_security_change_downgrade() FROM PUBLIC;
DROP TRIGGER IF EXISTS users_security_change_downgrade ON users;
CREATE TRIGGER users_security_change_downgrade AFTER UPDATE ON users FOR EACH ROW
  WHEN (OLD.two_fa_enabled IS DISTINCT FROM NEW.two_fa_enabled OR OLD.two_fa_secret IS DISTINCT FROM NEW.two_fa_secret
     OR OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.sessions_invalid_after IS DISTINCT FROM NEW.sessions_invalid_after)
  EXECUTE FUNCTION users_security_change_downgrade();

-- An active platform_admin with two-factor on (always), holding the session;
-- when p_live, the session must also be unrevoked, not invalidated by a
-- later security change, and MFA-verified within the last 12 hours.
CREATE OR REPLACE FUNCTION rta_operator_ok(p_user uuid, p_sid text, p_live boolean) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.status = 'active' AND u.roles && ARRAY['platform_admin']::text[] AND coalesce(u.two_fa_enabled, false))
     AND EXISTS (
       SELECT 1 FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.session_id = p_sid AND s.user_id = p_user
          AND (NOT p_live OR (
                s.revoked_at IS NULL
            AND s.mfa_verified_at IS NOT NULL
            AND s.mfa_verified_at > now() - interval '12 hours'
            AND (u.mfa_changed_at IS NULL OR s.mfa_verified_at > u.mfa_changed_at)
            AND (u.sessions_invalid_after IS NULL OR s.created_at >= u.sessions_invalid_after))))
$fn$;

-- ── B. Reconciliation runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rta_reconciliation_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date              date NOT NULL,
  scheduled_for          timestamptz NOT NULL,
  schedule_timezone      text NOT NULL DEFAULT 'Asia/Kolkata',
  trigger                text NOT NULL,
  started_at             timestamptz NOT NULL DEFAULT now(),
  heartbeat_at           timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  status                 text NOT NULL DEFAULT 'running',
  firms_checked          integer,
  firms_with_discrepancy integer,
  error                  text,
  worker                 text,
  CONSTRAINT rta_recon_runs_trigger_ck CHECK (trigger IN ('schedule', 'catch_up', 'manual')),
  CONSTRAINT rta_recon_runs_status_ck CHECK (status IN ('running', 'ok', 'discrepancy', 'failed', 'incomplete')),
  CONSTRAINT rta_recon_runs_done_ck CHECK ((status = 'running') = (completed_at IS NULL))
);
-- One scheduled (or catch-up) run per IST day, unless an earlier one died.
CREATE UNIQUE INDEX IF NOT EXISTS rta_recon_runs_slot_uidx ON rta_reconciliation_runs (slot_date)
  WHERE trigger IN ('schedule', 'catch_up') AND status IN ('running', 'ok', 'discrepancy', 'failed');
CREATE INDEX IF NOT EXISTS rta_recon_runs_started_idx ON rta_reconciliation_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS rta_reconciliation_run_firms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES rta_reconciliation_runs(id),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  ok          boolean NOT NULL,
  counts      jsonb,
  error       text,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, tenant_id)
);
ALTER TABLE rta_reconciliation_run_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_reconciliation_run_firms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_reconciliation_run_firms;
CREATE POLICY tenant_isolation ON rta_reconciliation_run_firms
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- ── C. Operational alerts (platform-level) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL,
  severity           text NOT NULL,
  dedup_key          text NOT NULL,
  firm_id            uuid REFERENCES tenants(id),
  summary            text NOT NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'open',
  delivery_state     text NOT NULL DEFAULT 'pending',
  occurrences        integer NOT NULL DEFAULT 1,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  delivery_attempts  integer NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  last_attempt_at    timestamptz,
  last_error         text,
  delivered_at       timestamptz,
  escalated_at       timestamptz,
  escalation_reason  text,
  acknowledged_at    timestamptz,
  acknowledged_by    uuid REFERENCES users(id),
  ack_note           text,
  CONSTRAINT ops_alerts_severity_ck CHECK (severity IN ('critical', 'warning', 'info')),
  CONSTRAINT ops_alerts_status_ck CHECK (status IN ('open', 'acknowledged')),
  CONSTRAINT ops_alerts_delivery_ck CHECK (delivery_state IN ('pending', 'retrying', 'delivered', 'undeliverable')),
  CONSTRAINT ops_alerts_ack_ck CHECK ((status = 'acknowledged') = (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL))
);
-- One OPEN alert per condition: a repeat only counts an occurrence.
CREATE UNIQUE INDEX IF NOT EXISTS ops_alerts_open_dedup_uidx ON ops_alerts (dedup_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ops_alerts_due_idx ON ops_alerts (next_attempt_at) WHERE status = 'open' AND delivery_state IN ('pending', 'retrying');
-- Platform-level operational records (like scheduler_state): no client data,
-- only a summary, counts and the firm's id. Read by the worker, the operators'
-- API and the unauthenticated health probe (which sees aggregates only).

-- An acknowledged alert is closed for good.
CREATE OR REPLACE FUNCTION ops_alerts_ack_final() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ops alerts are never deleted' USING ERRCODE = '55000'; END IF;
  IF OLD.status = 'acknowledged' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by) THEN
    RAISE EXCEPTION 'an acknowledged alert stays acknowledged' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS ops_alerts_ack_final ON ops_alerts;
CREATE TRIGGER ops_alerts_ack_final BEFORE UPDATE OR DELETE ON ops_alerts FOR EACH ROW EXECUTE FUNCTION ops_alerts_ack_final();

CREATE TABLE IF NOT EXISTS ops_alert_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id     uuid NOT NULL REFERENCES ops_alerts(id),
  channel      text NOT NULL,
  attempt      integer NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  outcome      text NOT NULL,
  http_status  integer,
  error        text,
  CONSTRAINT ops_alert_deliveries_channel_ck CHECK (channel IN ('primary', 'escalation')),
  CONSTRAINT ops_alert_deliveries_outcome_ck CHECK (outcome IN ('delivered', 'failed', 'not_configured'))
);
CREATE INDEX IF NOT EXISTS ops_alert_deliveries_alert_idx ON ops_alert_deliveries (alert_id, at);
CREATE OR REPLACE FUNCTION ops_alert_deliveries_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'ops_alert_deliveries is append-only' USING ERRCODE = '55000'; END
$fn$;
DROP TRIGGER IF EXISTS ops_alert_deliveries_append_only ON ops_alert_deliveries;
CREATE TRIGGER ops_alert_deliveries_append_only BEFORE UPDATE OR DELETE ON ops_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION ops_alert_deliveries_append_only();
