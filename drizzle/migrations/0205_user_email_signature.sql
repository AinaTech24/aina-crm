-- Per-user email signature image (a scanned signature or a signature-style
-- graphic). Sits alongside avatar_url: the avatar identifies the person in the
-- CRM's own UI, this one signs off the emails they send to clients.
--
-- Nullable and unused until a user uploads one — the signature block in an
-- email template simply renders the typed name block without it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_url text;
