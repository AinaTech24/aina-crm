-- Existing SIP rows get the same status a fresh import now gives them (2026-11-24, Ahpal: the SIP book read
-- Rs 4.22 Cr against the client's Rs 3.8 Cr). Two groups of SIPs sat 'active' although the registrar had ended them:
--   1. rows whose remarks carry the registrar's own words ("KFintech: Terminated by Investor · ceased ...",
--      recorded since 9 Oct but not acted on) - stopped, or completed for expired / matured;
--   2. rows whose SIP end date (CAMS TO_DATE / KFintech ENDDATE) has passed - completed (term ended).
-- A deceased client's SIPs are already stopped; nothing already stopped / completed is touched. Idempotent.
-- sips forces row-level security and this runs across firms, so it sets the platform flag the policy honours.
SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE sips s
   SET status = CASE
         WHEN s.remarks ~* 'reject|revers|mandate incomplete' THEN 'stopped'
         WHEN s.remarks ~* 'expir|matur|goal|complet' THEN 'completed'
         ELSE 'stopped'
       END,
       updated_at = now()
 WHERE s.status = 'active'
   AND s.remarks ~ '^(CAMS|KFintech|Registrar): '
   AND s.remarks ~* 'terminat|cancel|ceas|stop|closed|inactive|revok|reject|revers|mandate incomplete|expir|matur|goal|complet';

UPDATE sips s
   SET status = 'completed',
       remarks = COALESCE(s.remarks, 'Registrar: SIP term ended ' || to_char(s.end_date, 'DD Mon YYYY')),
       updated_at = now()
 WHERE s.status = 'active'
   AND s.end_date IS NOT NULL
   AND s.end_date < (now() AT TIME ZONE 'Asia/Kolkata')::date;

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
