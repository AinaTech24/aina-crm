-- G-1 (2026-10-14): which existing guardian links, risk copies, proposals and
-- messages need a person to look at them?  READ-ONLY.
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -f docs/security/g1-guardian-impact.sql
--
-- Works on production's schema as it is today (main, 272 migrations). Prints
-- counts per firm, and masked examples (the last 6 characters of a record id)
-- that the privacy / compliance reviewer resolves inside the CRM. Never a
-- PAN, a name, a phone, an email or a figure from a portfolio.
--
-- Nothing here proves a record wrong. A link outside the assigning user's book
-- may be a family the firm serves across two RMs; a shared PAN may be the
-- same person twice. Each non-zero count is a list for a person to check
-- (docs/security/G1_GUARDIAN_HOTFIX.md §5). Nothing is changed.
--
-- Background: from 2026-10-13 (main f563e7ac, migration 0234) the Client
-- Master linked a minor to "the client whose PAN is the guardian PAN" or to any
-- picked id in the firm, without the user's book, without excluding merged
-- records or minors, and copied the linked record's risk profile onto the
-- minor. Before that, only the RTA master import set the link.

-- ── 1. The links, by shape ──────────────────────────────────────────────────
WITH link AS (
  SELECT m.tenant_id, m.id AS minor_id, m.rm_id AS minor_rm, m.branch_id AS minor_branch,
         m.risk_profile AS minor_risk, m.type_details,
         g.id AS g_id, g.rm_id AS g_rm, g.branch_id AS g_branch, g.pan AS g_pan,
         g.investor_category AS g_cat, g.is_minor AS g_minor, g.dob AS g_dob, g.status AS g_status,
         g.deleted_at AS g_deleted, g.merged_into_id AS g_merged, g.risk_profile AS g_risk
    FROM investors m
    LEFT JOIN investors g ON g.id = m.guardian_investor_id AND g.tenant_id = m.tenant_id
   WHERE m.guardian_investor_id IS NOT NULL AND m.deleted_at IS NULL AND m.merged_into_id IS NULL
)
SELECT l.tenant_id,
       t.restrict_user_data_scope                                                       AS data_wall_on,
       count(*)                                                                          AS minors_linked,
       count(*) FILTER (WHERE g_id IS NULL)                                              AS guardian_missing,
       count(*) FILTER (WHERE g_merged IS NOT NULL)                                      AS guardian_merged,
       count(*) FILTER (WHERE g_deleted IS NOT NULL)                                     AS guardian_deleted,
       count(*) FILTER (WHERE g_minor OR g_cat = 'minor')                                AS guardian_is_minor,
       count(*) FILTER (WHERE g_cat NOT IN ('individual', 'nri', 'sole_proprietor'))     AS guardian_not_a_person,
       count(*) FILTER (WHERE upper(g_pan) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' AND substr(upper(g_pan), 4, 1) <> 'P') AS guardian_pan_not_individual,
       count(*) FILTER (WHERE g_dob IS NOT NULL AND g_dob > (current_date - interval '18 years')) AS guardian_under_18,
       count(*) FILTER (WHERE g_pan IS NOT NULL AND (SELECT count(*) FROM investors o
                          WHERE o.tenant_id = l.tenant_id AND upper(btrim(o.pan)) = upper(btrim(l.g_pan))
                            AND o.deleted_at IS NULL AND o.merged_into_id IS NULL) > 1)  AS guardian_pan_shared,
       count(*) FILTER (WHERE nullif(upper(btrim(type_details #>> '{guardian,pan}')), '') IS NOT NULL
                          AND upper(btrim(type_details #>> '{guardian,pan}')) IS DISTINCT FROM upper(btrim(g_pan))) AS typed_pan_differs,
       count(*) FILTER (WHERE g_rm IS DISTINCT FROM minor_rm)                            AS guardian_other_rm,
       count(*) FILTER (WHERE g_branch IS DISTINCT FROM minor_branch)                    AS guardian_other_branch,
       count(*) FILTER (WHERE g_id IS NOT NULL AND minor_risk IS DISTINCT FROM g_risk)   AS risk_not_guardians
  FROM link l JOIN tenants t ON t.id = l.tenant_id
 GROUP BY l.tenant_id, t.restrict_user_data_scope
 ORDER BY l.tenant_id;

-- ── 2. Who made each Client-Master link, and could they open the guardian? ──
--    A link made in the Client Master leaves the full row in the investor.update
--    audit (PATCH) or the investor.created outbox event (POST). The guardian's
--    book is judged as it is TODAY — an approximation (people and clients move).
WITH made AS (
  SELECT a.tenant_id, a.entity_id AS minor_id, a.actor_user_id AS actor, a.at AS made_at,
         (a.after ->> 'guardianInvestorId')::uuid AS gid, 'edit' AS via
    FROM audit_log a
   WHERE a.action = 'investor.update'
     AND a.after ->> 'guardianInvestorId' IS NOT NULL
     AND (a.after ->> 'guardianInvestorId') IS DISTINCT FROM (a.before ->> 'guardianInvestorId')
  UNION ALL
  SELECT e.tenant_id, e.entity_id, (e.meta ->> 'userId')::uuid, e.occurred_at,
         (e.after ->> 'guardianInvestorId')::uuid, 'create'
    FROM events_outbox e
   WHERE e.kind = 'investor.created' AND e.after ->> 'guardianInvestorId' IS NOT NULL
), judged AS (
  SELECT m.*, u.roles, u.branch_id AS actor_branch, g.rm_id AS g_rm, g.branch_id AS g_branch, t.restrict_user_data_scope AS wall
    FROM made m
    LEFT JOIN users u ON u.id = m.actor AND u.tenant_id = m.tenant_id
    LEFT JOIN investors g ON g.id = m.gid AND g.tenant_id = m.tenant_id
    JOIN tenants t ON t.id = m.tenant_id
)
SELECT tenant_id, via,
       count(*)                                                                    AS links_made,
       count(*) FILTER (WHERE wall IS NOT FALSE
                          AND NOT (roles && ARRAY['owner', 'compliance', 'ops', 'back_office']::text[])
                          AND ((roles && ARRAY['branch_head']::text[] AND g_branch IS DISTINCT FROM actor_branch)
                               OR (NOT roles && ARRAY['branch_head']::text[] AND g_rm IS DISTINCT FROM actor))) AS guardian_outside_actor_book_today,
       min(made_at)::date AS first, max(made_at)::date AS last
  FROM judged
 GROUP BY tenant_id, via
 ORDER BY tenant_id, via;

-- ── 3. Suitability and messages that may have rested on a copied profile ────
--    A minor linked to a guardian whose own account was never assessed
--    (no risk_profile_responses row for the minor) carried only the copy.
WITH lm AS (
  SELECT m.tenant_id, m.id AS minor_id
    FROM investors m
   WHERE m.guardian_investor_id IS NOT NULL AND (m.investor_category = 'minor' OR m.is_minor)
     AND m.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM risk_profile_responses r WHERE r.tenant_id = m.tenant_id AND r.investor_id = m.id)
)
SELECT lm.tenant_id,
       count(DISTINCT lm.minor_id)                                                         AS linked_minors_without_own_assessment,
       count(DISTINCT p.id) FILTER (WHERE p.status IN ('sent', 'viewed', 'accepted', 'partially_approved', 'executed'))
                                                                                           AS mf_proposals_sent_to_them,
       count(DISTINCT p.id) FILTER (WHERE p.status IN ('accepted', 'partially_approved', 'executed'))
                                                                                           AS mf_proposals_accepted_or_executed,
       count(DISTINCT c.id)                                                                AS messages_with_risk_or_suitability_tokens
  FROM lm
  LEFT JOIN proposals p ON p.tenant_id = lm.tenant_id AND p.investor_id = lm.minor_id
        AND p.created_at >= timestamptz '2026-10-13 00:00+05:30'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.products, '[]'::jsonb)) it WHERE it ->> 'kind' = 'mf')
  LEFT JOIN communications c ON c.tenant_id = lm.tenant_id AND c.investor_id = lm.minor_id
        AND c.direction = 'outbound' AND c.created_at >= timestamptz '2026-10-13 00:00+05:30'
        AND c.status NOT LIKE 'skipped%'
        AND EXISTS (SELECT 1 FROM template_versions v WHERE v.id = c.template_version_id
                     AND (v.body::text LIKE '%risk.%' OR v.body::text LIKE '%suitability.%'))
 GROUP BY lm.tenant_id
 ORDER BY lm.tenant_id;

-- ── 4. Masked examples for the reviewer (at most 5 per finding per firm) ────
WITH f AS (
  SELECT m.tenant_id, m.id AS minor_id,
         CASE WHEN g.id IS NULL THEN 'guardian_missing'
              WHEN g.merged_into_id IS NOT NULL THEN 'guardian_merged'
              WHEN g.is_minor OR g.investor_category = 'minor' THEN 'guardian_is_minor'
              WHEN g.investor_category NOT IN ('individual', 'nri', 'sole_proprietor') THEN 'guardian_not_a_person'
              WHEN (SELECT count(*) FROM investors o WHERE o.tenant_id = m.tenant_id AND upper(btrim(o.pan)) = upper(btrim(g.pan))
                      AND o.deleted_at IS NULL AND o.merged_into_id IS NULL) > 1 THEN 'guardian_pan_shared'
              WHEN g.rm_id IS DISTINCT FROM m.rm_id THEN 'guardian_other_rm'
         END AS finding
    FROM investors m
    LEFT JOIN investors g ON g.id = m.guardian_investor_id AND g.tenant_id = m.tenant_id
   WHERE m.guardian_investor_id IS NOT NULL AND m.deleted_at IS NULL AND m.merged_into_id IS NULL
), ranked AS (
  SELECT f.*, row_number() OVER (PARTITION BY tenant_id, finding ORDER BY minor_id) AS n FROM f WHERE finding IS NOT NULL
)
SELECT tenant_id, finding, '…' || right(minor_id::text, 6) AS minor_record
  FROM ranked WHERE n <= 5
 ORDER BY tenant_id, finding, minor_record;
