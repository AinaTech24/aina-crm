-- Make a merge fully reversible for the SURVIVING record too.
--
-- A merge has always filled the survivor's blank contact fields from the
-- duplicate, and it can now also take a field the operator explicitly picks
-- (their mobile is on the duplicate, say). Un-merge restored the loser's
-- status/AUM/SIP but never touched the survivor, so any value the merge wrote
-- over was gone for good — an un-merge that leaves the surviving client
-- carrying the other person's email is not actually an un-merge.
--
-- Snapshot the survivor's mergeable fields as they were BEFORE the merge, so
-- un-merge can put them back. Null for merges recorded before this column
-- existed; the un-merge treats that as "nothing to restore" and behaves exactly
-- as it does today.
ALTER TABLE investor_merges
  ADD COLUMN IF NOT EXISTS survivor_before jsonb;

COMMENT ON COLUMN investor_merges.survivor_before IS
  'Survivor''s name/phone/email/whatsapp_phone/dob immediately before the merge, for un-merge to restore.';
