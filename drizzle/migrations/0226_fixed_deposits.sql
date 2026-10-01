-- 0226 — Fixed deposits a client has placed through the firm.
--
-- One row per deposit receipt. An FD is a product line of its own (the
-- Cross-sell card's "FD / Bonds / NCD"): an active one marks that line held
-- with the firm, and its maturity spawns an expected inflow (source
-- fd_maturity) whose reminder task reaches the RM ahead of the date.
-- See src/lib/fixed-deposits/.

CREATE TABLE IF NOT EXISTS fixed_deposits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  investor_id        uuid NOT NULL REFERENCES investors(id),
  rm_id              uuid REFERENCES users(id),
  issuer             text NOT NULL,
  issuer_type        text NOT NULL DEFAULT 'bank',
  scheme_name        text,
  fd_number          text,
  deposit_date       date NOT NULL,
  maturity_date      date NOT NULL,
  tenure_months      integer,
  tenure_days        integer,
  principal          numeric(18, 2) NOT NULL,
  interest_rate      numeric(6, 3) NOT NULL,
  payout             text NOT NULL DEFAULT 'cumulative',
  compounding        text NOT NULL DEFAULT 'quarterly',
  maturity_amount    numeric(18, 2),
  maturity_amount_entered boolean NOT NULL DEFAULT false,
  holding            text NOT NULL DEFAULT 'single',
  joint_holders      text,
  nominee_name       text,
  senior_citizen     boolean NOT NULL DEFAULT false,
  tax_form           text NOT NULL DEFAULT 'none',
  auto_renew         boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active',
  closed_on          date,
  renewed_from_id    uuid REFERENCES fixed_deposits(id),
  commission_rate    numeric(6, 3),
  commission_amount  numeric(18, 2),
  remarks            text,
  inflow_id          uuid REFERENCES expected_inflows(id),
  created_by         uuid REFERENCES users(id),
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_deposits_issuer_type_chk CHECK (issuer_type IN ('bank', 'small_finance_bank', 'corporate', 'nbfc', 'post_office', 'other')),
  CONSTRAINT fixed_deposits_payout_chk CHECK (payout IN ('cumulative', 'monthly', 'quarterly', 'half_yearly', 'yearly')),
  CONSTRAINT fixed_deposits_compounding_chk CHECK (compounding IN ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  CONSTRAINT fixed_deposits_holding_chk CHECK (holding IN ('single', 'joint', 'either_or_survivor')),
  CONSTRAINT fixed_deposits_tax_form_chk CHECK (tax_form IN ('none', '15g', '15h')),
  CONSTRAINT fixed_deposits_status_chk CHECK (status IN ('applied', 'active', 'matured', 'renewed', 'closed_early', 'cancelled')),
  CONSTRAINT fixed_deposits_dates_chk CHECK (maturity_date > deposit_date),
  CONSTRAINT fixed_deposits_principal_chk CHECK (principal > 0)
);

CREATE INDEX IF NOT EXISTS fixed_deposits_investor_idx ON fixed_deposits (tenant_id, investor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fixed_deposits_maturity_idx ON fixed_deposits (tenant_id, status, maturity_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fixed_deposits_rm_idx ON fixed_deposits (tenant_id, rm_id) WHERE deleted_at IS NULL;

ALTER TABLE fixed_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_deposits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fixed_deposits;
CREATE POLICY tenant_isolation ON fixed_deposits
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
