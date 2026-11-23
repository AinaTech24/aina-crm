-- Shah Financial Services (ARN-173086) keeps its families by hand (2026-11-23,
-- the owner's request): an RTA import must not create or fill families on its
-- own. That is the per-firm switch "Do not create families automatically"
-- (feature flag noAutoFamilies, src/config/feature-flags.ts, read by
-- src/lib/families/auto.ts). It is switched on here for this one firm, matched
-- by its ARN; any other firm gets it from Aina Admin → the firm → Feature flags.
--
-- Idempotent. Only the one key of the firm's own override is set, so the rest of
-- its overrides are untouched; the package's flags are not changed.

-- subscriptions and tenants force row-level security; this finds the firm by ARN
-- across tenants, so it runs with the platform flag the tenant_isolation policy
-- honours. Local to this file's transaction.
SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions s
   SET feature_flags_override = COALESCE(s.feature_flags_override, '{}'::jsonb) || '{"noAutoFamilies": true}'::jsonb
 WHERE s.tenant_id IN (SELECT t.id FROM tenants t WHERE t.arn LIKE '%173086%')
   AND COALESCE(s.feature_flags_override ->> 'noAutoFamilies', 'false') <> 'true';
