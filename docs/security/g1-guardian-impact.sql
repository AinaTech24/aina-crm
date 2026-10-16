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

-- ── 5. Copies still stored on rows (final hardening, 2026-10-14) ────────────
--    No reader uses a minor's row risk any more (G1_GUARDIAN_HOTFIX.md §8.1),
--    but the copies are still stored. These counts size the reviewed clean-up
--    that would follow the proposed migration (proposed-0245-minor-risk-no-copy.sql);
--    nothing here changes them.
WITH own AS (
  SELECT DISTINCT r.tenant_id, r.investor_id FROM risk_profile_responses r
)
SELECT m.tenant_id,
       count(*) FILTER (WHERE (m.investor_category = 'minor' OR m.is_minor) AND m.guardian_investor_id IS NOT NULL
                          AND m.risk_profile IS NOT NULL AND o.investor_id IS NULL)          AS linked_minor_row_is_copy_only,
       count(*) FILTER (WHERE (m.investor_category = 'minor' OR m.is_minor) AND m.guardian_investor_id IS NULL
                          AND m.risk_profile IS NOT NULL AND o.investor_id IS NULL)          AS unlinked_minor_row_risk_without_own_assessment,
       count(*) FILTER (WHERE NOT (m.investor_category = 'minor' OR m.is_minor)
                          AND m.guardian_investor_id IS NOT NULL)                           AS adult_still_linked_to_a_guardian
  FROM investors m
  LEFT JOIN own o ON o.tenant_id = m.tenant_id AND o.investor_id = m.id
 WHERE m.deleted_at IS NULL AND m.merged_into_id IS NULL
 GROUP BY m.tenant_id
HAVING count(*) FILTER (WHERE (m.investor_category = 'minor' OR m.is_minor) AND m.risk_profile IS NOT NULL AND o.investor_id IS NULL) > 0
    OR count(*) FILTER (WHERE NOT (m.investor_category = 'minor' OR m.is_minor) AND m.guardian_investor_id IS NOT NULL) > 0
 ORDER BY m.tenant_id;

-- ── 6. MF proposals to minors since 0234, for the compliance reviewer ──────
--    One row per proposal (masked ids, dates, flags; never a name or figure).
--    own_assessment_before_send = the minor's OWN account had a signed,
--    confirmed assessment when it was sent; false means the send may have
--    rested on the guardian's copy.
SELECT p.tenant_id,
       '…' || right(p.id::text, 6)                                         AS proposal,
       '…' || right(m.id::text, 6)                                         AS minor_record,
       p.status, p.sent_at::date AS sent_on,
       (m.guardian_investor_id IS NOT NULL)                                AS linked_now,
       (g.id IS NOT NULL AND g.rm_id IS DISTINCT FROM m.rm_id)             AS guardian_other_rm,
       EXISTS (SELECT 1 FROM risk_profile_responses r
                WHERE r.tenant_id = m.tenant_id AND r.investor_id = m.id
                  AND NOT COALESCE(r.provisional, false)
                  AND r.signed_at <= COALESCE(p.sent_at, p.created_at))     AS own_assessment_before_send,
       (p.suitability_override_reason IS NOT NULL)                         AS owner_override
  FROM proposals p
  JOIN investors m ON m.id = p.investor_id AND m.tenant_id = p.tenant_id
                  AND (m.investor_category = 'minor' OR m.is_minor)
  LEFT JOIN investors g ON g.id = m.guardian_investor_id AND g.tenant_id = m.tenant_id
 WHERE p.created_at >= timestamptz '2026-10-13 00:00+05:30'
   AND p.status NOT IN ('draft')
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.products, '[]'::jsonb)) it WHERE it ->> 'kind' = 'mf')
 ORDER BY p.tenant_id, sent_on NULLS LAST, proposal;

