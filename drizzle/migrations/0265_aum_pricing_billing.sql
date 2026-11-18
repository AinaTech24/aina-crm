-- AUM-based pricing, online purchase and GST tax invoices (the owner's
-- pricing decision of 2026-11-18; lib/billing/aum-pricing.ts).
--
--   · pricing_quotes          — every "Get pricing" request (platform-level:
--                               the person is not a firm yet). Platform-admin
--                               only under RLS; the public endpoint writes it
--                               through withSystem.
--   · subscriptions           — the AUM price in force, the checkout in flight,
--                               and the renewal review's decision for the next
--                               cycle.
--   · billing_invoices        — one immutable GST tax invoice per Razorpay
--                               payment (UNIQUE payment id), numbered gap-free
--                               per financial year from
--   · billing_invoice_counters — one row per FY, incremented in the payment's
--                               transaction (the row lock serialises issuers; a
--                               rolled-back payment gives its number back).
--   · billing_renewal_reviews — the 7-days-before-renewal AUM re-check, one row
--                               per firm per renewal date (idempotency).
-- Additive and idempotent.

-- ── Quotes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_quotes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name         text NOT NULL,
  firm_name            text NOT NULL,
  email                text NOT NULL,
  mobile               text NOT NULL,
  arn                  text,
  aum_crore            numeric(12,2) NOT NULL CHECK (aum_crore >= 0),
  users                integer NOT NULL CHECK (users >= 1),
  quote                jsonb NOT NULL,
  chosen_cycle         text CHECK (chosen_cycle IN ('monthly', 'half_yearly', 'yearly')),
  chosen_at            timestamptz,
  converted_tenant_id  uuid REFERENCES tenants(id) ON DELETE SET NULL,
  converted_at         timestamptz,
  paid_at              timestamptz,
  claim_token_hash     text NOT NULL,
  ip_hash              text,
  user_agent           text,
  source               text NOT NULL DEFAULT 'pricing',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_quotes_created_idx ON pricing_quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS pricing_quotes_email_idx ON pricing_quotes (lower(email));
CREATE INDEX IF NOT EXISTS pricing_quotes_tenant_idx ON pricing_quotes (converted_tenant_id);

ALTER TABLE pricing_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON pricing_quotes;
CREATE POLICY platform_only ON pricing_quotes FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- ── The AUM price on the subscription ─────────────────────────────────────
-- billing_cycle is a text column; 'half_yearly' joins monthly | yearly | custom.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pricing_model text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS declared_aum_crore numeric(12,2);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS aum_crore_in_force numeric(12,2);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS aum_source text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS aum_as_of date;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS aum_tier_key text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monthly_base_paise integer;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cycle_total_paise integer;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cycle_quote jsonb;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quote_id uuid;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_checkout jsonb;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_cycle jsonb;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scheduled_change jsonb;

-- ── Tax invoices ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_invoice_counters (
  financial_year text PRIMARY KEY,
  last_seq       integer NOT NULL DEFAULT 0
);
ALTER TABLE billing_invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON billing_invoice_counters;
CREATE POLICY platform_only ON billing_invoice_counters FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

