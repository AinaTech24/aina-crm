-- A client the registrar shows holding units is at least KYC-registered (2026-11-24, Akshar Invest:
-- the KYC "pending" filter listed clients with crores invested). investors.kyc_status was set only from
-- a registrar client master, so clients first seen in a holdings / AUM / transaction file kept the column
-- default 'pending' for ever. See src/lib/kyc/holder-inference.ts: only 'pending' moves, to 'registered',
-- with the reason in kyc_status_remark and kyc_check_source = 'registrar_holdings'; hold / rejected /
-- expired / re-KYC / validated / verified are left alone. New imports apply the same rule themselves.
--
-- Idempotent. investors forces row-level security and this runs across firms, so it sets the platform flag
-- the tenant_isolation policy honours (local to this file's transaction).
SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE investors i
   SET kyc_status = 'registered',
       kyc_status_remark = 'Holds units with the registrar - KYC was accepted when they invested (not yet checked with the KRA).',
       kyc_check_source = 'registrar_holdings',
       updated_at = now()
 WHERE i.deleted_at IS NULL AND i.merged_into_id IS NULL
   AND (i.kyc_status IS NULL OR i.kyc_status = 'pending')
   AND (
     COALESCE(i.aum, 0) > 0
     OR EXISTS (SELECT 1 FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id AND COALESCE(f.aum, 0) > 0)
     OR EXISTS (SELECT 1 FROM transactions t WHERE t.tenant_id = i.tenant_id AND t.investor_id = i.id
                  AND t.status = 'processed' AND t.type IN ('purchase', 'sip'))
   );
