-- 0297 — Insurance task requests for Investment Options (2026-11-27).
--
-- The insuranceTasks flag (config/feature-flags.ts) was built for Investment
-- Options on 2026-11-20 but never switched on for the firm, so the New task
-- form offered only mutual fund requests. This sets it, matched by the firm's
-- tenant id (a database without that firm changes nothing). Only that one key
-- of the firm's own override is set. No schema change.

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"insuranceTasks": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'insuranceTasks', 'false') <> 'true';
