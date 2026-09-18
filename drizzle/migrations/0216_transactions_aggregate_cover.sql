-- Covering index for the two UNBOUNDED transaction aggregates.
--
-- Two hot queries scan a firm's whole transaction ledger with no date bound,
-- because both are legitimately all-time figures:
--
--   1. /dashboard/transactions KPI cards — inflow/outflow/rejected/total for the
--      current filter, which by default is "everything".
--   2. the main dashboard's "Total Investment" (src/lib/dashboard/firm-pulse.ts)
--      — net money in across the completed ledger, all-time by definition.
--
-- Both were fine while the biggest book was ~200k rows. Then one firm's
-- since-inception CAMS/KFintech reload took it from 0 to 508,124 transactions
-- (the table is now 459 MB), and on this instance — 88 MB of shared_buffers for
-- a 3.6 GB database — the heap scan stopped fitting in the 30s statement
-- timeout. Worse, every attempt held a pool slot for the full 30s, so the pool
-- drained and unrelated pages started failing with "timeout exceeded when
-- trying to connect".
--
-- Both filter on (tenant_id, status) and then read only direction, type and
-- amount. tx_status_idx already leads on (tenant_id, status); INCLUDE-ing the
-- other three lets Postgres answer from the index alone instead of visiting a
-- 459 MB heap for columns it could have carried. The index is a fraction of the
-- table's width, so the same work reads far fewer pages.
--
-- Index-only scans need a current visibility map, so this pays off fully once
-- autovacuum has been over the freshly-imported rows.
--
-- CONCURRENTLY cannot run inside a transaction block and the runner wraps each
-- file in one, so this file opts out below. That means it is NOT
-- all-or-nothing — every statement here is written to be re-runnable.
--
-- migrate:no-transaction

-- An interrupted CONCURRENTLY build leaves an INVALID index that the planner
-- ignores, and `IF NOT EXISTS` would then skip it for ever. Clear that first so
-- a re-run genuinely rebuilds. DROP INDEX is transactional, so it is safe in
-- this DO block.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT i.indisvalid
      AND c.relname = 'transactions_tenant_status_cover_idx'
  LOOP
    RAISE NOTICE 'dropping invalid index %', r.name;
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.name);
  END LOOP;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_tenant_status_cover_idx
  ON transactions (tenant_id, status)
  INCLUDE (direction, type, amount);
