-- Proposals become a stage of the client journey (design review 2026-10-01).
--
-- Additive only: every column is nullable or defaulted, so the colour still
-- serving during a blue-green deploy keeps working against this schema.
--
-- 1. VERSIONS. Once a proposal has been sent it is no longer edited in place —
--    revising it creates version 2 and keeps version 1 as the record of exactly
--    what the client was sent (and possibly approved). An inspector asks for
--    that record, and an in-place edit destroyed it.
--      version            1, 2, 3 … within one proposal number
--      parent_proposal_id the version this one revises
--      superseded_by_id   set on the older version once a newer one exists
--    status gains 'superseded' (and 'changes_requested', below). proposals.status
--    is plain text with no CHECK constraint, so no DDL is needed for new values.
--
-- 2. CLIENT CHOICES. The client can now accept SOME recommendations, or ask for
--    a change instead of silently declining.
--      accepted_items      json array of indices into products the client took
--      change_request_note what they asked for; change_requested_at when
--
-- 3. VIEWS. Opening the approval link used to record nothing.
--      view_count, last_viewed_at   (viewed_at, the first view, already exists)
--
-- 4. EXECUTION. Accepted proposals are matched to the RTA transactions that
--    follow, so "proposed vs actually invested" is finally a number.
--      executed_at, executed_amount, execution (per-line matches, for audit)
--
-- 5. ONE RECOMMENDATION LIST. The SIP / Lumpsum / SWP / STP worksheet saved to
--    proposal_schemes, which nothing the client sees ever read: the PDF, the
--    send and the approval page all read proposals.products. From now on the
--    builder writes products only. Worksheet rows on proposals that have NOT
--    been sent (draft / ready) are folded into products here, so nothing the RM
--    planned is lost; a row whose scheme is already in products is skipped
--    rather than duplicated. Sent proposals are left exactly as they are — that
--    is what the client saw. proposal_schemes keeps its rows as history.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS parent_proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES proposals(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_items jsonb;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS change_request_note text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS change_requested_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS executed_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS executed_amount numeric(16,2);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS execution jsonb;

CREATE INDEX IF NOT EXISTS proposals_parent_idx ON proposals (tenant_id, parent_proposal_id);

-- Fold unsent worksheet rows into products (see 5 above).
UPDATE proposals p
   SET products = COALESCE(p.products, '[]'::jsonb) || folded.items,
       updated_at = now()
  FROM (
    SELECT s.proposal_id,
           jsonb_agg(
             jsonb_strip_nulls(jsonb_build_object(
               'kind',               'mf',
               'schemeName',         s.scheme_name,
               'amcName',            s.amc,
               'schemeCode',         s.scheme_code,
               'category',           s.scheme_category,
               'recommendationType', COALESCE(s.recommendation_type, 'sip'),
               'planType',           s.plan_type,
               'monthlyAmount',      CASE WHEN COALESCE(s.recommendation_type, 'sip') = 'sip' THEN s.sip_amount END,
               'lumpsum',            CASE WHEN s.recommendation_type = 'lumpsum' THEN s.lumpsum_amount END,
               'stepUpPct',          s.step_up_pct,
               'expectedReturn',     s.expected_return_pct,
               'sipTermYears',       s.expected_holding_years,
               'riskRating',         s.scheme_risk_level,
               'goal',               s.goal_or_objective,
               'corpusRequired',     s.corpus_required,
               'monthlyWithdrawal',  s.monthly_withdrawal,
               'swpPeriodMonths',    s.swp_period_months,
               'toSchemeName',       s.to_scheme_name,
               'toSchemeCode',       s.to_scheme_code,
               'monthlyTransfer',    s.monthly_transfer,
               'numInstallments',    s.num_installments
             ))
             ORDER BY s.created_at
           ) AS items
      FROM proposal_schemes s
      JOIN proposals pp ON pp.id = s.proposal_id
     WHERE pp.status IN ('draft', 'ready')
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(pp.products, '[]'::jsonb)) e
          WHERE lower(trim(e->>'schemeName')) = lower(trim(s.scheme_name))
       )
     GROUP BY s.proposal_id
  ) folded
 WHERE p.id = folded.proposal_id;
