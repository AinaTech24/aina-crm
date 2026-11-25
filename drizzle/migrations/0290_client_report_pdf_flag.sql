-- 0290 — Client report PDF (2026-11-25).
--
-- Switches the per-firm flag clientReportPdf on for Investment Options,
-- matched by its tenant id (a database without that firm changes nothing).
-- Only that one key of the firm's own override is set. No schema change.

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"clientReportPdf": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'clientReportPdf', 'false') <> 'true';
