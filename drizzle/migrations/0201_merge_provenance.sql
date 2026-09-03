-- Merge provenance.
--
-- `investors.merged_into_id` + `merged_at` already record THAT a client was
-- merged away, but not by whom or by what. Without that we cannot answer the two
-- questions an MFD actually asks after a bulk RTA import: "show me every merge"
-- and "which of these did the system do on its own?" — the second being the one
-- they want to audit, because a system merge happened without anyone looking.
--
--   merged_by_id   the user who performed a manual merge (NULL for system)
--   merge_source   'manual' | 'system' | 'import'
--   merge_reason   free text — the matched key ("PAN", "Mobile"), or an operator note
--
-- Backfill: every existing merged row was performed through the manual merge
-- API (the only writer of merged_into_id today), so 'manual' is the truthful
-- default for history. New system-side merges must set 'system'/'import'
-- explicitly rather than inheriting it.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS merged_by_id uuid REFERENCES users(id);
ALTER TABLE investors ADD COLUMN IF NOT EXISTS merge_source text;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS merge_reason text;

UPDATE investors
   SET merge_source = 'manual'
 WHERE merged_into_id IS NOT NULL AND merge_source IS NULL;

-- The merged-clients screens filter on (tenant, merged_into_id IS NOT NULL) and
-- order by merged_at. A partial index keeps that cheap without carrying every
-- non-merged row.
CREATE INDEX IF NOT EXISTS investors_merged_idx
    ON investors (tenant_id, merged_at DESC)
 WHERE merged_into_id IS NOT NULL;
