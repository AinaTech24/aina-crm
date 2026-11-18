-- Post-payment firm onboarding and versioned legal documents (the owner's
-- additions C and D to the AUM pricing build, 2026-11-18).
--
--   · tenants.onboarding_required / onboarded_at — a firm that bought online
--     is sent to the setup wizard until it finishes (firms created any other
--     way keep onboarding_required = false and are never sent there).
--   · legal_documents   — platform-level, VERSIONED Terms and NDA. A published
--     version is frozen (trigger); a new version is a new row. Everyone may
--     read a published version; only platform admins write.
--   · legal_acceptances — one IMMUTABLE row per firm per document version:
--     who, designation, email, when, IP, user agent, the SHA-256 of the exact
--     text and whether an emailed one-time code confirmed it. The text hash
--     must equal the published version's (trigger), so a firm can only accept
--     the words that were published.
--   · Seeds v1 of both documents. The NDA is a starting draft — the super-admin
--     screen marks it "Draft — have it reviewed by your lawyer before go-live".
-- Additive and idempotent.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gst_registered boolean;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS welcome_email_status text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS welcome_email_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS welcome_email_last_error text;

-- ── Legal documents (platform-level) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('terms', 'nda')),
  version       integer NOT NULL CHECK (version >= 1),
  title         text NOT NULL,
  body          text NOT NULL,
  body_sha256   text,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  review_note   text,
  published_at  timestamptz,
  published_by  uuid,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_kind_version_uq ON legal_documents (kind, version);

ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_read ON legal_documents;
CREATE POLICY legal_read ON legal_documents FOR SELECT USING (status = 'published');
DROP POLICY IF EXISTS legal_admin ON legal_documents;
CREATE POLICY legal_admin ON legal_documents FOR ALL
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- A published version never changes and is never deleted. Publishing stamps
-- the SHA-256 of the exact text (the database computes it, not the caller).
CREATE OR REPLACE FUNCTION legal_documents_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'legal_documents: a published version cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'legal_documents: a published version cannot be changed — create a new version';
  END IF;
  IF NEW.status = 'published' THEN
    NEW.body_sha256 := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
    NEW.published_at := COALESCE(NEW.published_at, now());
  ELSE
    NEW.body_sha256 := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS legal_documents_guard ON legal_documents;
CREATE TRIGGER legal_documents_guard
  BEFORE INSERT OR UPDATE OR DELETE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_documents_guard();

