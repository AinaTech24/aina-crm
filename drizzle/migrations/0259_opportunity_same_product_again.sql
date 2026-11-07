-- Opportunities (2026-11-07, the firm's request): a client who already has an
-- open opportunity for a product may be given another for the same product —
-- a second SIP, a top-up, another policy. 0224 allowed ONE open row per
-- (client, product) with a unique index; that index goes, and a plain one of
-- the same columns stays so the lookups by (client, product) are as fast.
-- Additive for the data: no row is touched.

DROP INDEX IF EXISTS client_opps_one_open_per_product;
CREATE INDEX IF NOT EXISTS client_opps_open_product_idx
  ON client_opportunities (tenant_id, investor_id, product) WHERE status = 'open';
