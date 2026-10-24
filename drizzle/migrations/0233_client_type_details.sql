-- 0233 — What a client's TYPE adds to the client master.
--
-- A minor's guardian, an HUF's Karta and coparceners, an entity's
-- incorporation, signatories and beneficial owners, an NRI's overseas and tax
-- residency details, a sole proprietorship's business name, and an
-- individual's nomination opt-out. One jsonb document, shaped and cleaned by
-- src/lib/investors/client-types.ts (TypeDetailsSchema, cleanTypeDetails).
--
-- New client types (sole_proprietor, llp, partnership, aop_boi) need nothing
-- here: investor_category is plain text with no CHECK constraint.
-- Additive only.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS type_details jsonb NOT NULL DEFAULT '{}'::jsonb;
