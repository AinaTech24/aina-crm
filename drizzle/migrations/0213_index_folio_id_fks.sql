-- Index the foreign keys that CASCADE from folios.
--
-- `transactions.folio_id`, `sips.folio_id` and `portfolio_review_items.folio_id`
-- all reference folios ON DELETE CASCADE, and none of them were indexed.
-- Postgres has to prove no child row references a folio before it can delete
-- one, so every single folio DELETE triggered a full scan of transactions --
-- 459 MB on production.
--
-- Measured on Ahpal Financial Services: deleting 24,860 folios ran past a
-- 30-minute statement timeout and was still going, while deleting 725,786
-- transactions from the same tenant finished in 26 minutes. The folio count was
-- 30x smaller and it was slower, because each row cost a table scan.
--
-- This is not only a maintenance problem: the client merge engine re-points and
-- deletes folios, so every merge paid the same cost.
--
-- CONCURRENTLY so the build takes no write lock on a live table: `transactions`
-- is 459 MB on production and a plain CREATE INDEX would block every write to
-- it for the length of the build, while the old colour is still serving.
--
-- CONCURRENTLY cannot run inside a transaction block, and the runner wraps each
-- file in one, so this file opts out with the header below. It is applied
-- statement by statement with no BEGIN, which means it is NOT all-or-nothing --
-- hence every statement below is re-runnable.
--
-- migrate:no-transaction

-- A CONCURRENTLY build that fails (lock timeout, deadlock, a killed session)
-- leaves an INVALID index behind, and `IF NOT EXISTS` would then skip it
-- forever -- an index that is never used and never finished. Clear those first
-- so a re-run genuinely rebuilds. DROP INDEX is transactional, so it is safe
-- inside this DO block.
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
      AND c.relname IN (
        'transactions_folio_id_idx',
        'sips_folio_id_idx',
        'portfolio_review_items_folio_id_idx'
      )
  LOOP
    RAISE NOTICE 'dropping invalid index %', r.name;
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.name);
  END LOOP;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_folio_id_idx
  ON transactions (folio_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS sips_folio_id_idx
  ON sips (folio_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS portfolio_review_items_folio_id_idx
  ON portfolio_review_items (folio_id);
