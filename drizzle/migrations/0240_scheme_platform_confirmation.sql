-- 0240 — a code confirmed by a PLATFORM approval (Phase 3I)
--
-- A FORWARD migration (0238 and 0239 are not edited). 0238's
-- scheme_rta_codes_confirm_ck requires a firm confirmer for status
-- 'confirmed'. A registrar code that two platform operators approved for every
-- firm (scheme_registrar_map, basis platform_approval) is 'confirmed' for the
-- firm with reason_code 'platform_approved' and no firm confirmer — the
-- approval, both operators and the note are in scheme_registrar_map and its
-- append-only events. Every other confirmation still needs the firm's person,
-- time and a note of at least 10 characters.
--
-- Lock risk: NOT VALID then VALIDATE — the scan runs under SHARE UPDATE
-- EXCLUSIVE, not the ADD's ACCESS EXCLUSIVE. scheme_rta_codes is small (one
-- row per registrar code per firm).

SET LOCAL lock_timeout = '5s';

ALTER TABLE scheme_rta_codes DROP CONSTRAINT IF EXISTS scheme_rta_codes_confirm_ck;
ALTER TABLE scheme_rta_codes ADD CONSTRAINT scheme_rta_codes_confirm_ck CHECK (
  status <> 'confirmed' OR reason_code = 'platform_approved'
  OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(coalesce(confirm_note, ''))) >= 10)) NOT VALID;
ALTER TABLE scheme_rta_codes VALIDATE CONSTRAINT scheme_rta_codes_confirm_ck;
