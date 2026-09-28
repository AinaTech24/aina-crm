-- Firm-configurable dashboard thresholds.
--
-- The branch command centre brief is explicit that judgement thresholds must
-- be set by an administrator, not hard-coded: the green/amber/red bands on the
-- RM target matrix, when a lead counts as stale, how old a proposal must be to
-- need attention. Until now every threshold lived in code
-- (src/lib/dashboard/thresholds.ts), with a comment promising a per-tenant
-- override "later". This is that override.
--
-- One row per tenant, a JSON object of overrides merged OVER the code defaults
-- at read time — so a firm that has never opened the settings screen gets
-- exactly today's behaviour, and adding a new threshold never needs a migration.
CREATE TABLE IF NOT EXISTS dashboard_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dashboard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_settings;
CREATE POLICY tenant_isolation ON dashboard_settings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
