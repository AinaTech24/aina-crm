-- 0254 — A task's entry date, and its closed date written by the database.
--
-- Entry date: the day the task was ENTERED (the firm's request, 2026-10-30).
-- It defaults to today and the New task form lets the person set another day
-- (a task logged the next morning for yesterday's call). created_at stays the
-- moment the row was written; entry_date is the business date shown on the task.
--
-- Closed date: tasks.completed_at already exists and the task API fills it, but
-- tasks are completed from many places (the opportunity journey, the SIP defence
-- flow, bulk actions, workflows) and any of them could miss it. The rule lives
-- here, where all of them pass:
--   status becomes completed        → completed_at = now() when not already set
--   status leaves completed         → completed_at cleared (a reopened task is not closed)
-- Additive only.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS entry_date date;

-- Tasks already in the book: the India day each was created.
UPDATE tasks SET entry_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date
 WHERE entry_date IS NULL;

CREATE OR REPLACE FUNCTION task_entry_and_closed_dates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.entry_date := COALESCE(NEW.entry_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  END IF;

  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_entry_and_closed_dates ON tasks;
CREATE TRIGGER tasks_entry_and_closed_dates
  BEFORE INSERT OR UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION task_entry_and_closed_dates();

-- Completed tasks that never got a closed date: their last edit is the best known.
UPDATE tasks SET completed_at = updated_at
 WHERE status = 'completed' AND completed_at IS NULL;
