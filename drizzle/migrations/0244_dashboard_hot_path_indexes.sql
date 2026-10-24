-- Indexes for the queries the RM desk, the notification bell and the client
-- book run on every load. Each was measured on a mid-size firm (16 RMs, 6,000
-- clients, 100,000 transactions, 30,000 tasks, 120,000 notifications) as the
-- non-superuser app role, so RLS was in force — before → after:
--
--   1. RM desk sums over "my clients' transactions" (month on month, KPI strip,
--      redemptions, SIP rejections …). They filter by
--      `investor_id IN (my clients)` with no tenant_id, so tx_investor_idx
--      (tenant_id, investor_id, order_date) cannot be used and the bare
--      (investor_id) index left every row to be fetched from the heap — the
--      planner chose a full scan of transactions instead, ~18 times per desk
--      render. Covering (investor_id, order_date) INCLUDE the columns those sums
--      read (and tenant_id, which the RLS policy reads) answers them from the
--      index alone: 73 ms → 7.5 ms per query. It replaces transactions_investor_idx
--      (0077), whose single column is its leading column.
--
--   2. The notification bell: the user's latest 50 not-archived, polled every
--      90 s by every open tab. notifications_user_unread_idx (user_id, read_at)
--      found the rows but then sorted all of them: 55 ms → 0.5 ms.
--
--   3. "Where did this client come from": the RM desk looks up each client's
--      converted lead (`leads.converted_investor_id = i.id`), which had no index —
--      a scan of leads per client: 179 ms → 0.8 ms for a 340-client book.
--
--   4. "Is there a follow-up on this client": a task reaches a client through
--      related_investor_id OR (subject_type 'investor', subject_id)
--      (lib/dashboard/my/window.ts taskIsAbout). Both existing indexes lead on
--      tenant_id, which these correlated lookups do not filter on, so each row
--      scanned the tasks table: 102 ms → 0.6 ms. UUIDs are unique across firms,
--      so the tenant prefix adds nothing here.
--
-- CONCURRENTLY so no build blocks writes to a live table (transactions is the
-- 459 MB one, see 0213 / 0216). CONCURRENTLY cannot run inside a transaction
-- block and the runner wraps each file in one, so this file opts out below and
-- is NOT all-or-nothing: every statement is re-runnable.
--
-- migrate:no-transaction

-- An interrupted CONCURRENTLY build leaves an INVALID index that the planner
-- ignores and `IF NOT EXISTS` would skip for ever. Clear those first so a re-run
-- genuinely rebuilds. DROP INDEX is transactional, so it is safe in this block.
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
        'tx_investor_date_cov_idx',
        'notifications_user_feed_idx',
        'leads_converted_investor_idx',
        'tasks_investor_link_idx',
        'tasks_investor_subject_idx'
      )
  LOOP
    RAISE NOTICE 'dropping invalid index %', r.name;
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.name);
  END LOOP;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS tx_investor_date_cov_idx
  ON transactions (investor_id, order_date) INCLUDE (tenant_id, status, type, amount);

-- Only once its replacement is built and valid.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.relname = 'tx_investor_date_cov_idx' AND i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.transactions_investor_idx';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_feed_idx
  ON notifications (user_id, created_at DESC) WHERE archived_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_converted_investor_idx
  ON leads (converted_investor_id) WHERE converted_investor_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_investor_link_idx
  ON tasks (related_investor_id) WHERE related_investor_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_investor_subject_idx
  ON tasks (subject_id) WHERE subject_type = 'investor';