-- ── 7. Minors whose guardian is not verified (2026-10-15 onboarding rule) ───
--    pending      = latest guardian event is a refused typed PAN, a minor saved
--                   with no guardian, a removed link, or a link the row no longer
--                   carries: MF proposals (individual or family) are blocked until
--                   the guardian's client record is linked. There is no manual
--                   "confirm" state.
--    not_recorded = an unlinked minor with no guardian event (saved before the
--                   rule): NOT blocked; listed for the firm's policy decision.
--    "minor" here includes a client under 18 by date of birth.
WITH ev AS (
  SELECT DISTINCT ON (a.tenant_id, a.entity_id) a.tenant_id, a.entity_id, a.action
    FROM audit_log a
   WHERE a.entity_type = 'investor'
     AND a.action IN ('investor.guardian_linked', 'investor.guardian_unlinked', 'investor.guardian_not_linked')
   ORDER BY a.tenant_id, a.entity_id, a.at DESC, a.id DESC
)
SELECT m.tenant_id,
       count(*) FILTER (WHERE m.guardian_investor_id IS NOT NULL)                                AS linked,
       count(*) FILTER (WHERE m.guardian_investor_id IS NULL AND ev.action IS NOT NULL)         AS pending,
       count(*) FILTER (WHERE m.guardian_investor_id IS NULL AND ev.action IS NULL)             AS not_recorded
  FROM investors m
  LEFT JOIN ev ON ev.tenant_id = m.tenant_id AND ev.entity_id = m.id
 WHERE (m.investor_category = 'minor' OR m.is_minor OR (m.dob IS NOT NULL AND m.dob > current_date - interval '18 years'))
   AND m.deleted_at IS NULL AND m.merged_into_id IS NULL
 GROUP BY m.tenant_id
 ORDER BY m.tenant_id;

-- ── 8. Size of what the unscoped routes COULD have disclosed ────────────────
--    Before the hotfix, GET /api/audit?entityType=investor&entityId=<id>
--    returned ANY client's change history to any signed-in user of the firm
--    who knew or guessed the id, and the AI QRR commentary route loaded any
--    client by id. Reads were not audited, so the database cannot say who
--    read what. This sizes the surface: per firm, how many client histories
--    there were and how many of them belong to minors linked to a guardian in
--    another RM's book (the G-1 case). The readers are only in web access
--    logs (see G1_GUARDIAN_HOTFIX.md §13.6 for the log query).
SELECT a.tenant_id,
       t.restrict_user_data_scope                                          AS data_wall_on,
       count(DISTINCT a.entity_id)                                         AS clients_with_history,
       count(*)                                                            AS history_rows,
       count(DISTINCT a.entity_id) FILTER (WHERE EXISTS (
         SELECT 1 FROM investors m JOIN investors g ON g.id = m.guardian_investor_id AND g.tenant_id = m.tenant_id
          WHERE m.id = a.entity_id AND m.tenant_id = a.tenant_id AND g.rm_id IS DISTINCT FROM m.rm_id)) AS cross_book_minor_histories
  FROM audit_log a JOIN tenants t ON t.id = a.tenant_id
 WHERE a.entity_type = 'investor'
 GROUP BY a.tenant_id, t.restrict_user_data_scope
 ORDER BY a.tenant_id;

-- Not measurable from the database: who read a client's change history through
-- GET /api/audit, or asked the AI QRR commentary for a client, before those
-- routes were scoped (reads are not audited). Web access logs of those paths
-- are the only source; any read by a user outside the client's book goes to
-- the privacy / compliance reviewer as a suspected disclosure.

