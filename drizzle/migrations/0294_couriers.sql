-- Couriers (2026-11-27, Akshar Invest): incoming and outgoing couriers, one row
-- per courier. The module is a per-firm switch (feature flag courierRegister,
-- src/config/feature-flags.ts); the table exists for every firm but only a firm
-- with the switch on can reach it.
--
-- An inward row holds the sender's details, an outward row the recipient's; the
-- application empties the other side's columns on every save.
--
-- The switch is turned on here for Akshar Invest alone, matched by its ARN
-- (ARN-110756); any other firm gets it from Aina Admin → the firm → Access.

CREATE TABLE IF NOT EXISTS courier_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  courier_type text NOT NULL,
  courier_company text,
  tracking_number text,
  courier_date date NOT NULL,
  status text NOT NULL,
  category text,
  category_other text,
  description text,
  remarks text,
  sender_name text,
  sender_company text,
  sender_mobile text,
  sender_email text,
  sender_address text,
  received_date date,
  recipient_name text,
  recipient_company text,
  recipient_mobile text,
  recipient_email text,
  recipient_address text,
  dispatch_date date,
  courier_charges numeric(12, 2),
  payment_mode text,
  delivered_date date,
  created_by uuid REFERENCES users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_entries_type CHECK (courier_type IN ('inward', 'outward')),
  CONSTRAINT courier_entries_charges CHECK (courier_charges IS NULL OR courier_charges >= 0),
  CONSTRAINT courier_entries_delivered_after_dispatch
    CHECK (dispatch_date IS NULL OR delivered_date IS NULL OR delivered_date >= dispatch_date)
);
CREATE INDEX IF NOT EXISTS courier_entries_date_idx ON courier_entries (tenant_id, courier_date) WHERE deleted_at IS NULL;

ALTER TABLE courier_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON courier_entries;
CREATE POLICY tenant_isolation ON courier_entries
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
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"courierRegister": true}'::jsonb
 WHERE s.tenant_id IN (SELECT t.id FROM tenants t WHERE regexp_replace(t.arn, '[^0-9]', '', 'g') = '110756')
   AND COALESCE(s.feature_flags_override ->> 'courierRegister', 'false') <> 'true';
