-- 0299 — Every screen shows the whole client book, for Investment Options
-- (2026-11-27).
--
-- The firm runs one shared client book: its client list and client pages
-- already show every client to every user. Screens that ask for "View all
-- clients" (business entries, activities, calendar, communications, goals,
-- plans …) still narrowed RMs and branch heads to their own. The
-- clientBookEverywhere flag (config/feature-flags.ts, lib/auth/shared-book.ts)
-- lifts that. Matched by the firm's tenant id (a database without that firm
-- changes nothing); only that one key of the firm's own override is set. No
-- schema change.

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"clientBookEverywhere": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'clientBookEverywhere', 'false') <> 'true';
