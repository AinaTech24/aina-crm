-- Which registrar file a transaction came from (lib/rta/process.ts).
--
-- The 29 Oct 2026 RTA audit could not tell a true duplicate from two real
-- transactions, or which file overwrote which, because no transaction recorded
-- its source file and raw_feed_row was never filled. The feed import now writes
-- the import row's id here and the registrar's own type / amount / units text
-- into raw_feed_row. Nullable, no default, no index: instant on a large table,
-- and only ever read when tracing one transaction. Additive only.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rta_import_id uuid;
