-- KYC status from the KRA, fetched by PAN through the firm's own NSE MF Invest
-- (NMF II) API credentials (lib/kyc/). Additive only.
--
-- investors.kyc_status_remark / kyc_checked_at / kyc_check_source say what the
-- KRA last answered and when, so the client page can show "KYC Validated
-- (CVL KRA) · checked 15 Oct" and the nightly refresh knows whom to ask next.
--
-- kyc_checks is the append-only history: one row per answer (or failure), the
-- status before and after, the KRA's own words. A failed call never changes
-- investors.kyc_status — it is recorded here and nothing else.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS kyc_status_remark text,
  ADD COLUMN IF NOT EXISTS kyc_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_check_source text;

CREATE TABLE IF NOT EXISTS kyc_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  investor_id uuid REFERENCES investors(id) ON DELETE SET NULL,
  pan text NOT NULL,
  source text NOT NULL,              -- 'nse_mf'
  trigger text NOT NULL,             -- 'manual' | 'nightly'
  outcome text NOT NULL,             -- 'ok' | 'service_down' | 'error'
  kra_flag text,                     -- NSE's S / F
  kra_remark text,                   -- e.g. 'KYC Validated', 'ON HOLD'
  kra_name text,                     -- camskra / cvlkra / ndmlkra / dotexkra / karvykra
  kra_status_date text,              -- as the KRA wrote it (DD-MM-YYYY HH:MM:SS)
  status_before text,
  status_after text,
  changed boolean NOT NULL DEFAULT false,
  error text,
  checked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_checks_investor_idx ON kyc_checks (tenant_id, investor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investors_kyc_checked_idx ON investors (tenant_id, kyc_checked_at);

ALTER TABLE kyc_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kyc_checks;
CREATE POLICY tenant_isolation ON kyc_checks
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');

