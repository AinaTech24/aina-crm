-- Per-RM daily snapshot — so "My AUM vs last month" can ever be true.
--
-- `firm_snapshots` carries one row per TENANT per day. The personal cockpit
-- (/dashboard?scope=mine) asks the same question one book down: what was MY
-- AUM and MY SIP book a month ago? That cannot be derived after the fact —
-- AUM is units x NAV at a point in time, and replaying it needs historical NAV
-- against historical unit balances. The honest options were to show nothing or
-- to approximate AUM-then as AUM-now minus net flow, which silently attributes
-- every market move to the RM's selling. So: record it forward, same as the
-- firm does, and show "building from <date>" until there is a month of it.
--
-- One row per (tenant, rm, day). Small: an RM per row, not a client.
CREATE TABLE IF NOT EXISTS rm_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rm_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT current_date,
  aum numeric(18, 2) NOT NULL DEFAULT 0,
  clients integer NOT NULL DEFAULT 0,
  monthly_sip numeric(18, 2) NOT NULL DEFAULT 0,
  active_sips integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Re-running the recorder on the same day must overwrite, not duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS rm_snapshots_unique
  ON rm_snapshots (tenant_id, rm_id, snapshot_date);

-- The read is always "this RM, ordered by date" — the index above serves it
-- left-to-right, so no second index is worth its write cost.

ALTER TABLE rm_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE rm_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rm_snapshots;
CREATE POLICY tenant_isolation ON rm_snapshots
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
