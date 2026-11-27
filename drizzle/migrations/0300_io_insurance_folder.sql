-- 0300 — One Insurance folder in the sidebar, for Investment Options
-- (2026-11-27).
--
-- Every insurance page (policies, renewals, claims, protection gap,
-- commission) becomes its own item in an "Insurance" sidebar group instead of
-- one Insurance item under Planning Tools (insuranceFolder flag,
-- config/feature-flags.ts; app/dashboard/layout.tsx). Matched by the firm's
-- tenant id (a database without that firm changes nothing); only that one key
-- of the firm's own override is set. No schema change.

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"insuranceFolder": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'insuranceFolder', 'false') <> 'true';
