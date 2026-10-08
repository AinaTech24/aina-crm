-- 0232 — A physical route through the client journey: forms to the RTA.
--
-- After KYC Validated the Lead → Client SOP only knew the exchange route
-- (UCC → mandate → order on BSE / NSE / MFU). A client who invests by signed
-- forms submitted at CAMS / KFintech / the AMC needs none of that, so this adds
-- a second route (src/lib/blueprints/lead_to_client.ts PHYSICAL_ROUTE_KEYS):
--
--   KYC Validated → Forms Ready → Client Signed → Submitted to RTA
--                → Processed by RTA → Family Mapping        (the shared tail)
--                ↘ Rejected by RTA → resubmit / redo forms
--
-- leads.onboarding_route records which route a client is on (set by the
-- journey when it enters either route), so the journey bar shows one path.
-- leads.rta_submission keeps the submission details (RTA, service centre,
-- acknowledgement no., date) and each resubmission.
--
-- The five stages go right after Transaction Failed; later stages move down
-- five places. A blueprint without Transaction Failed / Family Mapping
-- (redesigned in the designer) is left alone. Idempotent. Additive only.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS onboarding_route text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rta_submission jsonb;

WITH targets AS (
  SELECT d.id AS blueprint_id, tf.stage_order AS after_order
    FROM blueprint_definitions d
    JOIN blueprint_stages tf ON tf.blueprint_id = d.id AND tf.stage_key = 'transaction_failed'
   WHERE d.module_name = 'leads'
     AND EXISTS (SELECT 1 FROM blueprint_stages fm WHERE fm.blueprint_id = d.id AND fm.stage_key = 'family_mapping')
     AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = 'rta_submitted')
)
UPDATE blueprint_stages s
   SET stage_order = s.stage_order + 5, updated_at = now()
  FROM targets t
 WHERE s.blueprint_id = t.blueprint_id AND s.stage_order > t.after_order;

INSERT INTO blueprint_stages (tenant_id, blueprint_id, stage_key, stage_name, description, stage_order,
                              owner_role, required_fields, sla_days, allowed_actions)
SELECT d.tenant_id, d.id, v.stage_key, v.stage_name, v.description, tf.stage_order + v.n,
       v.owner_role, '[]'::jsonb, v.sla_days, v.allowed_actions::jsonb
  FROM blueprint_definitions d
  JOIN blueprint_stages tf ON tf.blueprint_id = d.id AND tf.stage_key = 'transaction_failed'
  CROSS JOIN (VALUES
    (1, 'rta_forms_ready',   'Forms Ready',       'Application form, SIP / NACH form and cheque (or NEFT proof) prepared for a physical transaction.', 'back_office', 2, '["rta_client_signed", "rta_submitted"]'),
    (2, 'rta_client_signed', 'Client Signed',     'The client has signed the forms; upload them to the client''s documents.',                          'back_office', 2, '["rta_submitted"]'),
    (3, 'rta_submitted',     'Submitted to RTA',  'Forms submitted at CAMS / KFintech / the AMC; waiting for the registrar to process them.',           'operations',  7, '["rta_processed", "rta_rejected"]'),
    (4, 'rta_processed',     'Processed by RTA',  'The registrar processed the transaction and allotted units / a folio.',                               'operations',  1, '["family_mapping"]'),
    (5, 'rta_rejected',      'Rejected by RTA',   'The registrar rejected the submission (signature, cheque, KYC…). Correct it and resubmit.',           'operations',  2, '["rta_submitted", "rta_forms_ready"]')
  ) AS v(n, stage_key, stage_name, description, owner_role, sla_days, allowed_actions)
 WHERE d.module_name = 'leads'
   AND EXISTS (SELECT 1 FROM blueprint_stages fm WHERE fm.blueprint_id = d.id AND fm.stage_key = 'family_mapping')
   AND NOT EXISTS (SELECT 1 FROM blueprint_stages x WHERE x.blueprint_id = d.id AND x.stage_key = v.stage_key);

INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name)
SELECT s.tenant_id, s.blueprint_id, v.from_key, v.to_key, v.name
  FROM blueprint_stages s
  CROSS JOIN (VALUES
    ('kyc_validated', 'rta_forms_ready', 'Physical via RTA'),
    ('rta_forms_ready', 'rta_client_signed', 'Client Signed'),
    ('rta_forms_ready', 'rta_submitted', 'Submitted to RTA'),
    ('rta_client_signed', 'rta_submitted', 'Submitted to RTA'),
    ('rta_submitted', 'rta_processed', 'Processed by RTA'),
    ('rta_submitted', 'rta_rejected', 'Rejected by RTA'),
    ('rta_rejected', 'rta_submitted', 'Resubmitted to RTA'),
    ('rta_rejected', 'rta_forms_ready', 'Redo Forms'),
    ('rta_processed', 'family_mapping', 'Map Family')
  ) AS v(from_key, to_key, name)
 WHERE s.stage_key = 'rta_submitted'
   AND EXISTS (SELECT 1 FROM blueprint_stages a WHERE a.blueprint_id = s.blueprint_id AND a.stage_key = v.from_key)
   AND EXISTS (SELECT 1 FROM blueprint_stages b WHERE b.blueprint_id = s.blueprint_id AND b.stage_key = v.to_key)
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;
