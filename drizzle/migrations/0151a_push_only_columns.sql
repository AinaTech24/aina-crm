-- 0151a_push_only_columns.sql
--
-- Three columns in src/db/schema never appeared in any migration: they reached
-- every existing database through `drizzle-kit push`. A FRESH, migrations-only
-- database therefore lacked them — 0152 died updating subscriptions.modules_override,
-- and users.permissions (per-user RBAC overrides) was silently absent, which the
-- app would only discover at runtime.
--
-- Placed just before 0152, the first migration that touches one of them.
-- Idempotent (IF NOT EXISTS), so it is a no-op on production and every dev DB.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS modules_override jsonb;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS allowed_fields jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb;
