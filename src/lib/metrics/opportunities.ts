/**
 * Cross-sell — existing clients taking another product (opportunities,
 * migration 0224) and how many product lines the book holds with the firm.
 *
 *   open            opportunities open now, count and expected value
 *   won / lost      closed in the period (won_at / lost_at, India dates)
 *   conversion      won ÷ (won + lost) in the period — null when none closed
 *   productsPerClient  average product lines held WITH THE FIRM per live
 *                   client: mutual funds when AUM is above zero, an insurance
 *                   line per in-force policy, FD per live fixed deposit
 *                   (migration 0226), plus the Cross-sell card's
 *                   "Held with us"; null when the view has no live client
 *   singleProduct   live clients holding exactly one product with us — the
 *                   cross-sell base
 *   byProduct       open opportunities per product
 *
 * Opportunities follow their CLIENT (rm / branch / client filters), like every
 * other client fact on the dashboards.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientWhere, type MetricPeriod, type MetricScope } from "./scope";
import { CROSS_SELL_PRODUCT_KEYS } from "@/lib/investors/cross-sell";

export type OpportunityMetrics = {
  open: number;
  openValue: number;
  won: number;
  wonValue: number;
  lost: number;
  conversion: number | null;
  productsPerClient: number | null;
  /** Live clients counted. */
  clientsWithCard: number;
  singleProduct: number;
  byProduct: Array<{ product: string; open: number; value: number }>;
};

export async function getOpportunityMetrics(tx: Tx, scope: MetricScope, period: MetricPeriod): Promise<OpportunityMetrics> {
  const where = clientWhere(scope, "i");
  const inPeriod = (column: string) =>
    sql`(${sql.raw(column)} AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${period.from}::date AND ${period.to}::date`;

  const r = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE o.status = 'open')::int AS open,
      COALESCE(sum(o.expected_value) FILTER (WHERE o.status = 'open'), 0) AS open_value,
      count(*) FILTER (WHERE o.status = 'won' AND ${inPeriod("o.won_at")})::int AS won,
      COALESCE(sum(o.expected_value) FILTER (WHERE o.status = 'won' AND ${inPeriod("o.won_at")}), 0) AS won_value,
      count(*) FILTER (WHERE o.status = 'lost' AND ${inPeriod("o.lost_at")})::int AS lost
    FROM client_opportunities o
    JOIN investors i ON i.id = o.investor_id
    WHERE o.tenant_id = ${scope.tenantId}::uuid AND ${where}
  `)).rows[0] as Record<string, any>;

  const byProduct = (await tx.execute(sql`
    SELECT o.product, count(*)::int AS open, COALESCE(sum(o.expected_value), 0) AS value
      FROM client_opportunities o JOIN investors i ON i.id = o.investor_id
     WHERE o.tenant_id = ${scope.tenantId}::uuid AND o.status = 'open' AND ${where}
     GROUP BY o.product ORDER BY count(*) DESC, o.product
  `)).rows as Array<{ product: string; open: number; value: string }>;

  // Product lines each live client holds WITH THE FIRM: what the records
  // prove (AUM above zero means mutual funds; an in-force policy, its
  // insurance line; a live FD, FD / Bonds / NCD) plus whatever the
  // Cross-sell card marks "Held with us".
  // Counting the card alone read a Rs 3 Cr MF client as holding nothing.
  const keys = sql.join(CROSS_SELL_PRODUCT_KEYS.map((k) => sql`${k}`), sql`, `);
  const held = (await tx.execute(sql`
    WITH lines AS (
      SELECT i.id, cs.k AS line
        FROM investors i, jsonb_each_text(COALESCE(i.cross_sell, '{}'::jsonb)) cs(k, v)
       WHERE ${where} AND cs.v = 'held_with_us' AND cs.k IN (${keys})
      UNION
      SELECT i.id, 'mutual_funds' FROM investors i WHERE ${where} AND COALESCE(i.aum, 0) > 0
      UNION
      SELECT i.id,
             CASE WHEN p.policy_type IN ('health', 'critical_illness', 'group_health') THEN 'health_insurance'
                  WHEN p.policy_type IN ('term', 'ulip', 'endowment', 'money_back', 'life_other') THEN 'life_insurance'
                  ELSE 'general_insurance' END
        FROM investors i JOIN insurance_policies p ON p.investor_id = i.id AND p.tenant_id = i.tenant_id
       WHERE ${where} AND p.status IN ('active', 'claim_filed', 'claim_settled')
      UNION
      SELECT i.id, 'fd_bonds_ncd'
        FROM investors i JOIN fixed_deposits f ON f.investor_id = i.id AND f.tenant_id = i.tenant_id
       WHERE ${where} AND f.deleted_at IS NULL AND f.status IN ('applied', 'active')
    ),
    per AS (
      SELECT i.id, count(l.line)::int AS n
        FROM investors i LEFT JOIN lines l ON l.id = i.id
       WHERE ${where}
       GROUP BY i.id
    )
    SELECT count(*)::int AS clients, avg(n) AS avg_n, count(*) FILTER (WHERE n = 1)::int AS single FROM per
  `)).rows[0] as { clients: number; avg_n: string | null; single: number };

  const won = Number(r?.won ?? 0);
  const lost = Number(r?.lost ?? 0);
  return {
    open: Number(r?.open ?? 0),
    openValue: Number(r?.open_value ?? 0),
    won,
    wonValue: Number(r?.won_value ?? 0),
    lost,
    conversion: won + lost > 0 ? won / (won + lost) : null,
    productsPerClient: held?.clients ? Number(held.avg_n ?? 0) : null,
    clientsWithCard: Number(held?.clients ?? 0),
    singleProduct: Number(held?.single ?? 0),
    byProduct: byProduct.map((b) => ({ product: b.product, open: Number(b.open), value: Number(b.value) })),
  };
}
