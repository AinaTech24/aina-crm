-- The first "Add starter guides" run created short text-only guides under these slugs. They are
-- superseded by the illustrated guides shipped in 0248 (guide-*), and showed on the help centre as
-- duplicate cards without a picture. Remove them — only while they still have no screenshots, so a
-- guide an admin has illustrated is kept.
DELETE FROM kb_articles
 WHERE series = 'Guide'
   AND screenshots = '[]'::jsonb
   AND lower(slug) IN (
     'using-dashboards', 'managing-tasks', 'meetings-and-action-items', 'service-requests-and-complaints',
     'leads-pipeline', 'adding-a-client', 'merging-duplicate-clients', 'creating-a-family',
     'client-opportunities', 'risk-profiles', 'client-exit-and-demise', 'financial-health-check',
     'fixed-deposits', 'sip-rejections', 'business-entries', 'automations-and-templates',
     'whatsapp-templates', 'importing-rta-files', 'kyc-status-check', 'email-introduction-and-signature',
     'daily-job-tracker'
   );
