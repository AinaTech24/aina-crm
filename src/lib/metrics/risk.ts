/**
 * Risk-profile counts — the Risk Profiles page's five tabs, over the same
 * clients everywhere (dashboard, My Day, the Compliance dashboard, the page):
 *
 *   active clients (lib/metrics/clients.ts) in scope, each in exactly one
 *   bucket (lib/risk-profile/buckets.ts): awaiting confirmation, not
 *   profiled, current, due for review, expired.
 *
 * "Risk profiles due" on a dashboard means the clients who need a profile
 * action now: due for review + expired. Not profiled is its own row.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { RISK_BUCKETS, riskBucketSql, type RiskBucket } from "@/lib/risk-profile/buckets";
import { activeClientSql } from "./clients";
import { clientWhere, type MetricScope } from "./scope";

/** The clients the Risk Profiles page lists, on the `i` alias the bucket SQL expects. */
export function riskProfileBaseSql(scope: MetricScope): SQL {
  return sql`${clientWhere(scope, "i")} AND ${activeClientSql("i")}`;
}

export type RiskProfileCounts = Record<RiskBucket, number> & { total: number; needsAction: number };

export async function getRiskProfileCounts(tx: Tx, scope: MetricScope): Promise<RiskProfileCounts> {
  const cols = RISK_BUCKETS.map((b) => sql`COUNT(*) FILTER (WHERE ${riskBucketSql(b.key)})::int AS ${sql.raw(b.key)}`);
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total, ${sql.join(cols, sql`, `)}
      FROM investors i WHERE ${riskProfileBaseSql(scope)}
  `)).rows[0] as Record<string, number> | undefined;
  const out = { total: Number(r?.total ?? 0) } as RiskProfileCounts;
  for (const b of RISK_BUCKETS) out[b.key] = Number(r?.[b.key] ?? 0);
  out.needsAction = out.due + out.expired;
  return out;
}
