-- 0292 — Task request table (2026-11-25).
--
-- Switches the per-firm flag taskRequestTable on for Investment Options,
-- matched by its tenant id (a database without that firm changes nothing):
-- the New task form's Client requests becomes a table, one row per request,
-- each for the client or a member of their family. Only that one key of the
-- firm's own override is set. No schema change.

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"taskRequestTable": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'taskRequestTable', 'false') <> 'true';
