-- B-1 stabilisation, I-4: which firms would the candidate's stricter AUM / SIP
-- readers affect?  READ-ONLY. Run as the production master or a read-only role,
-- under the change lock's "status" (no lock needed for a read). It prints
-- counts and firm ids only — no file names, PANs, folios or client data.
--
-- Background: `main` takes line 1 as the header only if it names a folio / PAN /
-- mandate column; otherwise it reads EVERY line by a fixed column position the
-- CRM invented (parsers.ts DEFAULT_SIP_BOOK_MAP / DEFAULT_AUM_STATEMENT_MAP).
-- That includes real registrar files whose header is not on line 1. The
-- candidate searches the first 10 lines for the header and refuses a file
-- without one (RtaLayoutError: the import is `failed` with its reason, the
-- stored file is kept). The database does not record which path `main` took,
-- so this query finds the imports that COULD have been affected; infra then
-- inspects the first lines of those stored objects (step 3).

-- 1. Every completed or failed AUM / SIP-book import, per firm, source, month.
SELECT tenant_id,
       kind,
       source,
       date_trunc('month', created_at)::date AS month,
       count(*)                               AS imports,
       count(*) FILTER (WHERE status = 'completed') AS completed,
       sum(coalesce(rows_imported, 0))        AS rows_imported
  FROM rta_file_imports
 WHERE kind IN ('monthly_aum_statement', 'monthly_sip_book')
   AND deleted_at IS NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2, 4;

-- 2. Symptoms a positional mis-read leaves behind (counts per firm only):
--    a folio number that is an ARN, a PAN, or a bare product / plan code.
SELECT tenant_id,
       count(*) FILTER (WHERE folio_number ~* '^ARN[- ]?[0-9]+$')            AS folio_is_arn,
       count(*) FILTER (WHERE folio_number ~  '^[A-Z]{5}[0-9]{4}[A-Z]$')      AS folio_is_pan_shaped,
       count(*) FILTER (WHERE folio_number ~  '^[A-Z]{1,4}[0-9]{0,3}$')       AS folio_is_short_code
  FROM folios
 GROUP BY 1
HAVING count(*) FILTER (WHERE folio_number ~* '^ARN[- ]?[0-9]+$'
                           OR folio_number ~  '^[A-Z]{5}[0-9]{4}[A-Z]$'
                           OR folio_number ~  '^[A-Z]{1,4}[0-9]{0,3}$') > 0
 ORDER BY 1;

-- 3. (Infra, not SQL) For the imports in (1), read the first 10 lines of each
--    stored object (rta_file_imports.file_key in the RTA bucket) WITHOUT
--    downloading the rest, and record only: does line 1 name a folio / PAN
--    column (yes / no), and does any of lines 1–10 (yes / no). A file with
--    "no" in both was read positionally by `main` and will be REFUSED by the
--    candidate; "no / yes" was read positionally by `main` — with the real WBR49 /
--    MFSD243 / MFSD230 samples plus a title line that gave a `completed` import
--    of 0 rows, silently — and is read correctly by the candidate. Never copy
--    the file off the box.
