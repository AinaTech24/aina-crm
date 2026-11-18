-- 0267 — Issued GST tax invoices survive a firm's permanent deletion.
--
-- GST law requires a supplier to keep its tax invoices for years after they are
-- issued, whatever happens to the customer. 0265 let platform_purge_tenant()
-- delete a purged firm's invoices along with the rest of its data. From here:
--   · an issued invoice can NEVER be deleted (corrections are credit notes);
--   · purging a firm DETACHES its invoices (tenant_id → NULL) instead. Each
--     invoice keeps its own recipient snapshot (legal name, address, GSTIN,
--     state), so it stays a complete legal record; with no tenant it is visible
--     only to platform admins (tenant_isolation already allows them).
--   · billing_invoices.tenant_id becomes nullable, FK ON DELETE SET NULL.

ALTER TABLE billing_invoices ALTER COLUMN tenant_id DROP NOT NULL;

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'billing_invoices'::regclass
       AND con.contype = 'f'
       AND con.confrelid = 'tenants'::regclass
  LOOP
    EXECUTE format('ALTER TABLE billing_invoices DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE billing_invoices
  ADD CONSTRAINT billing_invoices_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

-- The guard: never deleted; the only change ever allowed is the purge of the
-- firm it belongs to detaching it (tenant_id → NULL), plus the email delivery
-- bookkeeping columns, which are outside the compared tuple.
CREATE OR REPLACE FUNCTION billing_invoices_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing_invoices: an issued tax invoice cannot be deleted (issue a credit note)';
  END IF;
  IF NEW.tenant_id IS NULL AND OLD.tenant_id IS NOT NULL
     AND COALESCE(current_setting('app.purging_tenant', true), '') <> OLD.tenant_id::text THEN
    RAISE EXCEPTION 'billing_invoices: an invoice is detached from its firm only when that firm is purged';
  END IF;
  IF (NEW.id, NEW.subscription_id, NEW.invoice_no, NEW.financial_year, NEW.seq,
      NEW.razorpay_payment_id, NEW.kind, NEW.issued_at, NEW.period_start, NEW.period_end,
      NEW.supplier, NEW.recipient, NEW.place_of_supply, NEW.sac, NEW.lines, NEW.taxable_paise,
      NEW.cgst_paise, NEW.sgst_paise, NEW.igst_paise, NEW.round_off_paise, NEW.total_paise, NEW.amount_in_words,
      NEW.status, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.subscription_id, OLD.invoice_no, OLD.financial_year, OLD.seq,
      OLD.razorpay_payment_id, OLD.kind, OLD.issued_at, OLD.period_start, OLD.period_end,
      OLD.supplier, OLD.recipient, OLD.place_of_supply, OLD.sac, OLD.lines, OLD.taxable_paise,
      OLD.cgst_paise, OLD.sgst_paise, OLD.igst_paise, OLD.round_off_paise, OLD.total_paise, OLD.amount_in_words,
      OLD.status, OLD.created_at)
     OR (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NEW.tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'billing_invoices: an issued tax invoice is immutable (issue a credit note)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The purge sweeps every tenant_id table EXCEPT billing_invoices, then detaches
-- the firm's invoices just before the tenant row goes. Otherwise unchanged
-- from 0266.
CREATE OR REPLACE FUNCTION platform_purge_tenant(p_tenant uuid) RETURNS void AS $$
DECLARE
  tbls text[];
  t text;
  blocked_now text[];
  blocked_prev text[] := ARRAY[]::text[];
  deleted_any boolean;
  n bigint;
  pass int := 0;
BEGIN
  PERFORM set_config('app.purging_tenant', p_tenant::text, true);

  SELECT array_agg(c.table_name) INTO tbls
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema
   AND tb.table_name = c.table_name
   AND tb.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id'
    AND c.table_name <> 'billing_invoices';

  IF tbls IS NOT NULL THEN
    LOOP
      pass := pass + 1;
      blocked_now := ARRAY[]::text[];
      deleted_any := false;

      FOREACH t IN ARRAY tbls LOOP
        BEGIN
          EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', t) USING p_tenant;
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN deleted_any := true; END IF;
        EXCEPTION WHEN foreign_key_violation THEN
          blocked_now := blocked_now || t;
        END;
      END LOOP;

      EXIT WHEN array_length(blocked_now, 1) IS NULL;

      IF NOT deleted_any AND blocked_now = blocked_prev THEN
        RAISE EXCEPTION
          'platform_purge_tenant: cannot delete tenant % — still blocked by foreign keys on: %',
          p_tenant, array_to_string(blocked_now, ', ');
      END IF;

      blocked_prev := blocked_now;

      IF pass > 60 THEN
        RAISE EXCEPTION
          'platform_purge_tenant: gave up after % passes for tenant % — still blocked by: %',
          pass, p_tenant, array_to_string(blocked_now, ', ');
      END IF;
    END LOOP;
  END IF;

  UPDATE billing_invoices SET tenant_id = NULL WHERE tenant_id = p_tenant;
  UPDATE pricing_quotes SET converted_tenant_id = NULL WHERE converted_tenant_id = p_tenant;
  DELETE FROM tenants WHERE id = p_tenant;
  PERFORM set_config('app.purging_tenant', '', true);
END;
$$ LANGUAGE plpgsql;
