-- DPDP (2026-11-02): the register of people's requests to use their rights —
-- access, correction, erasure, withdrawing consent, nomination, grievance —
-- answered within 90 days (src/lib/privacy/requests.ts). Additive only.

CREATE TABLE IF NOT EXISTS privacy_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  reference            text NOT NULL,
  subject_type         text CHECK (subject_type IN ('lead', 'investor')),
  subject_id           uuid,
  requester_name       text NOT NULL,
  requester_email      text,
  requester_phone      text,
  type                 text NOT NULL CHECK (type IN ('access', 'correction', 'erasure', 'withdraw_consent', 'nomination', 'grievance')),
  channel              text NOT NULL,
  details              text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'rejected')),
  received_at          timestamptz NOT NULL,
  due_at               timestamptz NOT NULL,
  identity_verified_at timestamptz,
  identity_verified_by uuid,
  assignee_id          uuid,
  task_id              uuid,
  outcome              text,
  erasure_result       text,
  closed_at            timestamptz,
  closed_by            uuid,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS privacy_requests_reference_uq ON privacy_requests (tenant_id, reference);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON privacy_requests (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS privacy_requests_subject_idx ON privacy_requests (tenant_id, subject_type, subject_id);

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_requests;
CREATE POLICY tenant_isolation ON privacy_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