-- ── 9. Legacy minors under the owner's interim MF policy (2026-10-15) ──────
--    An MF proposal may cover a minor only with a uniquely identified, eligible,
--    linked guardian AND the minor's own confirmed assessment. This sizes who the
--    release will block, and why. "Minor" includes under 18 by date of birth.
--    gate_state: ok (linked to a valid guardian) · no_guardian (no link) ·
--    guardian_<reason> (the link fails today's rules).
WITH m AS (
  SELECT i.tenant_id, i.id, i.guardian_investor_id AS gid
    FROM investors i
   WHERE (i.investor_category = 'minor' OR i.is_minor OR (i.dob IS NOT NULL AND i.dob > current_date - interval '18 years'))
     AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
), judged AS (
  SELECT m.tenant_id, m.id,
         CASE
           WHEN m.gid IS NULL                                                     THEN 'no_guardian'
           WHEN g.id IS NULL                                                      THEN 'guardian_missing'
           WHEN g.id = m.id                                                       THEN 'guardian_self'
           WHEN g.deleted_at IS NOT NULL                                          THEN 'guardian_deleted'
           WHEN g.merged_into_id IS NOT NULL                                      THEN 'guardian_merged'
           WHEN g.status IN ('closed', 'exited')                                  THEN 'guardian_inactive'
           WHEN COALESCE(g.investor_category, 'individual') NOT IN ('individual', 'nri', 'sole_proprietor') THEN 'guardian_not_a_person'
           WHEN g.is_minor                                                        THEN 'guardian_is_minor'
           WHEN g.dob IS NOT NULL AND g.dob > current_date - interval '18 years'  THEN 'guardian_under_18'
           WHEN upper(btrim(g.pan)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$' AND substr(upper(btrim(g.pan)), 4, 1) <> 'P' THEN 'guardian_pan_not_individual'
           WHEN g.pan IS NOT NULL AND (SELECT count(*) FROM investors o WHERE o.tenant_id = g.tenant_id
                  AND upper(btrim(o.pan)) = upper(btrim(g.pan)) AND o.deleted_at IS NULL AND o.merged_into_id IS NULL) > 1
                                                                                  THEN 'guardian_pan_shared'
           ELSE 'ok'
         END AS gate_state,
         EXISTS (SELECT 1 FROM risk_profile_responses r
                  WHERE r.tenant_id = m.tenant_id AND r.investor_id = m.id AND NOT COALESCE(r.provisional, false)
                    AND r.signed_at IS NOT NULL
                    AND r.id = (SELECT r2.id FROM risk_profile_responses r2 WHERE r2.tenant_id = m.tenant_id AND r2.investor_id = m.id
                                 ORDER BY COALESCE(r2.signed_at, r2.created_at) DESC LIMIT 1)
                    -- the minor's OWN expiry (an upload states one; else signed + 1 year), never the guardian's copied dates
                    AND COALESCE(r.next_review_at, (r.signed_at + interval '1 year')::date) >= CURRENT_DATE) AS own_assessment_current,
         EXISTS (SELECT 1 FROM proposals p
                  WHERE p.tenant_id = m.tenant_id
                    AND (p.investor_id = m.id OR p.family_id = (SELECT family_id FROM investors x WHERE x.id = m.id))
                    AND p.status IN ('draft', 'ready', 'sent', 'viewed', 'changes_requested')
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.products, '[]'::jsonb)) it WHERE it ->> 'kind' = 'mf')) AS open_mf_proposal
    FROM m LEFT JOIN investors g ON g.id = m.gid AND g.tenant_id = m.tenant_id
)
SELECT tenant_id, gate_state,
       count(*)                                         AS minors,
       count(*) FILTER (WHERE own_assessment_current)   AS with_own_current_assessment,
       count(*) FILTER (WHERE open_mf_proposal)         AS with_open_mf_proposal,
       (gate_state = 'ok')                              AS mf_allowed_if_assessed
  FROM judged
 GROUP BY tenant_id, gate_state
 ORDER BY tenant_id, gate_state;
-- Masked examples for §9 (at most 5 per firm and state; the id's last 6 characters):
--   re-run the CTE above and finish with
--   SELECT tenant_id, gate_state, '…' || right(id::text, 6) FROM (SELECT j.*, row_number() OVER
--     (PARTITION BY tenant_id, gate_state ORDER BY id) n FROM judged j WHERE gate_state <> 'ok') x WHERE n <= 5;
