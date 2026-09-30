/**
 * The SIP book — ONE definition, read by the dashboard KPI, the SIP Book page,
 * the Clients list ("Monthly SIP"), the client page and every per-RM table.
 *
 *   SIP book = Σ monthly-equivalent amount of ACTIVE SIPs of LIVE clients.
 *
 * The rows in `sips` are the source of truth. `investors.active_sip_amount` is
 * a per-client CACHE of the same sum, kept because the Clients list sorts and
 * exports on it; `refreshActiveSipAmount` is the only thing that writes it,
 * and every code path that creates or changes a SIP calls it.
 *
 * Before this, the KPI summed the cache and the SIP Book page summed the rows.
 * The cache was refreshed only by a nightly job, without converting quarterly
 * or weekly SIPs to a monthly figure, so the two disagreed — on the demo book
 * by 100× (₹8.93 L against ₹2.46 Cr), because the demo seed wrote rupees ×100
 * into the rows and the job that would have exposed it never ran locally.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientWhere, col, textList, type MetricScope } from "./scope";

/**
 * Instalments per month, as [numerator, denominator] so SQL and TypeScript are
 * generated from the same numbers and cannot drift. A quarterly ₹30,000 is
 * ₹10,000 a month; a weekly ₹1,000 is ₹4,333 a month.
 */
export const SIP_PER_MONTH: Record<string, readonly [number, number]> = {
  monthly: [1, 1],
  weekly: [52, 12],
  fortnightly: [26, 12],
  quarterly: [1, 3],
  half_yearly: [1, 6],
  yearly: [1, 12],
};

/** Monthly-equivalent amount of one SIP. An unknown frequency counts as monthly. */
export function monthlySipAmount(amount: number | string | null | undefined, frequency: string | null | undefined): number {
  const a = Number(amount);
  if (!Number.isFinite(a)) return 0;
  const [n, d] = SIP_PER_MONTH[frequency ?? "monthly"] ?? SIP_PER_MONTH.monthly;
  return (a * n) / d;
}

/** The same conversion in SQL, over a `sips` alias. */
export function sipMonthlySql(alias = "s"): SQL {
  const cases = Object.entries(SIP_PER_MONTH)
    .filter(([k]) => k !== "monthly")
    .map(([k, [n, d]]) => `WHEN '${k}' THEN ${n}.0 / ${d}`)
    .join(" ");
  return sql`(${col(alias, "amount")}::numeric * CASE ${col(alias, "frequency")} ${sql.raw(cases)} ELSE 1 END)`;
}

/** The AMC filter on a `sips` alias (empty when not set). */
function amcFilter(scope: MetricScope, alias: string): SQL {
  if (!scope.amcs?.length) return sql``;
  return sql` AND ${col(alias, "amc_name")} IN (${textList(scope.amcs)})`;
}

/** An active SIP of a live client in scope — `s` over sips, `i` over investors. */
export function activeSipWhere(scope: MetricScope, s = "s", i = "i"): SQL {
  return sql`${col(s, "tenant_id")} = ${scope.tenantId}::uuid AND ${col(s, "status")} = 'active'
    AND ${clientWhere(scope, i)}${amcFilter(scope, s)}`;
}

export type SipBook = {
  /** Monthly-equivalent rupees. */
  monthly: number;
  /** Active SIPs counted. */
  sips: number;
  /** Clients with at least one active SIP. */
  clients: number;
  /** Average monthly SIP per client with a SIP — null when there are none. */
  average: number | null;
};

export async function getSipBook(tx: Tx, scope: MetricScope): Promise<SipBook> {
  const r = (await tx.execute(sql`
    SELECT COALESCE(SUM(${sipMonthlySql("s")}), 0) AS monthly,
           COUNT(*)::int AS sips,
           COUNT(DISTINCT s.investor_id)::int AS clients
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE ${activeSipWhere(scope)}
  `)).rows[0] as { monthly: string; sips: number; clients: number } | undefined;
  const monthly = Number(r?.monthly ?? 0);
  const clients = Number(r?.clients ?? 0);
  return { monthly, sips: Number(r?.sips ?? 0), clients, average: clients > 0 ? monthly / clients : null };
}

/** Monthly SIP book per RM (client spine), for team tables. */
export async function getSipBookByRm(tx: Tx, scope: MetricScope): Promise<Map<string | null, number>> {
  const rows = (await tx.execute(sql`
    SELECT i.rm_id, COALESCE(SUM(${sipMonthlySql("s")}), 0) AS monthly
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE ${activeSipWhere(scope)}
     GROUP BY i.rm_id
  `)).rows as Array<{ rm_id: string | null; monthly: string }>;
  return new Map(rows.map((r) => [r.rm_id, Number(r.monthly)]));
}

/**
 * Recompute `investors.active_sip_amount` from the SIP rows — the ONLY writer
 * of that cache. Pass `investorIds` after touching a few SIPs; pass a
 * `tenantId` alone to refresh a firm; pass neither (system context) to refresh
 * every firm, as the nightly scanner does. Only rows whose value actually
 * changes are written. Returns the number of clients updated.
 */
export async function refreshActiveSipAmount(
  tx: Tx,
  target: { tenantId?: string; investorIds?: string[] } = {},
): Promise<number> {
  const ids = (target.investorIds ?? []).filter(Boolean);
  if (target.investorIds && ids.length === 0) return 0;
  const where: SQL[] = [];
  if (target.tenantId) where.push(sql`i2.tenant_id = ${target.tenantId}::uuid`);
  if (ids.length) where.push(sql`i2.id IN (${sql.join([...new Set(ids)].map((id) => sql`${id}::uuid`), sql`, `)})`);
  const res = await tx.execute(sql`
    UPDATE investors i SET active_sip_amount = v.amt
      FROM (
        SELECT i2.id, ROUND(COALESCE(SUM(${sipMonthlySql("s")}), 0), 2) AS amt
          FROM investors i2
          LEFT JOIN sips s ON s.investor_id = i2.id AND s.status = 'active'
         ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
         GROUP BY i2.id
      ) v
     WHERE i.id = v.id AND i.active_sip_amount IS DISTINCT FROM v.amt
  `);
  return res.rowCount ?? 0;
}
