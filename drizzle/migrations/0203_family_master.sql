-- Family Master configuration: relationship types + per-firm household defaults.
--
-- Relationship options were an 11-item array hardcoded inside two components,
-- so a firm that works with, say, "Mother-in-law" or a regional HUF role had no
-- way to record it and the two pickers could drift apart. They are per-firm
-- data now.
--
-- Rows are copy-on-write: a firm that never opens the settings page has NO rows
-- and the code falls back to the shipped defaults, so nothing changes for it and
-- no per-tenant seeding is needed.

CREATE TABLE IF NOT EXISTS family_relationship_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Stored verbatim in investors.family_role, so it must never change once used.
  key         text NOT NULL,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  -- Shipped default: the key is fixed (existing members reference it); only the
  -- label, order and active flag may be edited.
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS family_relationship_types_tenant_key_idx
  ON family_relationship_types (tenant_id, key);
CREATE INDEX IF NOT EXISTS family_relationship_types_tenant_order_idx
  ON family_relationship_types (tenant_id, sort_order);

ALTER TABLE family_relationship_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_relationship_types FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON family_relationship_types;
CREATE POLICY tenant_isolation ON family_relationship_types FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- Per-firm household defaults. Empty object = use the shipped defaults.
--   { defaultReviewFrequency, familyNamePattern, requirePrimaryMember }
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS family_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.family_settings IS
  'Household defaults: review cadence for new families, family-name pattern, whether a primary member is required.';
