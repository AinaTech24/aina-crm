-- 0240 — AUM at month end.
--
-- The dashboard's AUM is priced at the latest NAV, so it moves every day. The
-- registrars' AUM statements — and the figure a firm quotes — are at a MONTH
-- END. On 8 Oct 2026 Ahpal read Rs 727.8 Cr against its Rs 726 Cr: the same
-- holdings, a week of market apart (Rs 725.9 Cr at 30 Sep NAV).
--
-- One row per (firm, month): the firm's AUM at the last NAV of that month. The
-- nightly revaluation (daily-ops scanner) rewrites the row for the month its
-- NAVs belong to, so the row freezes on the month's final NAV once the next
-- month's NAVs arrive. nav_date says which NAV it is; source says whether it
-- was recorded that way or backfilled (scripts/backfill-month-end-aum.ts).
-- Raw-SQL only (no Drizzle model), like firm_snapshots. Additive only.

CREATE TABLE IF NOT EXISTS aum_month_end (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  month_end   date NOT NULL,
  aum         numeric(20,2) NOT NULL DEFAULT 0,
  nav_date    date,
  source      text NOT NULL DEFAULT 'recorded',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month_end)
);

ALTER TABLE aum_month_end ENABLE ROW LEVEL SECURITY;
ALTER TABLE aum_month_end FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON aum_month_end;
CREATE POLICY tenant_isolation ON aum_month_end FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