CREATE TABLE IF NOT EXISTS billing_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  subscription_id       uuid,
  invoice_no            text NOT NULL,
  financial_year        text NOT NULL,
  seq                   integer NOT NULL CHECK (seq >= 1),
  razorpay_payment_id   text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('first', 'renewal', 'late_renewal')),
  issued_at             timestamptz NOT NULL DEFAULT now(),
  period_start          date,
  period_end            date,
  supplier              jsonb NOT NULL,
  recipient             jsonb NOT NULL,
  place_of_supply       text NOT NULL,
  sac                   text NOT NULL,
  lines                 jsonb NOT NULL,
  taxable_paise         integer NOT NULL,
  cgst_paise            integer NOT NULL DEFAULT 0,
  sgst_paise            integer NOT NULL DEFAULT 0,
  igst_paise            integer NOT NULL DEFAULT 0,
  round_off_paise       integer NOT NULL DEFAULT 0,
  total_paise           integer NOT NULL,
  amount_in_words       text NOT NULL,
  status                text NOT NULL DEFAULT 'paid',
  email_status          text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  email_attempts        integer NOT NULL DEFAULT 0,
  email_sent_at         timestamptz,
  email_last_error      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoices_tax_sums CHECK (cgst_paise + sgst_paise + igst_paise + taxable_paise + round_off_paise = total_paise),
  CONSTRAINT billing_invoices_split CHECK ((igst_paise = 0) OR (cgst_paise = 0 AND sgst_paise = 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_no_uq ON billing_invoices (invoice_no);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_fy_seq_uq ON billing_invoices (financial_year, seq);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_payment_uq ON billing_invoices (razorpay_payment_id);
CREATE INDEX IF NOT EXISTS billing_invoices_tenant_idx ON billing_invoices (tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS billing_invoices_email_idx ON billing_invoices (email_status) WHERE email_status <> 'sent';

ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON billing_invoices;
CREATE POLICY tenant_isolation ON billing_invoices FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- An issued invoice never changes (a correction is a credit note). Only the
-- email-delivery bookkeeping may move. Nothing is deleted, except by the
-- permanent purge of the whole firm (platform_purge_tenant, migration 0266,
-- names the firm in app.purging_tenant for its own transaction).
CREATE OR REPLACE FUNCTION billing_invoices_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('app.purging_tenant', true), '') = OLD.tenant_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'billing_invoices: an issued tax invoice cannot be deleted (issue a credit note)';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.subscription_id, NEW.invoice_no, NEW.financial_year, NEW.seq,
      NEW.razorpay_payment_id, NEW.kind, NEW.issued_at, NEW.period_start, NEW.period_end,
      NEW.supplier, NEW.recipient, NEW.place_of_supply, NEW.sac, NEW.lines, NEW.taxable_paise,
      NEW.cgst_paise, NEW.sgst_paise, NEW.igst_paise, NEW.round_off_paise, NEW.total_paise, NEW.amount_in_words,
      NEW.status, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.subscription_id, OLD.invoice_no, OLD.financial_year, OLD.seq,
      OLD.razorpay_payment_id, OLD.kind, OLD.issued_at, OLD.period_start, OLD.period_end,
      OLD.supplier, OLD.recipient, OLD.place_of_supply, OLD.sac, OLD.lines, OLD.taxable_paise,
      OLD.cgst_paise, OLD.sgst_paise, OLD.igst_paise, OLD.round_off_paise, OLD.total_paise, OLD.amount_in_words,
      OLD.status, OLD.created_at) THEN
    RAISE EXCEPTION 'billing_invoices: an issued tax invoice is immutable (issue a credit note)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billing_invoices_immutable ON billing_invoices;
CREATE TRIGGER billing_invoices_immutable
  BEFORE UPDATE OR DELETE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION billing_invoices_immutable();

-- ── Renewal re-pricing from the CRM's AUM ─────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_renewal_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  subscription_id    uuid NOT NULL,
  renewal_on         date NOT NULL,
  aum_crore_used     numeric(12,2) NOT NULL,
  aum_source         text NOT NULL CHECK (aum_source IN ('crm_snapshot', 'crm_live', 'declared')),
  aum_as_of          date,
  from_tier          text,
  to_tier            text NOT NULL,
  changed            boolean NOT NULL,
  cycle              text NOT NULL,
  users              integer NOT NULL,
  next_total_paise   integer NOT NULL,
  razorpay_action    text NOT NULL DEFAULT 'none',
  razorpay_plan_id   text,
  notified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_renewal_reviews_uq ON billing_renewal_reviews (tenant_id, renewal_on);

ALTER TABLE billing_renewal_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_renewal_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON billing_renewal_reviews;
CREATE POLICY tenant_isolation ON billing_renewal_reviews FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
