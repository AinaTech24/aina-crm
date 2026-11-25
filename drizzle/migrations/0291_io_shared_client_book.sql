-- 0291 — Investment Options: every user sees every client (2026-11-25).
--
-- The firm's request: all clients visible to all users. Matched by the firm's
-- tenant id, so a database without that firm changes nothing.
--   1. The data wall off (tenants.restrict_user_data_scope = false): on the
--      web an RM no longer sees only their own clients, nor a branch head
--      only their branch. Users whose access was customised one by one keep
--      what was ticked for them (none at Investment Options today).
--   2. The per-firm flag sharedClientBook on: the mobile app drops its own
--      book / own branch rule for clients and families too.
-- Leads stay with their owner (lead scoping is separate).

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE tenants
   SET restrict_user_data_scope = false
 WHERE id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND restrict_user_data_scope IS DISTINCT FROM false;

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"sharedClientBook": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'sharedClientBook', 'false') <> 'true';
