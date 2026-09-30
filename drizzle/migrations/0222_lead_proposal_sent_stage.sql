-- One lead stage list: New → Contacted → Meeting Scheduled → Meeting Done →
-- Proposal Sent → Won / Lost (src/lib/leads/stages.ts).
--
-- "Proposal Sent" was not a stage of the Lead → Client SOP, so the Leads board
-- could not hold a lead there and an imported `proposal_sent` was quietly
-- counted as Won. This adds it to every firm's lead blueprint, right after
-- Meeting Done, with the transitions the code defines
-- (LEAD_TO_CLIENT_TRANSITIONS in src/lib/blueprints/lead_to_client.ts):
--
--   Meeting Done  → Proposal Sent   "Proposal Sent"
--   Proposal Sent → Won Lead        "Proposal Accepted"
--   Proposal Sent → Not Qualified   "Proposal Declined"
--   Proposal Sent → Meeting Scheduled "Schedule Follow-up Meeting"
--
-- Meeting Done → Won Lead stays: a lead can be won without a formal proposal.
-- Stages after Meeting Done move down one place so the order stays a sequence.
-- A firm whose blueprint has no Meeting Done stage (redesigned in the
-- designer) is left alone. Idempotent: a blueprint that already has the stage
-- is skipped.
--
-- Leads already stored with the legacy values proposal_sent / proposal_shared
-- / proposal_drafted need no change: the board's Proposal Sent column holds
-- all three.

WITH targets AS (
  SELECT d.id AS blueprint_id, d.tenant_id, md.stage_order AS after_order
    FROM blueprint_definitions d
    JOIN blueprint_stages md ON md.blueprint_id = d.id AND md.stage_key = 'meeting_done'
   WHERE d.module_name = 'leads'
     AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'proposal_sent')
)
UPDATE blueprint_stages s
   SET stage_order = s.stage_order + 1, updated_at = now()
  FROM targets t
 WHERE s.blueprint_id = t.blueprint_id AND s.stage_order > t.after_order;

INSERT INTO blueprint_stages (tenant_id, blueprint_id, stage_key, stage_name, description, stage_order,
                              owner_role, required_fields, sla_days, allowed_actions)
SELECT d.tenant_id, d.id, 'proposal_sent', 'Proposal Sent',
       'Proposal shared with the client; waiting for their decision.',
       md.stage_order + 1, 'sales', '[]'::jsonb, 3, '["mark_won_lead", "mark_not_qualified"]'::jsonb
  FROM blueprint_definitions d
  JOIN blueprint_stages md ON md.blueprint_id = d.id AND md.stage_key = 'meeting_done'
 WHERE d.module_name = 'leads'
   AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'proposal_sent');

INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name)
SELECT s.tenant_id, s.blueprint_id, v.from_key, v.to_key, v.name
  FROM blueprint_stages s
  CROSS JOIN (VALUES
    ('meeting_done', 'proposal_sent', 'Proposal Sent'),
    ('proposal_sent', 'won_lead', 'Proposal Accepted'),
    ('proposal_sent', 'not_qualified', 'Proposal Declined'),
    ('proposal_sent', 'meeting_scheduled', 'Schedule Follow-up Meeting')
  ) AS v(from_key, to_key, name)
 WHERE s.stage_key = 'proposal_sent'
   AND EXISTS (SELECT 1 FROM blueprint_stages a WHERE a.blueprint_id = s.blueprint_id AND a.stage_key = v.from_key)
   AND EXISTS (SELECT 1 FROM blueprint_stages b WHERE b.blueprint_id = s.blueprint_id AND b.stage_key = v.to_key)
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;
