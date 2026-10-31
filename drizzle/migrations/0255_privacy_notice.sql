-- DPDP Act 2023 / DPDP Rules 2025 (2026-10-31): the firm's privacy notice and
-- the record that proves notice and consent (src/lib/privacy/).
--
-- tenants.privacy_notice — Settings → Privacy notice: the firm's extra purposes
-- and recipients, the AI line, and the version every consent record carries.
-- privacy_consents — one row per consent ticked on a public form (lead form,
-- document upload, fact-find) and per notice first emailed to a client or lead.
-- Rows are never edited; a withdrawal stamps withdrawn_at. Additive only.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS privacy_notice jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS privacy_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  subject_type   text CHECK (subject_type IN ('lead', 'investor')),
  subject_id     uuid,
  kind           text NOT NULL CHECK (kind IN ('consent', 'notice')),
  source         text NOT NULL,
  purpose        text,
  notice_version integer NOT NULL,
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz
);

CREATE INDEX IF NOT EXISTS privacy_consents_subject_idx ON privacy_consents (tenant_id, subject_type, subject_id);

ALTER TABLE privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_consents;
CREATE POLICY tenant_isolation ON privacy_consents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
