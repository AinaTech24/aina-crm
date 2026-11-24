-- Insurance fields from Zoho (Investment Options, 2026-11-24).
--
-- 1. insurance_claims.details — the claim facts the claim row had no column for
--    (claim no., intimation no., hospital, diagnosis, patient, deduction,
--    discharge / process / payment dates, and who intimated, submitted, visited
--    and called). Read and written by the claim form and page when the firm has
--    the insuranceExtraFields flag (src/lib/insurance/extra-fields.ts).
--    Additive: existing rows get {} and nothing reads it otherwise.
--
-- 2. Switches the per-firm flag insuranceExtraFields on for Investment Options,
--    matched by its tenant id (a database without that firm changes nothing).
--    Only that one key of the firm's own override is set.

ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"insuranceExtraFields": true}'::jsonb
 WHERE s.tenant_id = '3a23335d-b507-4504-a215-b949785500c6'::uuid
   AND COALESCE(s.feature_flags_override ->> 'insuranceExtraFields', 'false') <> 'true';
