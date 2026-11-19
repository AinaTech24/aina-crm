-- Payroll phase 2 (docs/PAYROLL_MODULE_DESIGN.md §3.6–3.8, §5): loans and
-- advances, reimbursement claims, tax declarations and proofs, sales incentive
-- plans and their statements. Arrears, the variance sheet and the PF ECR /
-- ESIC files need no tables of their own (they read pay_run_items).

CREATE TABLE IF NOT EXISTS payroll_loans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL DEFAULT 'loan',          -- loan | advance
  principal     numeric(12,2) NOT NULL,
  emi           numeric(12,2) NOT NULL,
  start_period  date NOT NULL,                          -- first month recovered
  interest_rate numeric(5,2) NOT NULL DEFAULT 0,        -- % a year; recorded, not charged
  note          text,
  status        text NOT NULL DEFAULT 'active',         -- active | closed | cancelled
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_loans_user_idx ON payroll_loans (tenant_id, user_id, status);

CREATE TABLE IF NOT EXISTS reimbursement_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  category       text NOT NULL,
  claim_date     date NOT NULL,                         -- date on the bill
  amount         numeric(12,2) NOT NULL,
  description    text,
  bill_number    text,
  dedup_key      text NOT NULL,                         -- one bill is never paid twice
  status         text NOT NULL DEFAULT 'submitted',     -- submitted | approved | rejected | paid | withdrawn
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  pay_run_id     uuid REFERENCES pay_runs(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reimbursement_claims_user_idx ON reimbursement_claims (tenant_id, user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS reimbursement_claims_dedup_uq ON reimbursement_claims (tenant_id, dedup_key)
  WHERE status NOT IN ('rejected', 'withdrawn');

CREATE TABLE IF NOT EXISTS tax_declarations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  fy_start      date NOT NULL,                          -- 1 April of the financial year
  regime        text NOT NULL DEFAULT 'new',            -- new | old
  declared      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- annual amounts by item
  proofs        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- per item: status, verified amount, note
  submitted_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_declarations_user_fy_uq ON tax_declarations (tenant_id, user_id, fy_start);

CREATE TABLE IF NOT EXISTS incentive_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,
  measure      text NOT NULL,                           -- net_business | gross_business | net_sip | insurance_premium | new_clients
  period_kind  text NOT NULL DEFAULT 'quarter',         -- month | quarter
  slab_on      text NOT NULL DEFAULT 'achievement',     -- achievement (% of target) | value
  payout       text NOT NULL DEFAULT 'percent',         -- percent (of the measure) | fixed
  slabs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cap          numeric(12,2),
  roles        text[] NOT NULL DEFAULT '{}',
  user_ids     uuid[] NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incentive_statements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  plan_id          uuid NOT NULL REFERENCES incentive_plans(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  measure_value    numeric(16,2),
  target_value     numeric(16,2),
  achievement_pct  numeric(9,2),
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  working          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'calculated',  -- calculated | approved | rejected | paid
  approved_by      uuid,
  approved_at      timestamptz,
  pay_run_id       uuid REFERENCES pay_runs(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS incentive_statements_uq ON incentive_statements (tenant_id, plan_id, user_id, period_start);
CREATE INDEX IF NOT EXISTS incentive_statements_user_idx ON incentive_statements (tenant_id, user_id, status);

ALTER TABLE payroll_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll_loans;
CREATE POLICY tenant_isolation ON payroll_loans
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE reimbursement_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reimbursement_claims;
CREATE POLICY tenant_isolation ON reimbursement_claims
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_declarations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tax_declarations;
CREATE POLICY tenant_isolation ON tax_declarations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE incentive_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incentive_plans;
CREATE POLICY tenant_isolation ON incentive_plans
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE incentive_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incentive_statements;
CREATE POLICY tenant_isolation ON incentive_statements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
