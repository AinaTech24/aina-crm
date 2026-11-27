-- 0296 — Task attachments on create, several at once; client / lead name
-- at the top of the task page (2026-11-27).
--
-- Switches the per-firm flags taskAttachmentsMulti and taskHeaderSubject on for Investment Options,
-- matched by its tenant id (a database without that firm changes nothing).
-- Only those keys of the firm's own override are set. No schema change.

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"taskAttachmentsMulti": true, "taskHeaderSubject": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND (COALESCE(s.feature_flags_override ->> 'taskAttachmentsMulti', 'false') <> 'true'
        OR COALESCE(s.feature_flags_override ->> 'taskHeaderSubject', 'false') <> 'true');
