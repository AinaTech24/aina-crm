-- 0277 — Reports home, Zoho-style (2026-11-19).
--
--   · saved_reports.deleted_at — a deleted custom report goes to "Recently
--     deleted" for 30 days and can be restored (it was a hard delete).
--   · saved_reports.viewed_by — { user_id: last-opened ISO time }, for each
--     viewer's "Recently viewed".
--   · saved_reports.chart_options — { target?, limit? }: the chart's dashed
--     target line and how many groups it draws.
--   · saved_reports.categories — up to two category columns: a number field
--     cut into bands (AUM bands) or values gathered into groups (cities →
--     regions), usable as a column, group or pivot (lib/reports/categories.ts).
--   · report_user_prefs — per user: favourite STANDARD reports (they were kept
--     per device in localStorage, so they did not follow a person to another
--     laptop), recently opened standard reports, and saved views (a standard
--     report with its period / RM / branch, under the person's own name).
--
-- Additive and idempotent. The new table gets its tenant_isolation policy here.

ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS viewed_by jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS chart_options jsonb;
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS categories jsonb;

CREATE INDEX IF NOT EXISTS saved_reports_deleted_idx ON saved_reports (tenant_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_user_prefs (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  favourites  jsonb NOT NULL DEFAULT '[]'::jsonb,
  recent      jsonb NOT NULL DEFAULT '[]'::jsonb,
  views       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE report_user_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_user_prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_user_prefs;
CREATE POLICY tenant_isolation ON report_user_prefs FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

