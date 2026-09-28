-- Per-branch daily snapshot — so "Branch AUM vs last month" can ever be true.
--
-- Same reasoning as 0217 (rm_snapshots), one level up: AUM a month ago is units
-- x NAV a month ago, which cannot be recomputed today; it has to have been
-- recorded. The firm table (firm_snapshots) has no branch dimension and the RM
-- table cannot be summed into a branch — an RM's book can span branches, and a
-- branch's AUM belongs to the branch that owns each CLIENT (investors.branch_id),
-- not to wherever the RM sits.
--
-- Written nightly by src/workers/firm-snapshot-recorder.ts alongside the firm
-- and RM rows. The branch command centre reads it for the month-on-month lines
-- and the AUM / SIP-book trend, and says "building from <date>" until there is
-- history.
CREATE TABLE IF NOT EXISTS branch_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT current_date,
  aum numeric(18, 2) NOT NULL DEFAULT 0,
  clients integer NOT NULL DEFAULT 0,
  monthly_sip numeric(18, 2) NOT NULL DEFAULT 0,
  active_sips integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Re-running the recorder on the same day overwrites, never duplicates. The
-- read is always "this branch, by date", which this index serves as-is.
CREATE UNIQUE INDEX IF NOT EXISTS branch_snapshots_unique
  ON branch_snapshots (tenant_id, branch_id, snapshot_date);

ALTER TABLE branch_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON branch_snapshots;
CREATE POLICY tenant_isolation ON branch_snapshots
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
