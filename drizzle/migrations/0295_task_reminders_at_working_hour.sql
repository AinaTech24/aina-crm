-- Task reminders at the working hour (2026-11-27). A reminder picked from the list on a task with a due
-- DATE (stored at midnight UTC = 5:30 am India) used to count from that midnight. New ones count from
-- 10:00 am India (lib/tasks/due.ts); this moves the ones still waiting to the same hour. Only a list
-- choice is recognised (at due, 1 h, 3 h, 1 d, 2 d, 1 w before a date-only due) - a reminder typed by
-- hand is left alone. Running it twice changes nothing more: after the shift the gap is not on the list.
-- tasks forces row-level security and this runs across firms, so it sets the platform flag the policy honours.
SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE tasks
   SET remind_at = remind_at + interval '4 hours 30 minutes'
 WHERE deleted_at IS NULL
   AND status IN ('open', 'in_progress', 'blocked')
   AND reminder_fired_at IS NULL
   AND remind_at > now()
   AND due_at IS NOT NULL
   AND (due_at AT TIME ZONE 'UTC')::time = '00:00'
   AND due_at - remind_at IN (interval '0', interval '1 hour', interval '3 hours', interval '1 day', interval '2 days', interval '7 days');
