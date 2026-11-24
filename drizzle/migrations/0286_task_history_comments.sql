-- 0286 — Comments on a task join its Timeline.
--
-- 0284 recorded the task's own fields. A comment is its own row (task_comments),
-- so adding one, editing one or deleting one never touched tasks and never showed
-- (2026-11-24: "comments added or deleted or updated are not captured"). A trigger
-- on task_comments now writes the same kind of task_history row:
--   comment_added    changes = { "comment": { "from": null,        "to": <text> } }
--   comment_edited   changes = { "comment": { "from": <old text>,  "to": <new text> } }
--   comment_deleted  changes = { "comment": { "from": <text>,      "to": null } }
-- WHO: the author for an added comment; the transaction's app.user_id for an edit
-- or a delete (the comment routes set it). Like 0284, a history failure is a
-- WARNING and never stops the comment being saved. The "Need information" question
-- and answer are comments too, so they appear as well.
--
-- Comments already on tasks: the live ones are added to the history at the time
-- they were written. A comment that was deleted before this is NOT added, since
-- nobody can say who deleted it or when. Additive only; the event check gains
-- three values.

-- The 0284 check allows only 'created' / 'updated'. Replace whatever name it has.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'task_history'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%event%'
  LOOP
    EXECUTE format('ALTER TABLE task_history DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE task_history ADD CONSTRAINT task_history_event_check
  CHECK (event IN ('created', 'updated', 'comment_added', 'comment_edited', 'comment_deleted'));

CREATE OR REPLACE FUNCTION record_task_comment_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
BEGIN
  -- Recording the history must never stop the comment itself from being saved.
  BEGIN
    BEGIN
      actor := nullif(current_setting('app.user_id', true), '')::uuid;
    EXCEPTION WHEN others THEN
      actor := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
      IF NEW.deleted_at IS NULL THEN
        INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
        VALUES (NEW.tenant_id, NEW.task_id, COALESCE(NEW.author_id, actor), 'comment_added',
                jsonb_build_object('comment', jsonb_build_object('from', NULL::text, 'to', NEW.body)));
      END IF;
      RETURN NULL;
    END IF;

    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
      VALUES (NEW.tenant_id, NEW.task_id, actor, 'comment_deleted',
              jsonb_build_object('comment', jsonb_build_object('from', NEW.body, 'to', NULL::text)));
    ELSIF NEW.deleted_at IS NULL AND OLD.body IS DISTINCT FROM NEW.body THEN
      INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
      VALUES (NEW.tenant_id, NEW.task_id, COALESCE(actor, NEW.author_id), 'comment_edited',
              jsonb_build_object('comment', jsonb_build_object('from', OLD.body, 'to', NEW.body)));
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'record_task_comment_history failed for comment %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS task_comments_record_history ON task_comments;
CREATE TRIGGER task_comments_record_history
  AFTER INSERT OR UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION record_task_comment_history();

-- The comments already there (live ones only), at the time each was written.
-- Reads and writes every firm's rows, so it runs as the platform (as 0262 and 0283 do).
SELECT set_config('app.is_platform_admin', 'true', true);
INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes, at)
SELECT c.tenant_id, c.task_id, c.author_id, 'comment_added',
       jsonb_build_object('comment', jsonb_build_object('from', NULL::text, 'to', c.body)), c.created_at
  FROM task_comments c
  JOIN tasks t ON t.id = c.task_id
 WHERE c.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM task_history h
      WHERE h.task_id = c.task_id AND h.event = 'comment_added' AND h.at = c.created_at
        AND h.changes -> 'comment' ->> 'to' = c.body
   );
