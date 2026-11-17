-- Payroll, phase 1 (2026-11-16; docs/PAYROLL_MODULE_DESIGN.md, src/lib/payroll/).
-- Employees are the CRM users; this adds a payroll profile, a salary history
-- and monthly pay runs whose results are frozen once approved. Additive only.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payroll_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS payroll_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  user_id             uuid NOT NULL REFERENCES users(id),
  pan_enc             text,
  pan_last4           text,
  uan                 text,
  pf_number           text,
  esi_number          text,
  bank_name           text,
  bank_account_enc    text,
  bank_account_last4  text,
  ifsc                text,
  payment_mode        text NOT NULL DEFAULT 'bank' CHECK (payment_mode IN ('bank', 'cheque', 'cash')),
  work_state          text,
  gender              text,
  tax_regime          text NOT NULL DEFAULT 'new' CHECK (tax_regime IN ('new', 'old')),
  pf_enabled          boolean NOT NULL DEFAULT true,
  esi_mode            text NOT NULL DEFAULT 'auto' CHECK (esi_mode IN ('auto', 'off')),
  exit_date           date,
  -- Salary and TDS paid this financial year before payroll moved to the CRM (for TDS).
  opening_fy_start      date,
  opening_taxable_gross numeric(12,2),
  opening_tds           numeric(12,2),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_profiles_user_uq ON payroll_profiles (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS employee_salaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  effective_from  date NOT NULL,
  monthly_gross   numeric(12,2) NOT NULL CHECK (monthly_gross >= 0),
  basic_override  numeric(12,2),
  hra_override    numeric(12,2),
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_salaries_user_idx ON employee_salaries (tenant_id, user_id, effective_from);

CREATE TABLE IF NOT EXISTS pay_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  period       date NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  totals       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prepared_by  uuid,
  approved_by  uuid,
  approved_at  timestamptz,
  paid_by      uuid,
  paid_at      timestamptz,
  paid_on      date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_runs_period_uq ON pay_runs (tenant_id, period);

CREATE TABLE IF NOT EXISTS pay_run_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  pay_run_id     uuid NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id),
  lop_days       numeric(5,1) NOT NULL DEFAULT 0,
  lop_override   boolean NOT NULL DEFAULT false,
  lop_reason     text,
  adjustments    jsonb NOT NULL DEFAULT '[]'::jsonb,
  on_hold        boolean NOT NULL DEFAULT false,
  result         jsonb NOT NULL DEFAULT '{}'::jsonb,
  gross          numeric(12,2) NOT NULL DEFAULT 0,
  deductions     numeric(12,2) NOT NULL DEFAULT 0,
  net            numeric(12,2) NOT NULL DEFAULT 0,
  tds            numeric(12,2) NOT NULL DEFAULT 0,
  employer_cost  numeric(12,2) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_run_items_run_user_uq ON pay_run_items (pay_run_id, user_id);
CREATE INDEX IF NOT EXISTS pay_run_items_user_idx ON pay_run_items (tenant_id, user_id);

ALTER TABLE payroll_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll_profiles;
CREATE POLICY tenant_isolation ON payroll_profiles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE employee_salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_salaries;
CREATE POLICY tenant_isolation ON employee_salaries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pay_runs;
CREATE POLICY tenant_isolation ON pay_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE pay_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_run_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pay_run_items;
CREATE POLICY tenant_isolation ON pay_run_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
