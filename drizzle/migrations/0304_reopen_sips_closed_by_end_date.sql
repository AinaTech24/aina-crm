-- Reopen SIPs that were closed on their END DATE alone (2026-11-27, Akshar / Urmi: the SIP book read below the
-- registrar's own figure).
--
-- Migration 0288 (24 Nov) completed EVERY active SIP in every firm whose end date had passed, and the import did the same
-- for CAMS rows with a past TO_DATE. A SIP's end date is not evidence that it stopped: an AMC keeps collecting under an
-- extended registration. The platform's own rule (completeExpiredSips, lib/finance/sip-lifecycle.ts) closes a SIP only on
-- POSITIVE evidence - past its end date, instalment history held for the folio, and nothing collected for 120 days -
-- because overstating a book slightly beats silently erasing live SIPs.
--
-- So a 'completed' SIP with a past end date is put back to 'active' unless that evidence exists. The nightly pass closes
-- it again by the proper rule the day the evidence is there. Nothing the registrar SAYS ended is touched: a SIP whose remarks
-- carry its words (terminated, cancelled, ceased, expired, matured, rejected ...) stays as it is, and so does a deceased
-- client's. Idempotent. sips forces row-level security and this runs across firms, so it sets the platform flag.
SELECT set_config('app.is_platform_admin', 'true', true);

WITH last_sip AS (
  SELECT t.tenant_id, t.folio_number, max(t.order_date) AS last_on
    FROM transactions t
   WHERE t.type = 'sip' AND t.folio_number IS NOT NULL
   GROUP BY t.tenant_id, t.folio_number
)
UPDATE sips s
   SET status = 'active',
       remarks = CASE WHEN s.remarks ~ '^(CAMS|KFintech|Registrar): SIP term ended' THEN NULL ELSE s.remarks END,
       updated_at = now()
 WHERE s.status = 'completed'
   AND s.end_date IS NOT NULL
   AND s.end_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
   -- not something the registrar said ended
   AND (s.remarks IS NULL
        OR s.remarks ~ '^(CAMS|KFintech|Registrar): SIP term ended'
        OR s.remarks !~* 'terminat|cancel|ceas|stop|closed|inactive|revok|reject|revers|expir|matur|goal|complet|mandate incomplete')
   -- not a deceased client's
   AND NOT EXISTS (SELECT 1 FROM investors d WHERE d.id = s.investor_id AND d.date_of_demise IS NOT NULL)
   -- no positive evidence that it stopped: instalment history held AND nothing collected for 120 days
   AND NOT EXISTS (
     SELECT 1 FROM last_sip l
      WHERE l.tenant_id = s.tenant_id AND l.folio_number = s.folio_number
        AND l.last_on < (now() AT TIME ZONE 'Asia/Kolkata')::date - 120
   );

-- The per-client cache of the active SIP amount follows.
UPDATE investors i SET active_sip_amount = v.amt
  FROM (
    SELECT i2.id, ROUND(COALESCE(SUM(
             CASE s.frequency
               WHEN 'weekly' THEN s.amount * 52.0 / 12 WHEN 'fortnightly' THEN s.amount * 26.0 / 12
               WHEN 'quarterly' THEN s.amount / 3 WHEN 'half_yearly' THEN s.amount / 6
               WHEN 'semi_annual' THEN s.amount / 6 WHEN 'yearly' THEN s.amount / 12 WHEN 'annual' THEN s.amount / 12
               ELSE s.amount END), 0), 2) AS amt
      FROM investors i2 LEFT JOIN sips s ON s.investor_id = i2.id AND s.status = 'active'
     GROUP BY i2.id
  ) v
 WHERE i.id = v.id AND i.active_sip_amount IS DISTINCT FROM v.amt;
