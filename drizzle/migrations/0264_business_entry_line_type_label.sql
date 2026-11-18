-- 0264 — a business entry line's own type label (We Care Freedom Wealth,
-- 2026-11-18). A firm moving off Zoho books lines with Zoho's picklist values —
-- "Red. Done by Client", "Transfer Out from Our Code", "Broker Code Change in
-- Our Code", "Switch In Our Code", "SIP Pause", "SIP Auto Stop", "Daily SIP".
-- The line keeps a standard txn_type (how it COUNTS: redemption, lumpsum,
-- switch, sip_stop, sip, other) and this column carries the label people see.
-- Null = the standard label. Additive; no backfill.

ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS type_label text;
