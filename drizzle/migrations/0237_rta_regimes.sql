-- 0237 — RTA regimes: emergency shutdown, paused firms, two people to resume (Phase 3H)
--
-- A FORWARD migration: 0236 is applied history and is not edited.
--
--   * rta_posting_controls gains the scope 'emergency'. No row = no emergency.
--     Halting it (one operator) stops EVERY RTA financial write for every firm,
--     the existing importer included; releasing it needs two people (0236's
--     release check already says so for any scope). 'global' keeps its meaning:
--     the new pipeline's posting switch, installed halted.
--   * rta_pipeline_activations gains mode 'paused'. A firm whose latest
--     activation ended (revoked / expired) is ALSO treated as paused by the
--     code — it never falls back to the existing importer by itself.
--   * Every activation except a pause needs a requester and a different
--     approver (one person may stop things; two must start them). NOT VALID:
--     rows recorded before this rule are left as they are.
--
-- Lock risk: constraint swaps on two small control tables; lock_timeout bounds it.

SET LOCAL lock_timeout = '5s';

ALTER TABLE rta_posting_controls DROP CONSTRAINT IF EXISTS rta_posting_controls_scope_ck;
ALTER TABLE rta_posting_controls ADD CONSTRAINT rta_posting_controls_scope_ck
  CHECK (scope IN ('global', 'emergency') OR scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

ALTER TABLE rta_pipeline_activations DROP CONSTRAINT IF EXISTS rta_pipeline_activations_mode_ck;
ALTER TABLE rta_pipeline_activations ADD CONSTRAINT rta_pipeline_activations_mode_ck
  CHECK (mode IN ('off', 'shadow', 'validate_first', 'paused'));

ALTER TABLE rta_pipeline_activations DROP CONSTRAINT IF EXISTS rta_pipeline_activations_start_two_person_ck;
ALTER TABLE rta_pipeline_activations ADD CONSTRAINT rta_pipeline_activations_start_two_person_ck
  CHECK (mode = 'paused' OR (requested_by IS NOT NULL AND requested_by <> approved_by)) NOT VALID;

ALTER TABLE rta_pipeline_activations DROP CONSTRAINT IF EXISTS rta_pipeline_activations_pause_ck;
ALTER TABLE rta_pipeline_activations ADD CONSTRAINT rta_pipeline_activations_pause_ck
  CHECK (mode <> 'paused' OR NOT posting_enabled);
