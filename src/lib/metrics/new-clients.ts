/**
 * New clients — ONE definition:
 *
 *   clients whose ONBOARDING DATE (investors.onboarded_at, India date) falls in
 *   the period; not deleted, not merged. Status does not matter: a client
 *   onboarded in April and closed in August was still won in April.
 *
 * NOT `created_at`. An import creates hundreds of records on one afternoon;
 * every one of them has today's created_at and none of them is a new client.
 * Counting created_at is how one dashboard said 22 new clients this year while
 * the tracker, which read the onboarding date, said 2.
 *
 * The target is the firm's FY target (business_targets, metric new_clients,
 * one row per fiscal year — entered as an ANNUAL figure on Finances →
 * Progress). Achievement is always FY-to-date against it, whatever period the
 * card shows, so a month's new clients are never divided by a year's target.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRecordWhere, col, type MetricPeriod, type MetricScope } from "./scope";

/** The India calendar date a client was onboarded on, over an investors alias. */
export function onboardedDateSql(alias = "i"): SQL {
  return sql`(${col(alias, "onboarded_at")} AT TIME ZONE 'Asia/Kolkata')::date`;
}

/** The client was onboarded in the period. */
export function onboardedInSql(p: MetricPeriod, alias = "i"): SQL {
  return sql`${onboardedDateSql(alias)} BETWEEN ${p.from}::date AND ${p.to}::date`;
}

export async function getNewClients(tx: Tx, scope: MetricScope, period: MetricPeriod): Promise<number> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM investors i
     WHERE ${clientRecordWhere(scope, "i")} AND ${onboardedInSql(period, "i")}
  `)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/** New clients per RM in the period. Key null = no RM. */
export async function getNewClientsByRm(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<Map<string | null, number>> {
  const rows = (await tx.execute(sql`
    SELECT i.rm_id, COUNT(*)::int AS n FROM investors i
     WHERE ${clientRecordWhere(scope, "i")} AND ${onboardedInSql(period, "i")}
     GROUP BY i.rm_id
  `)).rows as Array<{ rm_id: string | null; n: number }>;
  return new Map(rows.map((r) => [r.rm_id, Number(r.n)]));
}

/** New clients per branch in the period. Key null = no branch. */
export async function getNewClientsByBranch(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<Map<string | null, number>> {
  const rows = (await tx.execute(sql`
    SELECT i.branch_id, COUNT(*)::int AS n FROM investors i
     WHERE ${clientRecordWhere(scope, "i")} AND ${onboardedInSql(period, "i")}
     GROUP BY i.branch_id
  `)).rows as Array<{ branch_id: string | null; n: number }>;
  return new Map(rows.map((r) => [r.branch_id, Number(r.n)]));
}

/** The client list's query string for exactly these clients. */
export function newClientsListQs(p: MetricPeriod): string {
  return `onboarded_from=${p.from}&onboarded_to=${p.to}`;
}

/**
 * Achievement against an FY target, as a fraction. Null when there is no
 * target (never 0% of nothing) or nothing to measure.
 */
export function targetPct(achievedFytd: number | null, fyTarget: number | null): number | null {
  if (achievedFytd == null || fyTarget == null || !(fyTarget > 0)) return null;
  return achievedFytd / fyTarget;
}
