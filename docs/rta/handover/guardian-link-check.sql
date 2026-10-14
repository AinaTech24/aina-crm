-- Operational preflight (2026-10-14), Task 4b: how many existing guardian links
-- (investors.guardian_investor_id, set by main's client master since
-- 2026-10-13 and by the legacy RTA importer) are of a shape the code should
-- never have produced?  READ-ONLY. Counts per firm only — no name, PAN or id.
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -f docs/rta/handover/guardian-link-check.sql
--
-- Background (docs/rta/B1_FINAL_QUALIFICATION.md §L): POST / PATCH
-- /api/investors link a minor to "the client whose PAN is the guardian PAN"
-- (first of several, by dedup_pan) or to any guardianInvestorId in the firm,
-- without the user's client scope, without excluding a merged record or a
-- minor. Migration 0234 then copies that client's risk profile onto the minor.

SELECT m.tenant_id,
       t.restrict_user_data_scope                                         AS data_wall_on,
       count(*)                                                            AS minors_linked,
       -- the guardian is in another RM's book / another branch
       count(*) FILTER (WHERE g.rm_id IS DISTINCT FROM m.rm_id)            AS guardian_other_rm,
       count(*) FILTER (WHERE g.branch_id IS DISTINCT FROM m.branch_id)    AS guardian_other_branch,
       -- the link points at a retired, deleted, missing or minor record
       count(*) FILTER (WHERE g.id IS NULL)                                AS guardian_missing,
       count(*) FILTER (WHERE g.merged_into_id IS NOT NULL)                AS guardian_merged,
       count(*) FILTER (WHERE g.deleted_at IS NOT NULL)                    AS guardian_deleted,
       count(*) FILTER (WHERE g.investor_category = 'minor' OR g.is_minor) AS guardian_is_minor,
       -- the guardian's PAN is held by more than one live client (the pick was a guess)
       count(*) FILTER (WHERE g.pan IS NOT NULL AND (
         SELECT count(*) FROM investors o
          WHERE o.tenant_id = g.tenant_id AND o.pan = g.pan
            AND o.deleted_at IS NULL AND o.merged_into_id IS NULL) > 1)    AS guardian_pan_shared,
       -- the guardian PAN typed on the minor differs from the linked client's PAN
       count(*) FILTER (WHERE nullif(upper(trim(m.type_details #>> '{guardian,pan}')), '') IS NOT NULL
                          AND upper(trim(m.type_details #>> '{guardian,pan}')) IS DISTINCT FROM upper(g.pan)) AS typed_pan_differs,
       -- the minor's risk is not the guardian's (the 0234 rule did not hold)
       count(*) FILTER (WHERE g.id IS NOT NULL AND m.risk_profile IS DISTINCT FROM g.risk_profile) AS risk_not_guardians
  FROM investors m
  JOIN tenants t ON t.id = m.tenant_id
  LEFT JOIN investors g ON g.id = m.guardian_investor_id AND g.tenant_id = m.tenant_id
 WHERE m.guardian_investor_id IS NOT NULL
   AND m.deleted_at IS NULL AND m.merged_into_id IS NULL
 GROUP BY m.tenant_id, t.restrict_user_data_scope
 ORDER BY m.tenant_id;

-- Before 2026-10-13 (migration 0234) only the RTA importer wrote this column.
-- Of the counts above, the ones that matter for access are guardian_other_rm /
-- guardian_other_branch at a firm with data_wall_on: there, a user who cannot
-- open the guardian's record sees the guardian's name on the minor's edit page
-- and the guardian's risk profile on the minor. guardian_merged, guardian_is_minor,
-- guardian_pan_shared and typed_pan_differs are integrity findings: the minor
-- carries a risk profile from a record that may not be its guardian.
-- Nothing is unlinked or changed from this query; each non-zero count goes to
-- the firm's owner and compliance for a decision (E-4).
