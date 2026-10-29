-- Opportunity journey (MF): KYC check, UCC active and Mandate active are no
-- longer steps (the firm's request, 2026-10-17). They belong to client
-- onboarding; "Transaction placed" still cannot be entered without KYC
-- verified, a UCC and, for a SIP, a mandate covering it (gateFor in
-- src/lib/opportunities/journey.ts). Source of truth:
-- src/lib/opportunities/stages.ts.
--
--   accepted → mf_kyc → mf_ucc → mf_mandate → mf_transaction
-- becomes
--   accepted → mf_transaction
--
-- 1. An open opportunity standing at one of the three steps goes back to
--    "Client accepted", with a history row saying why; it moves on to
--    Transaction placed as soon as the checks are met (sync / Move to).
-- 2. Stored blueprints (per firm) lose the three stages and their
--    transitions, gain accepted → mf_transaction, and the stages after them
--    move up so the order stays a sequence.
-- Idempotent: a blueprint without the three stages is left alone.

-- 1. Opportunities standing at a removed step.
WITH moved AS (
  SELECT i.id, i.tenant_id, i.subject_id, i.current_stage_key
    FROM blueprint_instances i
    JOIN blueprint_definitions d ON d.id = i.blueprint_id AND d.module_name = 'opportunities'
   WHERE i.subject_type = 'opportunity'
     AND i.current_stage_key IN ('mf_kyc', 'mf_ucc', 'mf_mandate')
), closed AS (
  UPDATE blueprint_stage_history h
     SET exited_at = now(),
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - h.entered_at)))::int,
         transition_name = 'Step removed',
         updated_at = now()
    FROM moved m
   WHERE h.instance_id = m.id AND h.stage_key = m.current_stage_key AND h.exited_at IS NULL
  RETURNING h.id
), entered AS (
  INSERT INTO blueprint_stage_history (tenant_id, subject_type, subject_id, instance_id, stage_key, entered_at,
                                       transition_name, remarks)
  SELECT m.tenant_id, 'opportunity', m.subject_id, m.id, 'accepted', now(), 'Step removed',
         'KYC, UCC and mandate are no longer steps; it moves on to Transaction placed once they are on file'
    FROM moved m
  RETURNING id
)
UPDATE blueprint_instances i
   SET current_stage_key = 'accepted', stage_entered_at = now(), is_delayed = false, delayed_since = NULL,
       updated_at = now()
  FROM moved m
 WHERE i.id = m.id;

-- 2. Stored blueprints: renumber, re-link, then drop the three stages.
UPDATE blueprint_stages s
   SET stage_order = s.stage_order - (
         SELECT count(*) FROM blueprint_stages r
          WHERE r.blueprint_id = s.blueprint_id
            AND r.stage_key IN ('mf_kyc', 'mf_ucc', 'mf_mandate')
            AND r.stage_order < s.stage_order),
       updated_at = now()
  FROM blueprint_definitions d
 WHERE d.id = s.blueprint_id AND d.module_name = 'opportunities'
   AND s.stage_key NOT IN ('mf_kyc', 'mf_ucc', 'mf_mandate')
   AND EXISTS (SELECT 1 FROM blueprint_stages r
                WHERE r.blueprint_id = s.blueprint_id AND r.stage_key IN ('mf_kyc', 'mf_ucc', 'mf_mandate')
                  AND r.stage_order < s.stage_order);

INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name)
SELECT a.tenant_id, a.blueprint_id, 'accepted', 'mf_transaction', 'Transaction placed'
  FROM blueprint_stages a
  JOIN blueprint_definitions d ON d.id = a.blueprint_id AND d.module_name = 'opportunities'
 WHERE a.stage_key = 'accepted'
   AND EXISTS (SELECT 1 FROM blueprint_stages t WHERE t.blueprint_id = a.blueprint_id AND t.stage_key = 'mf_transaction')
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;

DELETE FROM blueprint_transitions t
 USING blueprint_definitions d
 WHERE t.blueprint_id = d.id AND d.module_name = 'opportunities'
   AND (t.from_stage_key IN ('mf_kyc', 'mf_ucc', 'mf_mandate') OR t.to_stage_key IN ('mf_kyc', 'mf_ucc', 'mf_mandate'));

DELETE FROM blueprint_stages s
 USING blueprint_definitions d
 WHERE s.blueprint_id = d.id AND d.module_name = 'opportunities'
   AND s.stage_key IN ('mf_kyc', 'mf_ucc', 'mf_mandate');
