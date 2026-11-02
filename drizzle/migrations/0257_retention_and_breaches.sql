-- DPDP step 3 (2026-11-02): the firm's retention policy and its breach register.
--
-- tenants.data_retention — Settings → Privacy notice → Data retention: after
-- how long a lost lead is erased and a former client (past the five years the
-- Prevention of Money Laundering Act requires) is purged. Empty = off.
-- data_breaches — Compliance → Data breaches: each personal-data breach, the
-- 72-hour report to the Data Protection Board and who was told (Rule 7).
-- Additive only.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS data_retention jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS data_breaches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  reference             text NOT NULL,
  title                 text NOT NULL,
  detected_at           timestamptz NOT NULL,
  occurred_at           timestamptz,
  description           text,
  data_affected         text,
  affected_count        integer,
  cause                 text,
  consequences          text,
  mitigation            text,
  person_steps          text,
  report_due_at         timestamptz NOT NULL,
  board_intimated_at    timestamptz,
  board_report_at       timestamptz,
  people_notified_at    timestamptz,
  people_notified_count integer,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at             timestamptz,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS data_breaches_reference_uq ON data_breaches (tenant_id, reference);
CREATE INDEX IF NOT EXISTS data_breaches_status_idx ON data_breaches (tenant_id, status, detected_at);

ALTER TABLE data_breaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_breaches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON data_breaches;
CREATE POLICY tenant_isolation ON data_breaches
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
