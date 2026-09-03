-- Reversible client merges.
--
-- Merging repoints every child row (folios, transactions, SIPs, tasks, …) from
-- the loser to the survivor. Afterwards those rows are indistinguishable from
-- the survivor's own, so an "un-merge" that guesses which ones to send back
-- would silently move the WRONG holdings — worse than having no un-merge at all.
--
-- So record exactly what moved, at the moment it moves. `moved` is
-- { "<table>": ["<row uuid>", …] }, written inside the merge transaction.
--
-- `reversible` is false when the move was too large to log (MOVED_ID_CAP in the
-- merge route). A 50k-transaction client would otherwise put a megabyte of ids
-- in one row; past the cap we keep per-table COUNTS only and say plainly that
-- the merge cannot be undone, rather than offering an undo that half-works.

CREATE TABLE IF NOT EXISTS investor_merges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  survivor_id   uuid NOT NULL REFERENCES investors(id),
  loser_id      uuid NOT NULL REFERENCES investors(id),
  merged_by_id  uuid REFERENCES users(id),
  source        text NOT NULL DEFAULT 'manual',
  reason        text,
  -- Snapshot of the loser's own headline figures before they were zeroed, so an
  -- un-merge can restore the record as it stood rather than leaving it at 0.
  loser_aum         numeric(18,2) NOT NULL DEFAULT 0,
  loser_sip_amount  numeric(18,2) NOT NULL DEFAULT 0,
  loser_status      text,
  moved         jsonb NOT NULL DEFAULT '{}'::jsonb,
  moved_counts  jsonb NOT NULL DEFAULT '{}'::jsonb,
  reversible    boolean NOT NULL DEFAULT true,
  reversed_at   timestamptz,
  reversed_by_id uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investor_merges_tenant_idx  ON investor_merges (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investor_merges_loser_idx   ON investor_merges (tenant_id, loser_id);
-- One OPEN merge per loser. A loser already merged cannot be merged again (the
-- API refuses), and this makes that invariant the database's job too. Partial,
-- so a reversed merge doesn't block a later re-merge of the same record.
CREATE UNIQUE INDEX IF NOT EXISTS investor_merges_open_loser_unique
    ON investor_merges (tenant_id, loser_id) WHERE reversed_at IS NULL;

ALTER TABLE investor_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_merges FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON investor_merges;
CREATE POLICY tenant_isolation ON investor_merges FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