-- ── Acceptances (per firm) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  user_id                 uuid NOT NULL,
  document_id             uuid NOT NULL REFERENCES legal_documents(id),
  kind                    text NOT NULL CHECK (kind IN ('terms', 'nda')),
  version                 integer NOT NULL,
  text_sha256             text NOT NULL,
  signer_name             text NOT NULL,
  designation             text,
  email                   text NOT NULL,
  accepted_at             timestamptz NOT NULL DEFAULT now(),
  ip_address              text,
  user_agent              text,
  otp_verified            boolean NOT NULL DEFAULT false,
  signed_pdf_key          text,
  compliance_document_id  uuid,
  CONSTRAINT legal_acceptances_nda_signed CHECK (kind <> 'nda' OR (otp_verified AND designation IS NOT NULL AND length(trim(designation)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptances_tenant_doc_uq ON legal_acceptances (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS legal_acceptances_tenant_kind_idx ON legal_acceptances (tenant_id, kind, version DESC);

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON legal_acceptances;
CREATE POLICY tenant_isolation ON legal_acceptances FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- Immutable: never updated; deleted only by the permanent purge of the whole
-- firm (platform_purge_tenant names it in app.purging_tenant). An acceptance
-- must quote the exact published text it accepts.
CREATE OR REPLACE FUNCTION legal_acceptances_guard() RETURNS trigger AS $$
DECLARE
  doc record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'legal_acceptances: an acceptance record is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('app.purging_tenant', true), '') <> OLD.tenant_id::text THEN
      RAISE EXCEPTION 'legal_acceptances: an acceptance record cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  SELECT kind, version, status, body_sha256 INTO doc FROM legal_documents WHERE id = NEW.document_id;
  IF NOT FOUND OR doc.status <> 'published' THEN
    RAISE EXCEPTION 'legal_acceptances: only a published document can be accepted';
  END IF;
  IF doc.kind <> NEW.kind OR doc.version <> NEW.version OR doc.body_sha256 <> NEW.text_sha256 THEN
    RAISE EXCEPTION 'legal_acceptances: the accepted text does not match the published version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS legal_acceptances_guard ON legal_acceptances;
CREATE TRIGGER legal_acceptances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION legal_acceptances_guard();

-- ── The firm purge may remove a purged firm's invoices and acceptances ────
-- Same body as migration 0200, plus naming the firm being purged so the two
-- immutability triggers above (and 0265's on billing_invoices) let ITS rows go.
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
    AND c.column_name = 'tenant_id';

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

  UPDATE pricing_quotes SET converted_tenant_id = NULL WHERE converted_tenant_id = p_tenant;
  DELETE FROM tenants WHERE id = p_tenant;
  PERFORM set_config('app.purging_tenant', '', true);
END;
$$ LANGUAGE plpgsql;

-- ── Seeds: v1 Terms (the /terms page as published) and v1 NDA (a draft) ───
-- Under RLS the migration role is the table owner and FORCE applies, so the
-- seed runs with the platform flag for this transaction only.
SELECT set_config('app.is_platform_admin', 'true', true);

INSERT INTO legal_documents (kind, version, title, status, review_note, body)
SELECT 'terms', 1, 'Terms of Service', 'published', NULL, $terms$
These Terms of Service ("Terms") govern your access to and use of the Aina platform operated by AINA TECH SERVICES LLP ("Aina", "we", "us"). By creating an account or using the platform you agree to these Terms.

## 1. Who can use the platform
Aina is a business tool intended solely for mutual fund distributors (MFDs) and their staff who hold a valid AMFI Registration Number (ARN), and for persons they authorise. You confirm that you are at least 18 years old, are authorised to bind the firm you register, and will keep your ARN and regulatory registrations current while using the platform.

## 2. What the platform is — and is not
Aina is software that helps you manage clients, run compliant communications, and automate routine workflows. Aina is not an investment adviser, broker, stock exchange, depository, or registered intermediary, and nothing in the platform constitutes investment, legal, tax, or financial advice. You remain solely responsible for the suitability, accuracy, and regulatory compliance of every recommendation, message, and transaction you make using the platform.

## 3. Accounts and security
- You are responsible for all activity under your account and for keeping your credentials confidential.
- You must promptly notify us of any unauthorised use of your account.
- You are responsible for the acts and omissions of every user you invite into your firm's workspace.
- We may suspend access where we reasonably believe an account is compromised or is being used unlawfully.

## 4. Subscriptions, trials, and billing
Paid plans are billed in advance on a recurring basis (monthly, half-yearly or yearly) through our payment processor. Free trials, where offered, convert to a paid subscription unless cancelled before the trial ends. Prices are exclusive of applicable taxes (including GST), which will be added at the prevailing rate. Cancellation, renewal, and refunds are governed by our Refund & Cancellation Policy.

## 5. Your data and your clients' data
You retain ownership of the data you and your clients put into the platform ("Customer Data"). As between you and us, you are the data fiduciary/controller for your clients' personal data and we act as your data processor, handling Customer Data only to provide the service and on your instructions. You represent that you have the necessary consents and lawful basis to upload and process Customer Data (including under SEBI/AMFI norms and the Digital Personal Data Protection Act, 2023). Our handling of personal data is described in our Privacy Policy.

## 6. Acceptable use
You agree not to:
- send messages without the consent required by law, TRAI/DLT norms, or platform compliance checks, or use the platform to send spam;
- upload unlawful, infringing, or harmful content, or data you have no right to process;
- attempt to access another firm's data, probe or bypass security controls, or disrupt the service;
- reverse engineer, resell, or white-label the platform except as expressly permitted in writing; or
- use the platform to provide investment advice unless you are separately authorised to do so.

## 7. Third-party services
The platform integrates third-party services (for example WhatsApp messaging, email and SMS delivery, payments, cloud hosting, and AI assistance). Your use of those features may be subject to the relevant provider's terms, and we are not responsible for the acts or omissions of third-party providers.

## 8. Intellectual property
The platform, its software, and its content (excluding Customer Data) are owned by AINA TECH SERVICES LLP and its licensors. We grant you a limited, non-exclusive, non-transferable right to use the platform during your subscription. All rights not expressly granted are reserved.

## 9. Disclaimers
The platform is provided "as is" and "as available". To the maximum extent permitted by law, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the platform will be uninterrupted, error-free, or that automated compliance checks will catch every regulatory issue — you remain responsible for your own compliance.

## 10. Limitation of liability
To the maximum extent permitted by law, neither party is liable for indirect, incidental, special, or consequential damages, or loss of profits, goodwill, or data. Our total aggregate liability arising out of or relating to the platform will not exceed the fees you paid to us in the twelve (12) months preceding the event giving rise to the claim.

## 11. Indemnity
You will indemnify and hold us harmless from claims arising out of your Customer Data, your use of the platform in breach of these Terms or applicable law, or your communications with clients.

## 12. Suspension and termination
You may cancel at any time as described in the Refund & Cancellation Policy. We may suspend or terminate access for material breach of these Terms, non-payment, or where required by law. On termination you may export your Customer Data for a reasonable period, after which we may delete it in line with our retention practices.

## 13. Changes to these Terms
We may update these Terms from time to time. Material changes will be notified through the platform or by email, and a new version must be accepted before the platform can be used again.

## 14. Governing law and disputes
These Terms are governed by the laws of India. The courts at Mumbai, Maharashtra, India have exclusive jurisdiction, subject to any applicable arbitration agreement between the parties.

## 15. Contact
Questions about these Terms? Contact us at support@ainatech.in.
$terms$
WHERE NOT EXISTS (SELECT 1 FROM legal_documents WHERE kind = 'terms');

INSERT INTO legal_documents (kind, version, title, status, review_note, body)
SELECT 'nda', 1, 'Mutual Non-Disclosure Agreement', 'published',
       'Draft — have it reviewed by your lawyer before go-live', $nda$
This Mutual Non-Disclosure Agreement ("Agreement") is made between AINA TECH SERVICES LLP, a limited liability partnership with its office at FF F-4, City Plaza, Sardar Bank Road, Anand, Gujarat 388001 ("Aina"), and the mutual fund distribution firm whose authorised signatory accepts this Agreement below (the "Firm"). Aina and the Firm are each a "Party" and together the "Parties". It takes effect on the date it is accepted.

## 1. Purpose
The Firm uses Aina's software-as-a-service platform to run its mutual fund distribution business, and the Parties will share information with each other to provide, receive, support and improve that service (the "Purpose").

## 2. Confidential Information
"Confidential Information" means any non-public information disclosed by one Party (the "Discloser") to the other (the "Recipient"), in any form, that is marked confidential or that a reasonable person would understand to be confidential. It includes, for the Firm: its client lists, client personal and financial data, portfolios, transaction and business records, ARN-related information, pricing and business plans; and for Aina: the platform's software, design, documentation, security measures, roadmaps, pricing and commercial terms.

## 3. Client data
Personal data of the Firm's clients that the Firm places on the platform ("Client Data") is the Firm's Confidential Information. Aina processes Client Data only to provide the service, on the Firm's instructions and as described in Aina's Terms of Service and Privacy Policy, and in line with the Digital Personal Data Protection Act, 2023 and applicable SEBI and AMFI norms. Aina will not sell Client Data, will not use it to contact the Firm's clients for its own purposes, and will apply reasonable technical and organisational security measures to protect it.

## 4. Exclusions
Information is not Confidential Information if the Recipient can show that it: (a) is or becomes public other than through the Recipient's breach; (b) was lawfully known to the Recipient before disclosure without a duty of confidence; (c) is lawfully received from a third party without a duty of confidence; or (d) is independently developed without use of the Discloser's Confidential Information.

## 5. Obligations and permitted use
The Recipient will: (a) use Confidential Information only for the Purpose; (b) not disclose it to anyone except its partners, employees, contractors, professional advisers and sub-processors who need to know it for the Purpose and are bound by confidentiality obligations at least as protective as these; (c) protect it with at least the care it uses for its own confidential information, and no less than reasonable care; and (d) promptly tell the Discloser of any unauthorised use or disclosure it becomes aware of and help limit its effect.

## 6. Disclosure required by law
The Recipient may disclose Confidential Information where required by law, regulation, a regulator (including SEBI or AMFI) or a court, provided that, where lawful, it gives the Discloser prompt notice and discloses only what is required.

## 7. Duration
This Agreement continues for as long as the Firm uses the platform. The obligations of confidentiality survive for three (3) years after it ends, and for Client Data and trade secrets for as long as the information remains confidential.

## 8. Return and destruction
When the Firm's subscription ends, or on the Discloser's written request, the Recipient will return or destroy the Discloser's Confidential Information, except copies it must keep by law or that sit in routine back-ups, which remain protected by this Agreement until destroyed in the normal course. The Firm may export its data before deletion as described in the Terms of Service.

## 9. No licence and no warranty
No licence or other right in Confidential Information is granted except as needed for the Purpose. Confidential Information is provided "as is".

## 10. Remedies
Unauthorised use or disclosure may cause harm for which damages are not an adequate remedy, so the Discloser may seek injunctive relief in addition to any other remedy available to it.

## 11. General
This Agreement is governed by the laws of India. The courts at Mumbai, Maharashtra, India have exclusive jurisdiction. It sits alongside the Terms of Service; where they conflict on confidentiality, this Agreement prevails. It may be amended only by a new version accepted by both Parties. Acceptance through the platform, confirmed by a one-time code sent to the signatory's verified email, is a valid electronic signature under the Information Technology Act, 2000.
$nda$
WHERE NOT EXISTS (SELECT 1 FROM legal_documents WHERE kind = 'nda');
