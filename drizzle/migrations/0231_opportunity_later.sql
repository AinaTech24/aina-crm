-- 0231 — "Later": an opportunity the client wants, but not yet.
--
-- "After Diwali", "in three months", "when my FD matures": the opportunity
-- stays OPEN (one open row per client + product still holds, and the
-- Cross-sell card still says Interested) but is parked until a revisit date.
-- The date lives in the existing revisit_on column (on a LOST row it means
-- the same thing: when to look again). A reminder task reaches the owner
-- ahead of it (lib/opportunities/later.ts); a money event is an expected
-- inflow linked here, whose own reminder task is that reminder.
-- Additive only.

ALTER TABLE client_opportunities
  ADD COLUMN IF NOT EXISTS parked_at timestamptz,
  -- What the client said, in the RM's words: "after Diwali", "when the FD matures".
  ADD COLUMN IF NOT EXISTS parked_reason text,
  -- How many times it has been put off; the third asks whether it is really lost.
  ADD COLUMN IF NOT EXISTS park_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_inflow_id uuid REFERENCES expected_inflows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_opps_parked_idx
  ON client_opportunities (tenant_id, revisit_on)
  WHERE status = 'open' AND parked_at IS NOT NULL;
