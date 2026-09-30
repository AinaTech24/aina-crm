-- The SIP book, defined once (src/lib/metrics/sip.ts).
--
-- 1. Repair the demo firm's SIP amounts. The demo seed (src/db/seed.ts) wrote
--    every SIP and every rejected SIP instalment at 100× the client's monthly
--    SIP — Sneha Shah's ₹8,000 became ₹8,00,000 — so the SIP Book page showed
--    ₹2,46,00,000 a month while the dashboard, reading the per-client cache,
--    showed ₹8.93 L. The seed is fixed; this puts the rows already written
--    back. The guards are deliberately narrow: only the demo firm
--    (ARN-123456), only rows the seed itself wrote (its made-up scheme codes,
--    no folio, created while the firm was being seeded), only amounts that
--    are an exact multiple of 100 and at least ₹1 lakh. A real firm matches
--    none of them.
--
-- 2. Rebuild investors.active_sip_amount for every firm from the SIP rows,
--    as the MONTHLY-EQUIVALENT sum of active SIPs. It used to be refreshed
--    only by a nightly job, with no frequency conversion — a quarterly
--    ₹30,000 SIP counted as ₹30,000 a month in the Clients list while the SIP
--    Book page counted it as ₹10,000. The factors below are SIP_PER_MONTH in
--    src/lib/metrics/sip.ts.
--
-- 3. The demo firm's recorded SIP-book history (firm / branch / RM snapshots)
--    was taken from the wrong cache. Its SIPs have not changed since the seed,
--    so the true history is today's corrected book; without this the SIP book
--    card compared the fixed figure with the broken one and showed a 72% fall.
--    Demo firm only — a real firm's history is left exactly as recorded.
--
-- Data-only and idempotent: re-running changes nothing.

UPDATE sips s
   SET amount = s.amount / 100
  FROM tenants t
 WHERE t.id = s.tenant_id
   AND t.arn = 'ARN-123456'
   AND s.scheme_code IN ('HDFC-TOP100', 'AXIS-BLUE', 'PARAG-FLEX', 'SBI-CONTRA', 'MIRAE-ELSS')
   AND s.folio_id IS NULL
   AND s.created_at <= t.created_at + interval '1 hour'
   AND s.amount >= 100000
   AND mod(s.amount, 100) = 0;

UPDATE transactions tr
   SET amount = tr.amount / 100
  FROM tenants t
 WHERE t.id = tr.tenant_id
   AND t.arn = 'ARN-123456'
   AND tr.type = 'sip'
   AND tr.status = 'rejected'
   AND tr.scheme_code = 'HDFC-TOP100'
   AND tr.folio_id IS NULL
   AND tr.created_at BETWEEN t.created_at - interval '7 days' AND t.created_at + interval '1 hour'
   AND tr.amount >= 100000
   AND mod(tr.amount, 100) = 0;

UPDATE investors i
   SET active_sip_amount = v.amt
  FROM (
    SELECT i2.id,
           ROUND(COALESCE(SUM(s.amount::numeric * CASE s.frequency
             WHEN 'weekly' THEN 52.0 / 12
             WHEN 'fortnightly' THEN 26.0 / 12
             WHEN 'quarterly' THEN 1.0 / 3
             WHEN 'half_yearly' THEN 1.0 / 6
             WHEN 'yearly' THEN 1.0 / 12
             ELSE 1 END), 0), 2) AS amt
      FROM investors i2
      LEFT JOIN sips s ON s.investor_id = i2.id AND s.status = 'active'
     GROUP BY i2.id
  ) v
 WHERE i.id = v.id
   AND i.active_sip_amount IS DISTINCT FROM v.amt;

UPDATE firm_snapshots f
   SET monthly_sip = v.sip
  FROM (
    SELECT t.id AS tenant_id, COALESCE(SUM(i.active_sip_amount), 0) AS sip
      FROM tenants t JOIN investors i ON i.tenant_id = t.id
     WHERE t.arn = 'ARN-123456' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND i.status NOT IN ('closed', 'exited')
     GROUP BY t.id
  ) v
 WHERE f.tenant_id = v.tenant_id AND f.monthly_sip IS DISTINCT FROM v.sip;

UPDATE rm_snapshots r
   SET monthly_sip = v.sip
  FROM (
    SELECT i.tenant_id, i.rm_id, COALESCE(SUM(i.active_sip_amount), 0) AS sip
      FROM tenants t JOIN investors i ON i.tenant_id = t.id
     WHERE t.arn = 'ARN-123456' AND i.rm_id IS NOT NULL AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND i.status NOT IN ('closed', 'exited')
     GROUP BY i.tenant_id, i.rm_id
  ) v
 WHERE r.tenant_id = v.tenant_id AND r.rm_id = v.rm_id AND r.monthly_sip IS DISTINCT FROM v.sip;

UPDATE branch_snapshots b
   SET monthly_sip = v.sip
  FROM (
    SELECT i.tenant_id, i.branch_id, COALESCE(SUM(i.active_sip_amount), 0) AS sip
      FROM tenants t JOIN investors i ON i.tenant_id = t.id
     WHERE t.arn = 'ARN-123456' AND i.branch_id IS NOT NULL AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND i.status NOT IN ('closed', 'exited')
     GROUP BY i.tenant_id, i.branch_id
  ) v
 WHERE b.tenant_id = v.tenant_id AND b.branch_id = v.branch_id AND b.monthly_sip IS DISTINCT FROM v.sip;
