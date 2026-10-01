-- Opportunities: an existing client who wants another product.
--
-- A lead is a new person; an existing client asking for insurance, a new SIP,
-- NPS or an FD is not. Before this table that request had nowhere to live: a
-- new lead duplicated the person (and failed at conversion on the PAN), and
-- "Interested" in the cross-sell card was a label nothing acted on.
--
-- One row per (client, product) request. Several can be open at once — an MF
-- client can be in an Insurance and an NPS journey together — but only one
-- OPEN row per product, so the same ask is never tracked twice. Each row runs
-- the "opportunities" blueprint (blueprint_instances, subject_type
-- 'opportunity'), whose stages skip whatever the client already has on file.
--
-- proposals.opportunity_id links a proposal to the opportunity it answers, so
-- sending / accepting it moves that journey (lib/opportunities/journey.ts).
--
-- Additive only.

CREATE TABLE IF NOT EXISTS client_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  investor_id uuid NOT NULL REFERENCES investors(id),
  -- The cross-sell vocabulary (lib/investors/cross-sell.ts) plus 'other'.
  product text NOT NULL,
  pipeline text NOT NULL CHECK (pipeline IN ('mf', 'insurance', 'general')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  expected_value numeric(18, 2),
  -- MF only: a SIP needs an active mandate, a lumpsum does not.
  investment_mode text CHECK (investment_mode IN ('sip', 'lumpsum')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'cross_sell', 'lead_match', 'review', 'automation')),
  owner_id uuid REFERENCES users(id),
  -- e.g. the insurance team member who works an RM's client's insurance ask.
  co_owner_id uuid REFERENCES users(id),
  source_lead_id uuid REFERENCES leads(id),
  -- Insurance: the needs analysis that must exist before a quote (IRDAI).
  needs_analysis jsonb,
  notes text,
  lost_reason text,
  revisit_on date,
  won_at timestamptz,
  lost_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_opps_investor_idx ON client_opportunities (tenant_id, investor_id);
CREATE INDEX IF NOT EXISTS client_opps_status_idx ON client_opportunities (tenant_id, status, pipeline);
CREATE INDEX IF NOT EXISTS client_opps_owner_idx ON client_opportunities (tenant_id, owner_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS client_opps_one_open_per_product
  ON client_opportunities (tenant_id, investor_id, product) WHERE status = 'open';

ALTER TABLE client_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_opportunities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_opportunities;
CREATE POLICY tenant_isolation ON client_opportunities
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES client_opportunities(id);
CREATE INDEX IF NOT EXISTS proposals_opportunity_idx ON proposals (tenant_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
