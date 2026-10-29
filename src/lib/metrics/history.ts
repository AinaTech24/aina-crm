/**
 * A month ago, for the two BALANCES (AUM and the SIP book). A balance cannot
 * be recomputed for a past date — it has to have been recorded — so this reads
 * the nightly snapshots: firm_snapshots for the whole firm, branch_snapshots
 * for branches, rm_snapshots for RMs. Any other slice (a segment, an AMC, an RM
 * inside a branch) was never recorded, and returns null: the card then shows no
 * comparison rather than approximate one (lib/dashboard/my/window.ts, 0217).
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cleanIds, hasClientFilter, uuidList, type MetricScope } from "./scope";

export type StockThen = { date: string; aum: number; sip: number } | null;

/** Where the slice's balances were recorded, or null when they never were. */
function snapshotSource(scope: MetricScope): { source: SQL; aumCol: SQL; want: number } | null {
  if (hasClientFilter(scope) || scope.amcs?.length) return null;
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (!rms.length && !branches.length) {
    return { source: sql`firm_snapshots WHERE tenant_id = ${scope.tenantId}::uuid`, aumCol: sql`total_aum`, want: 1 };
  }
  if (rms.length && !branches.length) {
    return { source: sql`rm_snapshots WHERE tenant_id = ${scope.tenantId}::uuid AND rm_id IN (${uuidList(rms)})`, aumCol: sql`aum`, want: rms.length };
  }
  if (branches.length && !rms.length) {
    return { source: sql`branch_snapshots WHERE tenant_id = ${scope.tenantId}::uuid AND branch_id IN (${uuidList(branches)})`, aumCol: sql`aum`, want: branches.length };
  }
  return null;
}

/**
 * The balances as recorded at the end of `date` — the last snapshot on or
 * before it, within `toleranceDays`. The opening of a period's bridge (AUM,
 * SIP book). Null when that day was never recorded for this slice.
 */
export async function getStockOn(tx: Tx, scope: MetricScope, date: string, toleranceDays = 7): Promise<StockThen> {
  const src = snapshotSource(scope);
  if (!src) return null;
  const r = (await tx.execute(sql`
    WITH days AS (
      SELECT snapshot_date, SUM(${src.aumCol}) AS aum, SUM(monthly_sip) AS sip, COUNT(*) AS n
        FROM ${src.source}
         AND snapshot_date BETWEEN ${date}::date - ${toleranceDays}::int AND ${date}::date
       GROUP BY snapshot_date
    )
    SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS d, aum, sip FROM days
     WHERE n >= ${src.want}
     ORDER BY snapshot_date DESC LIMIT 1
  `)).rows[0] as { d: string; aum: string; sip: string } | undefined;
  return r ? { date: r.d, aum: Number(r.aum), sip: Number(r.sip) } : null;
}

export async function getStockMonthAgo(tx: Tx, scope: MetricScope): Promise<StockThen> {
  const src = snapshotSource(scope);
  if (!src) return null;
  const { source, aumCol, want } = src;
  // The recorded day nearest to 30 days ago, within twelve days of it; every
  // RM / branch in the slice must have a row that day or the sum is partial.
  const r = (await tx.execute(sql`
    WITH days AS (
      SELECT snapshot_date, SUM(${aumCol}) AS aum, SUM(monthly_sip) AS sip, COUNT(*) AS n
        FROM ${source}
         AND snapshot_date BETWEEN current_date - 42 AND current_date - 18
       GROUP BY snapshot_date
    )
    SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS d, aum, sip FROM days
     WHERE n >= ${want}
     ORDER BY abs(snapshot_date - (current_date - 30)) LIMIT 1
  `)).rows[0] as { d: string; aum: string; sip: string } | undefined;
  return r ? { date: r.d, aum: Number(r.aum), sip: Number(r.sip) } : null;
}
