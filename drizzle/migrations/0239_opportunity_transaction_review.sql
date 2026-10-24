-- Opportunity journey (MF): a new step after "Transaction placed" —
-- "Approve / reject transaction" (txn_review). Operations approves it (a task
-- is created and the client is won) or rejects it (back to Transaction placed).
-- Source of truth: src/lib/opportunities/stages.ts.
--
-- Stored blueprints are per firm and seeded once, so a firm that already has
-- the opportunities blueprint needs the stage and its transitions added here:
--
--   mf_transaction → txn_review   "Approve / reject transaction"
--   txn_review     → won          "Won — held with us"
--   txn_review     → mf_transaction "Transaction rejected — place again"
--   txn_review     → lost         "Lost"
--
-- mf_transaction → won goes: the transaction is no longer the last step.
-- Stages after Transaction placed move down one place so the order stays a
-- sequence. A blueprint without Transaction placed (redesigned in the
-- designer) is left alone. Idempotent.
--
-- Opportunities standing at Won are unchanged; one standing at Transaction
-- placed whose transaction is already on file moves to the new step the next
-- time the journey is synced.

WITH targets AS (
  SELECT d.id AS blueprint_id, mt.stage_order AS after_order
    FROM blueprint_definitions d
    JOIN blueprint_stages mt ON mt.blueprint_id = d.id AND mt.stage_key = 'mf_transaction'
   WHERE d.module_name = 'opportunities'
     AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'txn_review')
)
UPDATE blueprint_stages s
   SET stage_order = s.stage_order + 1, updated_at = now()
  FROM targets t
 WHERE s.blueprint_id = t.blueprint_id AND s.stage_order > t.after_order;

INSERT INTO blueprint_stages (tenant_id, blueprint_id, stage_key, stage_name, description, stage_order,
                              owner_role, required_fields, sla_days, allowed_actions)
SELECT d.tenant_id, d.id, 'txn_review', 'Approve / reject transaction',
       'Operations checks the transaction. Approved: a task is created and the client is won. Rejected: it goes back to Transaction placed with a task to fix it.',
       mt.stage_order + 1, 'back_office', '[]'::jsonb, 2, '["approve_transaction", "reject_transaction"]'::jsonb
  FROM blueprint_definitions d
  JOIN blueprint_stages mt ON mt.blueprint_id = d.id AND mt.stage_key = 'mf_transaction'
 WHERE d.module_name = 'opportunities'
   AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'txn_review');

DELETE FROM blueprint_transitions t
 USING blueprint_definitions d
 WHERE t.blueprint_id = d.id AND d.module_name = 'opportunities'
   AND t.from_stage_key = 'mf_transaction' AND t.to_stage_key = 'won'
   AND EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'txn_review');

INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name)
SELECT s.tenant_id, s.blueprint_id, v.from_key, v.to_key, v.name
  FROM blueprint_stages s
  CROSS JOIN (VALUES
    ('mf_transaction', 'txn_review', 'Approve / reject transaction'),
    ('txn_review', 'won', 'Won — held with us'),
    ('txn_review', 'mf_transaction', 'Transaction rejected — place again'),
    ('txn_review', 'lost', 'Lost')
  ) AS v(from_key, to_key, name)
 WHERE s.stage_key = 'txn_review'
   AND EXISTS (SELECT 1 FROM blueprint_stages a WHERE a.blueprint_id = s.blueprint_id AND a.stage_key = v.from_key)
   AND EXISTS (SELECT 1 FROM blueprint_stages b WHERE b.blueprint_id = s.blueprint_id AND b.stage_key = v.to_key)
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;
