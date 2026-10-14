-- B-1 final qualification (Task 2): has the LEGACY KFintech importer affected
-- live records?  Part 1 — EXPOSURE, from the database alone. READ-ONLY.
--
-- Run as the DBA on a read replica, or with
--   PGOPTIONS='-c default_transaction_read_only=on'.
-- Prints counts and sums per firm only — no folio, PAN, name or number.
--
-- The legacy importer kept ONE CRM row per registrar transaction number and
-- stored no source row (no raw row, no registrar code). So the database can
-- say how many records COULD be affected, never which ones are: a redemption
-- reported lot by lot, a folio-correction leg and an unrecognised code all
-- look like ordinary rows. Do not call any record wrong from this query.
-- Part 2 (confirmation) re-reads the stored registrar files:
--   npx tsx scripts/rta-legacy-impact-diagnostic.ts --tenant <uuid> --imports --json out.json
-- (read-only; restricted application role; counts + masked examples).
--
-- On the development copy of the real pilot files, Part 2 found 39 of 1,100
-- legacy KFintech transactions affected (15 truncated multi-lot redemptions,
-- 18 folio-correction legs, 6 unrecognised codes) and 1,061 consistent.

-- 1. Exposure per firm: legacy-written KFintech transactions by shape.
--    redemption / outflow rows are where lot-by-lot truncation can hide;
--    zero-amount and outflow "lumpsum" rows are the shapes unrecognised codes
--    (LTOF, CNO / CNI) took on the development copy.
SELECT t.tenant_id,
       count(*)                                                        AS kfintech_legacy_txns,
       count(*) FILTER (WHERE t.type IN ('redemption', 'swp'))         AS redemption_like,
       count(*) FILTER (WHERE t.type = 'lumpsum' AND t.direction = 'outflow') AS lumpsum_outflow,
       count(*) FILTER (WHERE coalesce(t.amount, 0) = 0)               AS zero_amount,
       round(sum(abs(coalesce(t.amount, 0))), 2)                        AS amount_on_record
  FROM transactions t
  JOIN folios f ON f.id = t.folio_id AND f.tenant_id = t.tenant_id
 WHERE f.rta = 'kfintech'
   AND coalesce(t.source_feed, '') <> 'rta_validate_first'
 GROUP BY t.tenant_id
 ORDER BY t.tenant_id;

-- 2. What Part 2 can read: per firm, the completed KFintech transaction-feed
--    imports whose stored file is still on record.
SELECT tenant_id,
       count(*)                                 AS feed_imports,
       count(*) FILTER (WHERE file_key IS NOT NULL) AS with_stored_file,
       min(created_at)::date                    AS first_import,
       max(created_at)::date                    AS last_import
  FROM rta_file_imports
 WHERE source = 'kfintech' AND kind = 'daily_transaction_feed'
   AND status = 'completed' AND deleted_at IS NULL
 GROUP BY tenant_id
 ORDER BY tenant_id;

-- A firm with exposure in (1) but no stored file in (2) cannot be confirmed
-- from the database; the registrar's file for that period would be needed.
-- Nothing is repaired from either result without a separate, reviewed decision.
