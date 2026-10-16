-- 0238 — The firm's public service request form.
--
-- One link per firm, /service-request/<token>, that the firm sends a client (or
-- puts on its website). The client picks the services they want, gives their
-- details and gets a service ID per request (SR-YYYY-NNNNN) — each one opens a
-- service request, source "form", through the same openServiceRequest as the
-- CRM's own form. See src/lib/service-requests/web-form.ts.
--
-- Replaces opening tickets from incoming email, which turned the firm's own
-- reminder mail into hundreds of "Bank update" tickets.
--
-- The token is random rather than the firm's name so the link can be replaced
-- if it is ever spammed. NULL until the firm first opens the page. Additive
-- only: a running deploy that does not know these columns ignores them.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_form_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_form_enabled boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_service_form_token_unique
  ON tenants (service_form_token);

-- Who asked, when no client record matched, so Service Requests can still name
-- them in the Client column. NULL for every ticket opened any other way.
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS requester_name text;
