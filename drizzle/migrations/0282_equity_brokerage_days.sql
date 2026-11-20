-- Equity desk (We Care, 2026-11-20): brokerage is entered per TRADING DAY, as the
-- equity team did in Zoho's "Equity" module (Date · Brokerage · Turnover · Active
-- clients). The month's equity_brokerage figure — what the Equity Team MIS and
-- the Brokerage MoM report read — is the sum of its days, kept by the app on
-- every write. zoho_id makes a Zoho re-sync idempotent.
CREATE TABLE IF NOT EXISTS equity_brokerage_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  trade_date date NOT NULL,
  brokerage numeric(18, 2) NOT NULL DEFAULT 0,
  turnover numeric(20, 2),
  active_clients integer,
  notes text,
  zoho_id text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equity_brokerage_days_date_idx ON equity_brokerage_days (tenant_id, trade_date);
CREATE UNIQUE INDEX IF NOT EXISTS equity_brokerage_days_zoho_uq ON equity_brokerage_days (tenant_id, zoho_id) WHERE zoho_id IS NOT NULL;

ALTER TABLE equity_brokerage_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_brokerage_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equity_brokerage_days;
CREATE POLICY tenant_isolation ON equity_brokerage_days
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
