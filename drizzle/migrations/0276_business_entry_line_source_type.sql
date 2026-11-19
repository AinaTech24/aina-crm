-- 0276 — a business entry line's type as the source system recorded it
-- (We Care Freedom Wealth, 2026-11-19). Zoho's MF Transaction lines carry a
-- "Type" — Liquid, Equity, Liquid to Equity, AIF, PMS — that the firm's own
-- reports filter on (Liquid Purchase, Equity Purchase). The CRM's asset_class
-- is re-derived from the Scheme Master's category, so it cannot hold the
-- firm's own call. Null for lines keyed in the CRM. Additive; filled by the
-- Zoho import and its "Line types" restore.

ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS source_type text;
-- Zoho's "Purchase/Redemption" on the line (Purchase, Redemption, Red. Done by
-- Client …): Zoho files a switch or an STP under Purchase, the CRM counts it as
-- a switch, so the firm's grouping needs Zoho's own word.
ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS source_kind text;
