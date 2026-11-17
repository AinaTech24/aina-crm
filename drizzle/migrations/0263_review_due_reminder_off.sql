-- The automatic "Portfolio review due — <client>" reminder is turned off for
-- every firm (2026-11-17, the owner's request). The worker that raised it
-- (src/workers/review-due-reminder.ts) is removed in the same change; this
-- clears what it left behind:
--
--   1. Its tasks still open are CANCELLED, not deleted — they stay on the
--      client's history and a person can reopen one. They are found by the
--      marker the worker wrote at the start of remarks: [review-due:<client>:<date>].
--      Completed tasks are left exactly as they are.
--   2. Its unread bell alerts (kind review.due) are marked read, so the bell
--      count drops with them. Nothing is deleted.
--
-- The review date itself (investors.next_review_at, families.next_review_at)
-- is untouched: it still shows on the client, the dashboards and the
-- Families "Review due" filter.

-- tasks and notifications force row-level security; this covers every firm, so
-- it runs with the platform flag the tenant_isolation policy honours. Local to
-- this file's transaction.
SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE tasks
   SET status = 'cancelled',
       updated_at = now(),
       remarks = remarks || E'\n\nCancelled on 2026-11-17: the automatic portfolio-review reminder was turned off for every firm.'
 WHERE status IN ('open', 'in_progress', 'blocked')
   AND remarks LIKE '[review-due:%';

UPDATE notifications
   SET read_at = now()
 WHERE kind = 'review.due'
   AND read_at IS NULL;
