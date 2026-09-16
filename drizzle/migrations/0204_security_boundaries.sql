-- Platform authentication counters exist before a tenant identity is known.
CREATE TABLE IF NOT EXISTS auth_login_limits (
  bucket_key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  resets_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_login_limits_expiry_idx ON auth_login_limits (resets_at);
-- Use the same system-context policy as other pre-auth tables; tenant sessions
-- cannot manipulate login budgets through the application role.
ALTER TABLE auth_login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_login_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_login_limits_system ON auth_login_limits;
CREATE POLICY auth_login_limits_system ON auth_login_limits
  USING (current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_platform_admin', true) = 'true');

CREATE TABLE IF NOT EXISTS document_upload_grants (
  storage_key text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  token_id uuid NOT NULL REFERENCES share_tokens(id) ON DELETE CASCADE,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  doc_key text NOT NULL,
  content_type text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_upload_grants_token_idx ON document_upload_grants (tenant_id, token_id);
ALTER TABLE document_upload_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_upload_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_upload_grants;
CREATE POLICY tenant_isolation ON document_upload_grants
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
