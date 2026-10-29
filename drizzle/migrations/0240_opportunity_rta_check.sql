-- Opportunity journey (MF): a new step after "Approve / reject transaction" —
-- "RTA data check" (rta_check). Approving the transaction now moves the
-- opportunity here and creates a task to check the transaction against the RTA
-- data; the client is won only once that task is completed.
-- Source of truth: src/lib/opportunities/stages.ts.
--
-- Stored blueprints are per firm and seeded once, so a firm that already has
-- the opportunities blueprint needs the stage and its transitions added here:
--
--   txn_review → rta_check   "RTA data check"
--   rta_check  → won         "Won — held with us"
--   rta_check  → lost        "Lost"
--
-- txn_review → won goes: approval no longer wins the client. Stages after
-- "Approve / reject transaction" move down one place so the order stays a
-- sequence. A blueprint without that stage (redesigned in the designer) is
-- left alone. Idempotent.
--
-- An opportunity already standing at Won is unchanged; one standing at
-- "Approve / reject transaction" is approved into the new step as before.

WITH targets AS (
  SELECT d.id AS blueprint_id, tr.stage_order AS after_order
    FROM blueprint_definitions d
    JOIN blueprint_stages tr ON tr.blueprint_id = d.id AND tr.stage_key = 'txn_review'
   WHERE d.module_name = 'opportunities'
     AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'rta_check')
)
UPDATE blueprint_stages s
   SET stage_order = s.stage_order + 1, updated_at = now()
  FROM targets t
 WHERE s.blueprint_id = t.blueprint_id AND s.stage_order > t.after_order;

INSERT INTO blueprint_stages (tenant_id, blueprint_id, stage_key, stage_name, description, stage_order,
                              owner_role, required_fields, sla_days, allowed_actions)
SELECT d.tenant_id, d.id, 'rta_check', 'RTA data check',
       'A task is created to check the transaction against the RTA (CAMS / KFintech) data. The client is won only once that task is completed.',
       tr.stage_order + 1, 'back_office', '[]'::jsonb, 5, '["check_rta_status"]'::jsonb
  FROM blueprint_definitions d
  JOIN blueprint_stages tr ON tr.blueprint_id = d.id AND tr.stage_key = 'txn_review'
 WHERE d.module_name = 'opportunities'
   AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'rta_check');

UPDATE blueprint_stages
   SET description = 'Operations checks the transaction. Approved: it moves to the RTA data check. Rejected: it goes back to Transaction placed with a task to fix it.',
       updated_at = now()
 WHERE stage_key = 'txn_review'
   AND blueprint_id IN (SELECT id FROM blueprint_definitions WHERE module_name = 'opportunities');

DELETE FROM blueprint_transitions t
 USING blueprint_definitions d
 WHERE t.blueprint_id = d.id AND d.module_name = 'opportunities'
   AND t.from_stage_key = 'txn_review' AND t.to_stage_key = 'won'
   AND EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'rta_check');

INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name)
SELECT s.tenant_id, s.blueprint_id, v.from_key, v.to_key, v.name
  FROM blueprint_stages s
  CROSS JOIN (VALUES
    ('txn_review', 'rta_check', 'RTA data check'),
    ('rta_check', 'won', 'Won — held with us'),
    ('rta_check', 'lost', 'Lost')
  ) AS v(from_key, to_key, name)
 WHERE s.stage_key = 'rta_check'
   AND EXISTS (SELECT 1 FROM blueprint_stages a WHERE a.blueprint_id = s.blueprint_id AND a.stage_key = v.from_key)
   AND EXISTS (SELECT 1 FROM blueprint_stages b WHERE b.blueprint_id = s.blueprint_id AND b.stage_key = v.to_key)
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;
