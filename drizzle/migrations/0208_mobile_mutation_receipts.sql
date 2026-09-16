-- Keep receipts for the lifetime of the account: offline devices can reconnect months later.
CREATE TABLE IF NOT EXISTS api_mutation_receipts (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, request_key)
);
ALTER TABLE api_mutation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_mutation_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_mutation_receipts;
CREATE POLICY tenant_isolation ON api_mutation_receipts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
