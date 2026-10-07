/**
 * Which reconciliation breaks "Sync to CRM" can fix, in one place for the bulk
 * route and the page's "Sync all to CRM (N)" count: open or investigating,
 * with a client, and the feed holding more units than the CRM beyond the
 * tolerance (an additive break — the sync posts the missing units). Narrowed
 * by the page's own status / severity / type filter. Over alias `e`
 * (reconciliation_exceptions).
 */

import { sql, type SQL } from "drizzle-orm";

/** Unit difference below which a break is rounding, not missing units. */
export const RECON_TOLERANCE = 0.5;

export type ReconFilter = { status?: string[]; severity?: string[]; type?: string[] };

export function syncableWhere(tenantId: string, filter: ReconFilter): SQL {
  const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
  const status = (filter.status?.length ? filter.status : ["open", "investigating"]).filter((x) => x === "open" || x === "investigating");
  const conds: SQL[] = [
    sql`e.tenant_id = ${tenantId}::uuid`,
    status.length ? sql`e.status IN (${list(status)})` : sql`FALSE`,
    sql`e.investor_id IS NOT NULL`,
    sql`COALESCE(e.feed_units, 0) - COALESCE(e.crm_units, 0) > ${RECON_TOLERANCE}`,
  ];
  if (filter.severity?.length) conds.push(sql`e.severity IN (${list(filter.severity)})`);
  if (filter.type?.length) conds.push(sql`e.exception_type IN (${list(filter.type)})`);
  return sql.join(conds, sql` AND `);
}
