-- 0242 matched the firm too narrowly (name 'VSN Financial%' / ARN ending 90577) and may have changed
-- nothing. Same change, matched by the firm's display name 'Sandeep Garg' / 'VSN' or an ARN containing
-- 90577. Idempotent, and a no-op where 0242 already worked.
-- "Portfolio vs Risk Profile — Suitability Note" (template key suitability_review),
-- the VSN CRM only (the firm shown as "Sandeep Garg", ARN-90577): the firm asked for the "Why these were recommended" heading and its paragraph
-- ("These schemes were suggested for your convenience …") to be removed.
-- Other firms and the starter (src/lib/email-designer/starters.ts) keep the wording.
--
-- Versions are immutable, so each firm's CURRENT version is left as it was and a
-- new approved version without the two blocks is published and made current.
-- Only the heading and the paragraph that still starts with the seeded wording
-- are dropped; anything else the firm wrote stays. Idempotent: a version without
-- the heading is skipped.

WITH cur AS (
  SELECT t.id AS template_id, t.tenant_id, v.version_number, v.body, v.variables, v.attachments
    FROM templates t
    JOIN template_versions v ON v.id = t.current_version_id
   WHERE t.key = 'suitability_review' AND t.channel = 'email'
     AND t.tenant_id IN (SELECT id FROM tenants
                          WHERE display_name ILIKE '%VSN%' OR display_name ILIKE 'Sandeep Garg%' OR arn LIKE '%90577%')
     AND jsonb_typeof(v.body -> 'blocks') = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v.body -> 'blocks') b
        WHERE b ->> 'type' = 'heading' AND b ->> 'text' = 'Why these were recommended')
), ins AS (
  INSERT INTO template_versions (id, template_id, tenant_id, version_number, body, variables, attachments, approval_status, approved_at)
  SELECT gen_random_uuid(), c.template_id, c.tenant_id,
         (SELECT COALESCE(max(x.version_number), 0) + 1 FROM template_versions x WHERE x.template_id = c.template_id),
         jsonb_set(c.body, '{blocks}', COALESCE((
           SELECT jsonb_agg(b ORDER BY ord)
             FROM jsonb_array_elements(c.body -> 'blocks') WITH ORDINALITY AS e(b, ord)
            WHERE NOT (b ->> 'type' = 'heading' AND b ->> 'text' = 'Why these were recommended')
              AND NOT (b ->> 'type' = 'text' AND b ->> 'html' LIKE 'These schemes were suggested for your convenience%')
         ), '[]'::jsonb)),
         c.variables, c.attachments, 'approved_internal', now()
    FROM cur c
  RETURNING id, template_id
)
UPDATE templates t SET current_version_id = ins.id, updated_at = now()
  FROM ins WHERE t.id = ins.template_id;
