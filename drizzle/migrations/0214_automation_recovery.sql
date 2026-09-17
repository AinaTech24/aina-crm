-- Durable pause outcomes, leases, and schedule/event occurrence deduplication.
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS resume_handle text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS step_sequence integer NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS occurrence_key text;
CREATE UNIQUE INDEX IF NOT EXISTS wf_runs_occurrence_unique ON workflow_runs (tenant_id, occurrence_key);
CREATE INDEX IF NOT EXISTS wf_runs_lease_idx ON workflow_runs (lease_until) WHERE status = 'running';

ALTER TABLE communications ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS claim_until timestamptz;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE workflow_rule_scheduled_jobs ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE workflow_rule_scheduled_jobs ADD COLUMN IF NOT EXISTS claim_until timestamptz;
CREATE INDEX IF NOT EXISTS comms_recovery_idx ON communications (claim_until) WHERE status = 'queued' AND scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS rules_recovery_idx ON workflow_rule_scheduled_jobs (claim_until) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS communication_deliveries (
  tenant_id uuid NOT NULL REFERENCES tenants(id), delivery_key text NOT NULL,
  state text NOT NULL, attempts integer NOT NULL DEFAULT 0,
  lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz,
  audit jsonb NOT NULL DEFAULT '{}'::jsonb, result jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, delivery_key),
  CHECK (state IN ('preparing','sending','retry','sent','unknown','failed'))
);
CREATE TABLE IF NOT EXISTS communication_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  delivery_key text NOT NULL, attempt integer NOT NULL, lease_token uuid NOT NULL,
  state text NOT NULL, result jsonb, error text,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (tenant_id, delivery_key, attempt)
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id), subject_id uuid NOT NULL,
  subject_type text NOT NULL, status text NOT NULL DEFAULT 'pending',
  claim_token uuid, claim_until timestamptz, attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), communication_id uuid, last_error text,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, campaign_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS campaign_recipients_due_idx ON campaign_recipients (campaign_id, status, next_attempt_at);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['communication_deliveries','communication_delivery_attempts','campaign_recipients'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id() OR app_is_platform_admin()) WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin())', t);
  END LOOP;
END $$;
