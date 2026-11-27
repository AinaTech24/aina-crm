-- 0301 — Collaborators on a task: teammates who work on it together with the
-- assignee (2026-11-27). A list of user ids on the task itself, so every query
-- that decides "is this my task" can read it without a join.
--
-- The Timeline records a change to the list like any other field: the trigger
-- function of 0284 is replaced by the same function with collaborator_ids added
-- to the tracked columns. Additive only; the column has a default, so the
-- version still running during a deploy inserts tasks as before.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS collaborator_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_collaborator_ids_array;
ALTER TABLE tasks ADD CONSTRAINT tasks_collaborator_ids_array
  CHECK (jsonb_typeof(collaborator_ids) = 'array');

CREATE INDEX IF NOT EXISTS tasks_collaborator_ids_idx ON tasks USING gin (collaborator_ids);

CREATE OR REPLACE FUNCTION record_task_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
  o jsonb;
  n jsonb;
  k text;
  diff jsonb := '{}'::jsonb;
  tracked text[] := ARRAY[
    'title', 'description', 'remarks', 'type', 'priority', 'status', 'assignee_id', 'collaborator_ids',
    'due_at', 'sla_due_at', 'entry_date', 'remind_at', 'completed_at', 'department',
    'requires_approval', 'approval_status', 'approval_note', 'approved_by',
    'estimate_minutes', 'blocked_by_task_id', 'recurrence', 'recurrence_until',
    'related_investor_id', 'related_lead_id', 'related_service_request_id',
    'related_meeting_id', 'tags', 'deleted_at'
  ];
BEGIN
  -- Recording the history must never stop the task itself from being saved.
  BEGIN
    BEGIN
      actor := nullif(current_setting('app.user_id', true), '')::uuid;
    EXCEPTION WHEN others THEN
      actor := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
      INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
      VALUES (NEW.tenant_id, NEW.id, COALESCE(actor, NEW.created_by_id), 'created', '{}'::jsonb);
      RETURN NULL;
    END IF;

    o := to_jsonb(OLD);
    n := to_jsonb(NEW);
    FOREACH k IN ARRAY tracked LOOP
      IF o -> k IS DISTINCT FROM n -> k THEN
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
      END IF;
    END LOOP;
    IF o #> '{meta,checklist}' IS DISTINCT FROM n #> '{meta,checklist}' THEN
      diff := diff || jsonb_build_object('checklist',
        jsonb_build_object('from', o #> '{meta,checklist}', 'to', n #> '{meta,checklist}'));
    END IF;

    IF diff <> '{}'::jsonb THEN
      INSERT INTO task_history (tenant_id, task_id, actor_user_id, event, changes)
      VALUES (NEW.tenant_id, NEW.id, actor, 'updated', diff);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'record_task_history failed for task %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
