-- 0228 — Booked business, confirmed by the RTA.
--
-- A business entry is what the team BOOKED the day Operations did the work.
-- The registrar's feed (CAMS / KFintech) arrives three or four days later and
-- says what actually happened. src/lib/business/rta-match.ts links the two, so
-- every mutual-fund line of a counted entry carries its RTA outcome:
--
--   pending         booked, no RTA record yet (or the ledger does not reach that
--                   far, so we cannot say)
--   confirmed       the RTA processed it
--   mismatch        the RTA processed it, but for a different amount
--   rejected        the RTA rejected it (payment failed, first SIP debit bounced)
--   not_found       no RTA record within the firm's wait (Settings → Dashboard
--                   thresholds), although the ledger covers the dates
--   not_applicable  a product the RTA never reports (PMS, AIF, SIF, bonds …),
--                   or a line type it has no record for
--
-- rta_status_at is the date the outcome counts on: the RTA's trade date for a
-- confirmation, the rejection date for a rejection. Targets subtract a
-- rejected line ON that date (or drop it from its booking date — a firm
-- setting); incentives read the RTA ledger itself.
--
-- Additive only: existing lines start 'pending' and the matcher settles them.

ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS rta_status text NOT NULL DEFAULT 'pending';
ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS rta_status_at date;
ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS rta_amount numeric(18, 2);
ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS rta_note text;
ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS rta_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_entry_lines_rta_status_chk') THEN
    ALTER TABLE business_entry_lines ADD CONSTRAINT business_entry_lines_rta_status_chk
      CHECK (rta_status IN ('pending', 'confirmed', 'mismatch', 'rejected', 'not_found', 'not_applicable'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS business_entry_lines_rta_idx ON business_entry_lines (tenant_id, rta_status);

-- Which RTA transaction(s) settled a line. A transaction settles at most one
-- line, so the same rupee can never confirm two bookings.
CREATE TABLE IF NOT EXISTS business_entry_rta_matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  line_id        uuid NOT NULL REFERENCES business_entry_lines(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_entry_rta_matches_txn_uniq ON business_entry_rta_matches (transaction_id);
CREATE INDEX IF NOT EXISTS business_entry_rta_matches_line_idx ON business_entry_rta_matches (tenant_id, line_id);

ALTER TABLE business_entry_rta_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_entry_rta_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_entry_rta_matches;
CREATE POLICY tenant_isolation ON business_entry_rta_matches
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
