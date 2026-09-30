/**
 * The client book: how many clients, and what they hold.
 *
 * ONE definition of each count, used wherever the word appears:
 *
 *   Clients         live clients — not deleted, not merged, not closed
 *                   (aliveClient). The book. What the Clients list shows.
 *   Active clients  live clients whose status is `active` or
 *                   `redemption_risk` — i.e. not dormant or inactive. A client
 *                   flagged as a redemption risk still holds money with us.
 *   Funded clients  live clients with AUM above zero.
 *
 * The first dashboards used three different words for three different
 * numbers — "19 active" beside "20 funded / 22 total" — with nothing to say
 * which was which.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientWhere, col, textList, type MetricScope } from "./scope";

export const ACTIVE_CLIENT_STATUSES = ["active", "redemption_risk"] as const;

/** `alias` is an active client (on top of clientWhere). */
export function activeClientSql(alias = "i") {
  return sql`${col(alias, "status")} IN (${textList([...ACTIVE_CLIENT_STATUSES])})`;
}

export type ClientCounts = { clients: number; active: number; funded: number };

export async function getActiveClients(tx: Tx, scope: MetricScope): Promise<ClientCounts> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS clients,
           COUNT(*) FILTER (WHERE ${activeClientSql("i")})::int AS active,
           COUNT(*) FILTER (WHERE COALESCE(i.aum, 0) > 0)::int AS funded
      FROM investors i
     WHERE ${clientWhere(scope, "i")}
  `)).rows[0] as Partial<ClientCounts> | undefined;
  return { clients: Number(r?.clients ?? 0), active: Number(r?.active ?? 0), funded: Number(r?.funded ?? 0) };
}

export type Aum = { aum: number; funded: number };

/**
 * Assets under management of live clients in scope.
 *
 * Without an AMC filter this is the per-client figure `investors.aum`, which
 * the AUM recompute keeps (see lib/finance/aum-persist.ts and the AUM truth
 * notes there). With an AMC filter it is the folios of that AMC, because the
 * per-client total has no AMC split.
 */
export async function getAUM(tx: Tx, scope: MetricScope): Promise<Aum> {
  if (scope.amcs?.length) {
    const r = (await tx.execute(sql`
      SELECT COALESCE(SUM(f.aum), 0) AS aum, COUNT(DISTINCT f.investor_id) FILTER (WHERE f.aum > 0)::int AS funded
        FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${scope.tenantId}::uuid AND f.amc_name IN (${textList(scope.amcs)})
         AND ${clientWhere(scope, "i")}
    `)).rows[0] as { aum: string; funded: number } | undefined;
    return { aum: Number(r?.aum ?? 0), funded: Number(r?.funded ?? 0) };
  }
  const r = (await tx.execute(sql`
    SELECT COALESCE(SUM(i.aum), 0) AS aum, COUNT(*) FILTER (WHERE COALESCE(i.aum, 0) > 0)::int AS funded
      FROM investors i
     WHERE ${clientWhere(scope, "i")}
  `)).rows[0] as { aum: string; funded: number } | undefined;
  return { aum: Number(r?.aum ?? 0), funded: Number(r?.funded ?? 0) };
}

/** Per-RM clients and AUM (client spine), for team tables. Key null = no RM. */
export async function getBookByRm(
  tx: Tx, scope: MetricScope,
): Promise<Map<string | null, { clients: number; aum: number }>> {
  const rows = (await tx.execute(sql`
    SELECT i.rm_id, COUNT(*)::int AS clients, COALESCE(SUM(i.aum), 0) AS aum
      FROM investors i
     WHERE ${clientWhere(scope, "i")}
     GROUP BY i.rm_id
  `)).rows as Array<{ rm_id: string | null; clients: number; aum: string }>;
  return new Map(rows.map((r) => [r.rm_id, { clients: Number(r.clients), aum: Number(r.aum) }]));
}

/** Per-branch clients and AUM (client spine). Key null = no branch. */
export async function getBookByBranch(
  tx: Tx, scope: MetricScope,
): Promise<Map<string | null, { clients: number; aum: number }>> {
  const rows = (await tx.execute(sql`
    SELECT i.branch_id, COUNT(*)::int AS clients, COALESCE(SUM(i.aum), 0) AS aum
      FROM investors i
     WHERE ${clientWhere(scope, "i")}
     GROUP BY i.branch_id
  `)).rows as Array<{ branch_id: string | null; clients: number; aum: string }>;
  return new Map(rows.map((r) => [r.branch_id, { clients: Number(r.clients), aum: Number(r.aum) }]));
}
