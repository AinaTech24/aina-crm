-- Named dashboards, Zoho-style (dashboard cleanup D7 / D8 / D9).
--
-- The `dashboards` table (custom boards) becomes the one list of dashboards a
-- user picks from the dashboard dropdown:
--
--   dashboards.is_system / system_key  the six role dashboards (Owner,
--       Branch Head, Relationship Manager, Operations, Insurance Team, Claims),
--       one row per firm each, so they have an id to link to, favourite and set
--       as a default. Their content is defined in code
--       (src/lib/dashboards/system/definitions.ts) and they are always locked.
--   dashboards.filter_config  which filters a dashboard offers and their
--       defaults (D9).
--   dashboard_shares      Only me (no rows) · All users ('all') · Custom
--                         (user / role / branch / team rows; a role row can
--                         include subordinate roles).
--   dashboard_user_prefs  per user and dashboard: favourite, own default, last
--                         opened, saved filter, personal per-card filters.
--   dashboard_defaults    the firm's default dashboard per role, and per-user
--                         assignments that beat the role default.
--
-- Existing boards keep working: a board shared with the firm gets an 'all'
-- share row, and a user's default board becomes their default preference.
-- Additive only, so the colour still serving during a deploy is unaffected.

ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS system_key text;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS filter_config jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS dashboards_system_key_unique
  ON dashboards (tenant_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS dashboard_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  share_type text NOT NULL CHECK (share_type IN ('all', 'user', 'role', 'branch', 'team')),
  share_ref text NOT NULL DEFAULT '',
  include_subordinates boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_shares_unique
  ON dashboard_shares (dashboard_id, share_type, share_ref);
CREATE INDEX IF NOT EXISTS dashboard_shares_tenant_idx ON dashboard_shares (tenant_id, share_type, share_ref);

CREATE TABLE IF NOT EXISTS dashboard_user_prefs (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  is_favourite boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  last_opened_at timestamptz,
  saved_filters jsonb,
  card_filters jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dashboard_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_user_prefs_default_unique
  ON dashboard_user_prefs (tenant_id, user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS dashboard_user_prefs_tenant_idx ON dashboard_user_prefs (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS dashboard_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  target_type text NOT NULL CHECK (target_type IN ('role', 'user')),
  target_ref text NOT NULL,
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_defaults_unique
  ON dashboard_defaults (tenant_id, target_type, target_ref);

ALTER TABLE dashboard_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_shares;
CREATE POLICY tenant_isolation ON dashboard_shares
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE dashboard_user_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_user_prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_user_prefs;
CREATE POLICY tenant_isolation ON dashboard_user_prefs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE dashboard_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_defaults FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_defaults;
CREATE POLICY tenant_isolation ON dashboard_defaults
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

-- The six role dashboards, for every firm. Names and order match
-- SYSTEM_DASHBOARDS; the platform tenant has no book and gets none.
INSERT INTO dashboards (tenant_id, name, description, scope, locked, layout, is_system, system_key)
SELECT t.id, d.name, d.description, 'shared', true, '[]'::jsonb, true, d.key
  FROM tenants t
  CROSS JOIN (VALUES
    ('owner', 'Owner Dashboard', 'The whole practice: business, what needs attention, the team, the book and compliance.'),
    ('branch_head', 'Branch Head Dashboard', 'One branch: its business against target, what needs the branch head, its RMs and its clients.'),
    ('rm', 'Relationship Manager Dashboard', 'Your own book: whom to contact today, what is pending, your clients, leads and targets.'),
    ('operations', 'Operations Dashboard', 'Pending work across the team: the queue, SLA, team load, rejections and compliance.'),
    ('insurance', 'Insurance Team Dashboard', 'Insurance business, renewals, lost business, clients, issuance and claims.'),
    ('claims', 'Claims Dashboard', 'The claims queue: what needs action today, what is overdue, what is missing and who owns it.')
  ) AS d(key, name, description)
 WHERE t.id <> '00000000-0000-0000-0000-000000000000'
ON CONFLICT (tenant_id, system_key) WHERE system_key IS NOT NULL DO NOTHING;

-- Shared with everyone; who sees which one in the dropdown is decided by role
-- (definitions.ts visibleTo), and every figure still follows record access.
INSERT INTO dashboard_shares (tenant_id, dashboard_id, share_type, share_ref)
SELECT d.tenant_id, d.id, 'all', ''
  FROM dashboards d
 WHERE d.is_system
ON CONFLICT (dashboard_id, share_type, share_ref) DO NOTHING;

-- Role defaults (D8): Owner, Compliance and Marketing → Owner Dashboard;
-- Branch head → Branch Head Dashboard; RM and Team member → Relationship
-- Manager Dashboard; Operations, Back office and Service team → Operations
-- Dashboard; Insurance team → Insurance Team Dashboard.
INSERT INTO dashboard_defaults (tenant_id, target_type, target_ref, dashboard_id)
SELECT d.tenant_id, 'role', r.role, d.id
  FROM dashboards d
  JOIN (VALUES
    ('owner', 'owner'),
    ('branch_head', 'branch_head'),
    ('rm', 'rm'),
    ('team_member', 'rm'),
    ('ops', 'operations'),
    ('back_office', 'operations'),
    ('service_team', 'operations'),
    ('compliance', 'owner'),
    ('marketing', 'owner'),
    ('insurance_team', 'insurance')
  ) AS r(role, system_key) ON r.system_key = d.system_key
ON CONFLICT (tenant_id, target_type, target_ref) DO NOTHING;

-- Existing boards: shared → 'all'; a user's default board → their default.
INSERT INTO dashboard_shares (tenant_id, dashboard_id, share_type, share_ref, created_by)
SELECT d.tenant_id, d.id, 'all', '', d.user_id
  FROM dashboards d
 WHERE NOT d.is_system AND d.scope = 'shared' AND d.deleted_at IS NULL
ON CONFLICT (dashboard_id, share_type, share_ref) DO NOTHING;

INSERT INTO dashboard_user_prefs (tenant_id, user_id, dashboard_id, is_default)
SELECT d.tenant_id, d.user_id, d.id, true
  FROM dashboards d
 WHERE NOT d.is_system AND d.is_default AND d.deleted_at IS NULL AND d.user_id IS NOT NULL
ON CONFLICT (user_id, dashboard_id) DO NOTHING;
