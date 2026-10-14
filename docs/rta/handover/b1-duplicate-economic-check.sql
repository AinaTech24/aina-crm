-- Operational preflight (2026-10-14), Task 4a: has the LEGACY importer recorded
-- one registrar transaction TWICE?  READ-ONLY. Counts and sums per firm only —
-- no folio, PAN, name or registrar number is printed.
--
-- Run as the DBA on production (read-only session) or on the copy:
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -f docs/rta/handover/b1-duplicate-economic-check.sql
--
-- What it can and cannot say. transactions.order_id is unique per firm, so the
-- SAME registrar number cannot be stored twice; a duplicate can only exist as
-- two rows with different keys and the same economic facts — e.g. a row keyed
-- by file line (<rta>_<line>, the pre-Phase-2 importer) beside the same
-- transaction keyed by its registrar number, or a manual / CSV entry beside the
-- registrar's. Identical facts are NOT proof: two SIP registrations of the same
-- amount in one scheme debit on the same day legitimately. So:
--   (1) is exposure — groups of rows with identical facts and different keys;
--   (2) narrows to the shapes a duplicate leaves (a line-keyed or keyless row in
--       the group, or rows from different sources);
--   (3) the amount at stake if every extra row in (2) were a duplicate — an
--       UPPER BOUND, never a finding.
-- Confirmation needs the registrar file: the legacy-impact diagnostic
-- (scripts/rta-legacy-impact-diagnostic.ts) and, per group, a person.
-- Nothing is repaired from this query. Uses only columns production has today
-- (main's 272 migrations): scheme_code, not the release's rta_scheme_code.

-- 1. Exposure per firm.
WITH g AS (
  SELECT t.tenant_id, t.folio_id, t.scheme_code AS scheme,
         t.order_date, t.type, t.direction, abs(coalesce(t.amount, 0)) AS amt,
         round(abs(coalesce(t.units, 0)), 3) AS units,
         count(*)                                                AS n,
         count(DISTINCT coalesce(t.order_id, t.id::text))        AS keys,
         count(*) FILTER (WHERE t.order_id IS NULL
                             OR t.order_id ~ '^(cams|kfintech|karvy)_[0-9]+$') AS line_or_keyless,
         count(DISTINCT coalesce(t.source_feed, '-'))           AS sources
    FROM transactions t
   WHERE t.folio_id IS NOT NULL
     AND coalesce(t.status, '') NOT IN ('rejected', 'cancelled')
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  HAVING count(*) > 1
)
SELECT tenant_id,
       count(*)                                                    AS identical_fact_groups,
       sum(n - 1)                                                  AS extra_rows,
       count(*) FILTER (WHERE line_or_keyless > 0 OR sources > 1)  AS duplicate_shaped_groups,
       sum(n - 1) FILTER (WHERE line_or_keyless > 0 OR sources > 1) AS duplicate_shaped_extra_rows,
       round(sum((n - 1) * amt) FILTER (WHERE line_or_keyless > 0 OR sources > 1), 2) AS upper_bound_amount
  FROM g
 GROUP BY tenant_id
 ORDER BY tenant_id;

-- 2. The same, by type and source mix, for the firm under review (counts only).
--    Replace <firm>.
WITH g AS (
  SELECT t.folio_id, t.scheme_code AS scheme, t.order_date, t.type, t.direction,
         abs(coalesce(t.amount, 0)) AS amt, round(abs(coalesce(t.units, 0)), 3) AS units,
         count(*) AS n,
         string_agg(DISTINCT coalesce(t.source_feed, '-'), '+' ORDER BY coalesce(t.source_feed, '-')) AS source_mix,
         bool_or(t.order_id IS NULL OR t.order_id ~ '^(cams|kfintech|karvy)_[0-9]+$') AS has_line_or_keyless
    FROM transactions t
   WHERE t.tenant_id = '<firm>' AND t.folio_id IS NOT NULL
     AND coalesce(t.status, '') NOT IN ('rejected', 'cancelled')
   GROUP BY 1, 2, 3, 4, 5, 6, 7
  HAVING count(*) > 1
)
SELECT type, direction, source_mix, has_line_or_keyless,
       count(*) AS groups, sum(n - 1) AS extra_rows, round(sum((n - 1) * amt), 2) AS upper_bound_amount
  FROM g
 GROUP BY 1, 2, 3, 4
 ORDER BY upper_bound_amount DESC NULLS LAST;

-- Reading the result: 0 duplicate-shaped groups is the expected answer. Any
-- other number goes to E-4 for a signed decision per group (accept / exclude
-- the client from the pilot / repair outside the pilot under its own approval).
