-- The practice as a system (The E-Myth Revisited, 2026-10-08).
--
-- An MFD owner is usually the firm's best technician: its best RM, its
-- approver and the only person who knows how things are done. These tables let
-- the firm write the business down so it runs without them:
--
--   practice_positions        the JOBS, not the people (Relationship Manager,
--                             Operations Executive …) — each with a short
--                             position contract: purpose, the results it
--                             answers for, the approvals it may give.
--   practice_position_holders who fills each position (one person can fill
--                             several — the owner usually fills most).
--   sop_links                 an SOP attached to where the work happens: a task
--                             type, a task template, a core process, a position,
--                             a journey stage or a service-request type.
--   practice_process_settings per-firm settings of the core processes defined
--                             in code (lib/practice/processes.ts): the position
--                             that owns each one.
--   service_promises          what every client of a service tier gets
--                             (reviews, calls, statements, reply time).
--   firm_strategy             the owner's primary aim and the 3–5 year
--                             strategic objective the annual targets serve.
--
-- Additive and idempotent; every table tenant-scoped with RLS.

CREATE TABLE IF NOT EXISTS practice_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  title text NOT NULL,
  purpose text,
  -- ["Every client in the book reviewed on the tier's cadence", …]
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ["Approve a SIP cancellation", …]
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_positions_key_uq ON practice_positions (tenant_id, key);

CREATE TABLE IF NOT EXISTS practice_position_holders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  position_id uuid NOT NULL REFERENCES practice_positions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_position_holders_uq ON practice_position_holders (position_id, user_id);
CREATE INDEX IF NOT EXISTS practice_position_holders_user_idx ON practice_position_holders (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS sop_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sop_id uuid NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN
    ('task_type', 'task_template', 'process', 'position', 'blueprint_stage', 'sr_type')),
  target_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sop_links_uq ON sop_links (tenant_id, sop_id, target_kind, target_key);
CREATE INDEX IF NOT EXISTS sop_links_target_idx ON sop_links (tenant_id, target_kind, target_key);

CREATE TABLE IF NOT EXISTS practice_process_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  process_key text NOT NULL,
  owner_position_id uuid REFERENCES practice_positions(id) ON DELETE SET NULL,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_process_settings_uq ON practice_process_settings (tenant_id, process_key);

CREATE TABLE IF NOT EXISTS service_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tier text NOT NULL,
  -- { reviewEveryDays, callEveryDays, statementEveryDays, birthdayWish, querySlaHours }
  items jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS service_promises_tier_uq ON service_promises (tenant_id, tier);

CREATE TABLE IF NOT EXISTS firm_strategy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  primary_aim text,
  objective_year integer,
  -- { aum, clients, sipBook, revenue, teamSize, ownerHoursPerWeek }
  targets jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The starting point when the objective was set, so progress has a base.
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS firm_strategy_tenant_uq ON firm_strategy (tenant_id);

ALTER TABLE practice_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_positions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON practice_positions;
CREATE POLICY tenant_isolation ON practice_positions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE practice_position_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_position_holders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON practice_position_holders;
CREATE POLICY tenant_isolation ON practice_position_holders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE sop_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sop_links;
CREATE POLICY tenant_isolation ON sop_links
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE practice_process_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_process_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON practice_process_settings;
CREATE POLICY tenant_isolation ON practice_process_settings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE service_promises ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_promises FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_promises;
CREATE POLICY tenant_isolation ON service_promises
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE firm_strategy ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_strategy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON firm_strategy;
CREATE POLICY tenant_isolation ON firm_strategy
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
