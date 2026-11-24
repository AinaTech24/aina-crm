-- 0287 — Attachments added to or removed from a task join its Timeline.
--
-- Same shape as comments (0286): an attachment is its own row (task_attachments),
-- so attaching or removing a file never touched tasks and never showed on the
-- Timeline (2026-11-24). A trigger on task_attachments now writes a task_history row:
--   attachment_added    changes = { "attachment": { "from": null,   "to": {file} } }
--   attachment_removed  changes = { "attachment": { "from": {file}, "to": null   } }
-- where {file} = { "name": <file name>, "size": <bytes>, "type": <content type> }.
-- WHO: the uploader for an added file; the transaction's app.user_id for a removal
-- (the attachment routes set it). A history failure is a WARNING and never stops the
-- file being saved or removed.
--
-- Files already on tasks: the live ones are added to the history at the time they
-- were uploaded. A file removed before this is NOT added, since nobody can say who
-- removed it or when. Additive only; the event check gains two values.

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
  CHECK (event IN ('created', 'updated', 'comment_added', 'comment_edited', 'comment_deleted',
                   'attachment_added', 'attachment_removed'));

CREATE OR REPLACE FUNCTION record_task_attachment_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
BEGIN
  -- Recording the history must never stop the file itself from being saved.
  BEGIN
    BEGIN
      actor := nullif(current_setting('app.user_id', true), '')::uuid;
    EXCEPTION WHEN others THEN
      actor := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
      IF NEW.deleted_at IS NULL THEN
        INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
        VALUES (NEW.tenant_id, NEW.task_id, COALESCE(NEW.uploaded_by, actor), 'attachment_added',
                jsonb_build_object('attachment', jsonb_build_object(
                  'from', NULL::text,
                  'to', jsonb_build_object('name', NEW.file_name, 'size', NEW.size_bytes, 'type', NEW.content_type))));
      END IF;
      RETURN NULL;
    END IF;

    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
      VALUES (NEW.tenant_id, NEW.task_id, actor, 'attachment_removed',
              jsonb_build_object('attachment', jsonb_build_object(
                'from', jsonb_build_object('name', NEW.file_name, 'size', NEW.size_bytes, 'type', NEW.content_type),
                'to', NULL::text)));
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'record_task_attachment_history failed for attachment %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS task_attachments_record_history ON task_attachments;
CREATE TRIGGER task_attachments_record_history
  AFTER INSERT OR UPDATE ON task_attachments
  FOR EACH ROW
  EXECUTE FUNCTION record_task_attachment_history();

-- The files already there (live ones only), at the time each was uploaded.
-- Reads and writes every firm's rows, so it runs as the platform (as 0262 and 0283 do).
SELECT set_config('app.is_platform_admin', 'true', true);
INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes, at)
SELECT a.tenant_id, a.task_id, a.uploaded_by, 'attachment_added',
       jsonb_build_object('attachment', jsonb_build_object(
         'from', NULL::text,
         'to', jsonb_build_object('name', a.file_name, 'size', a.size_bytes, 'type', a.content_type))),
       a.created_at
  FROM task_attachments a
  JOIN tasks t ON t.id = a.task_id
 WHERE a.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM task_history h
      WHERE h.task_id = a.task_id AND h.event = 'attachment_added' AND h.at = a.created_at
        AND h.changes -> 'attachment' -> 'to' ->> 'name' = a.file_name
   );
