-- Where every rupee of a SIP register went (2026-11-27, Akshar / Urmi). processSipBook tallies the registrar's live
-- registrations by what became of each (in the book, a client the dashboards do not count, closed here, not placed,
-- refused) and keeps the tally on the import, so the SIP Book page can say HOW MUCH the book differs from the register
-- and why. NULL for every other kind of file and for imports made before this. (A separate column: `summary`, from
-- migration 0146, holds the folio-master reconciliation and is not touched.)
ALTER TABLE rta_file_imports ADD COLUMN IF NOT EXISTS sip_summary jsonb;
