-- 0227 — The firm's public complaint form.
--
-- One link per firm, /complaint/<token>, for the firm to put on its own
-- website (Service Requests → ⋯ → "Complaint form for your website").
-- A complaint sent through it opens a service request of type complaint,
-- source "website", with the 21-day SLA running — see
-- src/lib/complaints/web-form.ts.
--
-- The token is random rather than the firm's name so the link can be replaced
-- if it is ever spammed. NULL until the firm first opens that page. Additive
-- only: a running deploy that does not know these columns ignores them.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS complaint_form_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS complaint_form_enabled boolean NOT NULL DEFAULT true;

-- Unique where set; Postgres treats NULLs as distinct, so firms without a link
-- do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_complaint_form_token_unique
  ON tenants (complaint_form_token);
