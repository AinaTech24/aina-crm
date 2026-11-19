-- Aina Admin -> Inbound Mail: open the whole mail and download its attachments.
-- Each mail the RTA poller handles is kept, raw (.eml), in the uploads bucket
-- under rta-inbound-archive/ for RTA_INBOUND_ARCHIVE_DAYS (30) days; this is
-- the pointer. NULL = not kept (mail from before this change, or past the
-- window). rta_inbound_messages already has RLS (migration 0192).
ALTER TABLE rta_inbound_messages ADD COLUMN IF NOT EXISTS raw_key text;
ALTER TABLE rta_inbound_messages ADD COLUMN IF NOT EXISTS raw_size integer;
CREATE INDEX IF NOT EXISTS rta_inbound_msg_raw_idx ON rta_inbound_messages (created_at) WHERE raw_key IS NOT NULL;
