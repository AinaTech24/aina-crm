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
-- CONCURRENTLY so the build takes no write lock on a live table. That means
-- these statements cannot run inside a transaction block -- the migration
-- runner executes each file's statements directly, which is fine here because
-- CREATE INDEX CONCURRENTLY is itself restartable: a failed build leaves an
-- INVALID index that a re-run replaces.
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_folio_id_idx
  ON transactions (folio_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS sips_folio_id_idx
  ON sips (folio_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS portfolio_review_items_folio_id_idx
  ON portfolio_review_items (folio_id);
