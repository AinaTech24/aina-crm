-- 0284 — A task's history: who created it, and every change to it field by field.
--
-- The task page gets a "View Timeline" button (2026-11-24) listing when the task
-- was created and by whom, and for every later edit: which field, from what to
-- what, when and by whom. audit_log could not do it — the task API wrote only
-- the status and assignee BEFORE an edit and the request body after it — and a
-- task is changed from many places (the task form, bulk actions, the opportunity
-- journey, workflows, the escalation ladder), any of which could skip an app-side
-- log. The rule lives here, where all of them pass, as the closed-date rule does
-- (0254): a trigger writes one task_history row per edit holding every tracked
-- field that changed, with the old and the new value.
--
-- WHO: the transaction's app.user_id (set by withTenant / withIdempotentMutation
-- and by the task routes that open a plain transaction). A change with none —
-- a workflow, the reminder scanner — is recorded with no person and shown as
-- "System". A task created with no actor is credited to its created_by_id.
--
-- Not tracked (they change on their own, not by an edit): updated_at, the
-- reminder / overdue / escalation watermarks, time logged, the running-timer
-- start and meta other than the action-point checklist.
--
-- Tasks made or edited before this migration have no rows here; the timeline
-- shows their creation from the task itself and says earlier edits were not
-- itemised. Additive only.

CREATE TABLE IF NOT EXISTS task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id uuid,
  event text NOT NULL CHECK (event IN ('created', 'updated')),
  -- { "<column>": { "from": <old>, "to": <new> }, ... }; empty for 'created'.
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_history_task_idx ON task_history (tenant_id, task_id, at DESC);

ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_history;
CREATE POLICY tenant_isolation ON task_history
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

CREATE OR REPLACE FUNCTION record_task_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
  o jsonb;
  n jsonb;
  k text;
  diff jsonb := '{}'::jsonb;
  tracked text[] := ARRAY[
    'title', 'description', 'remarks', 'type', 'priority', 'status', 'assignee_id',
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

DROP TRIGGER IF EXISTS tasks_record_history ON tasks;
CREATE TRIGGER tasks_record_history
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION record_task_history();
