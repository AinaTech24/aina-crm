-- Visitor Register (2026-11-26, Akshar Invest): who visited the firm's office,
-- one row per visit. The module is a per-firm switch (feature flag
-- visitorRegister, src/config/feature-flags.ts); the table exists for every
-- firm but only a firm with the switch on can reach it.
--
-- The switch is turned on here for Akshar Invest alone, matched by its ARN
-- (ARN-110756); any other firm gets it from Aina Admin → the firm → Access.

CREATE TABLE IF NOT EXISTS visitor_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  visitor_name text NOT NULL,
  email text,
  mobile text,
  company_name text,
  visit_date date NOT NULL,
  entry_time time,
  exit_time time,
  purpose text,
  meeting_with_user_id uuid REFERENCES users(id),
  remarks text,
  created_by uuid REFERENCES users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visitor_entries_exit_after_entry
    CHECK (entry_time IS NULL OR exit_time IS NULL OR exit_time >= entry_time)
);
CREATE INDEX IF NOT EXISTS visitor_entries_date_idx ON visitor_entries (tenant_id, visit_date) WHERE deleted_at IS NULL;

ALTER TABLE visitor_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON visitor_entries;
CREATE POLICY tenant_isolation ON visitor_entries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- subscriptions and tenants force row-level security; this finds the firm by ARN
-- across tenants, so it runs with the platform flag the tenant_isolation policy
-- honours. Local to this file's transaction.
SELECT set_config('app.is_platform_admin', 'true', true);

-- The ARN's digits must be exactly 110756 (a longer number that merely contains
-- them is another firm's). Idempotent; only this one key of the firm's own
-- override is set, so its other flags are untouched.
UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"visitorRegister": true}'::jsonb
 WHERE s.tenant_id IN (SELECT t.id FROM tenants t WHERE regexp_replace(t.arn, '[^0-9]', '', 'g') = '110756')
   AND COALESCE(s.feature_flags_override ->> 'visitorRegister', 'false') <> 'true';
