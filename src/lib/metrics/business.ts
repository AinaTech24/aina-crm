/**
 * Money that moved in a period AS THE RTA PROCESSED IT — gross investment,
 * redemption, net business and net SIP added from the transaction ledger.
 *
 * NOT what the dashboards show: since 2026-10-07 every dashboard's business
 * figure is BOOKED business (lib/metrics/entries.ts, "booked business").
 * This file stays for what the registrar's view is still used for — matching
 * booked business against the feed (lib/business/rta-match.ts) and the
 * RTA-confirmed figure incentives count.
 *
 *   Gross investment  purchases, lumpsums, additional purchases, SIP
 *                     instalments and top-ups, processed by the RTA.
 *                     Switches and STPs are NOT gross: the feed collapses both
 *                     legs into one inflow row, so counting them books the same
 *                     money twice — on one production book, 1,666 rows and
 *                     ₹39.56 Cr of "fresh investment" that was the same money
 *                     moving between schemes. Results MIS DOES count them: it
 *                     reads Business Entries, where both legs are recorded
 *                     (src/lib/business/mis.ts).
 *   Redemption        redemptions and SWPs, processed.
 *   Net business      gross − redemption.
 *   Net SIP added     monthly amount of SIPs registered in the period (by
 *                     start date, not rejected) − SIP stops and pauses the RTA
 *                     reported in the period (lib/dashboard/my/window.ts
 *                     explains why stops come from the ledger).
 *
 * ── No data is not zero ─────────────────────────────────────────────────────
 *
 * All four depend on the transaction ledger, which exists only once RTA files
 * are imported. A firm that has imported nothing, or whose last file ends
 * before the period starts, does not have ₹0 of business — it has no data for
 * that period. `hasData` says which, and the card then shows "—" with
 * "Import RTA files" instead of ₹0 with "↘100%". The comparison with the
 * previous period is dropped (`previous: null`) unless the ledger covers that
 * period from its first day, so a half-imported year never reads as growth.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRecordWhere, textList, type MetricPeriod, type MetricScope } from "./scope";
import { sipMonthlySql } from "./sip";

export const GROSS_TYPES = ["purchase", "lumpsum", "additional_purchase", "sip", "sip_topup"] as const;
export const REDEMPTION_TYPES = ["redemption", "swp"] as const;
export const SIP_STOP_TYPES = ["sip_stop", "sip_pause"] as const;
export const PROCESSED_TXN_STATUSES = ["processed", "successful"] as const;

/** Constant lists as a literal IN clause — module constants only, never input. */
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x.replace(/'/g, "")}'`).join(", "));

export type FlowFigures = {
  gross: number;
  redemption: number;
  net: number;
  /** Monthly amount of SIPs registered in the period. */
  newSip: number;
  /** SIP stops and pauses in the period, as the RTA reported them. */
  stoppedSip: number;
  netSip: number;
};

export type LedgerCoverage = { first: string | null; last: string | null };

export type NetBusiness = {
  /** True when imported transactions reach into the period. */
  hasData: boolean;
  coverage: LedgerCoverage;
  current: FlowFigures | null;
  /** Null when the ledger does not cover the previous period from its first day. */
  previous: FlowFigures | null;
};

/** The firm's ledger span — about the import, so tenant-wide whatever the scope. */
export async function getLedgerCoverage(tx: Tx, tenantId: string): Promise<LedgerCoverage> {
  const r = (await tx.execute(sql`
    SELECT to_char(MIN(order_date), 'YYYY-MM-DD') AS first, to_char(MAX(order_date), 'YYYY-MM-DD') AS last
      FROM transactions
     WHERE tenant_id = ${tenantId}::uuid AND status IN (${inList(PROCESSED_TXN_STATUSES)})
       AND amount IS NOT NULL AND order_date IS NOT NULL
  `)).rows[0] as LedgerCoverage | undefined;
  return { first: r?.first ?? null, last: r?.last ?? null };
}

/** Imported transactions reach into the period. */
export function coversPeriod(c: LedgerCoverage, p: MetricPeriod): boolean {
  return !!c.last && c.last >= p.from;
}

/** The ledger covers the whole period from its first day — safe to compare against. */
export function coversWholePeriod(c: LedgerCoverage, p: MetricPeriod): boolean {
  return !!c.first && !!c.last && c.first <= p.from && c.last >= p.from;
}

function amcTxn(scope: MetricScope) {
  return scope.amcs?.length ? sql` AND t.amc_name IN (${textList(scope.amcs)})` : sql``;
}

function amcSip(scope: MetricScope) {
  return scope.amcs?.length ? sql` AND s.amc_name IN (${textList(scope.amcs)})` : sql``;
}

async function flowsFor(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<FlowFigures> {
  const led = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(GROSS_TYPES)})), 0)      AS gross,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(REDEMPTION_TYPES)})), 0) AS redemption,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(SIP_STOP_TYPES)})), 0)   AS stopped
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${scope.tenantId}::uuid
       AND t.status IN (${inList(PROCESSED_TXN_STATUSES)}) AND t.amount IS NOT NULL
       AND t.order_date >= ${p.from}::date AND t.order_date <= ${p.to}::date
       AND ${clientRecordWhere(scope, "i")}${amcTxn(scope)}
  `)).rows[0] as Record<string, string> | undefined;
  const reg = (await tx.execute(sql`
    SELECT COALESCE(SUM(${sipMonthlySql("s")}), 0) AS new_sip
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${scope.tenantId}::uuid AND s.status <> 'rejected'
       AND s.start_date >= ${p.from}::date AND s.start_date <= ${p.to}::date
       AND ${clientRecordWhere(scope, "i")}${amcSip(scope)}
  `)).rows[0] as Record<string, string> | undefined;
  const gross = Number(led?.gross ?? 0);
  const redemption = Number(led?.redemption ?? 0);
  const newSip = Number(reg?.new_sip ?? 0);
  const stoppedSip = Number(led?.stopped ?? 0);
  return { gross, redemption, net: gross - redemption, newSip, stoppedSip, netSip: newSip - stoppedSip };
}

export async function getNetBusiness(
  tx: Tx, scope: MetricScope, period: MetricPeriod, previous?: MetricPeriod | null,
): Promise<NetBusiness> {
  const coverage = await getLedgerCoverage(tx, scope.tenantId);
  if (!coversPeriod(coverage, period)) return { hasData: false, coverage, current: null, previous: null };
  const current = await flowsFor(tx, scope, period);
  const prev = previous && coversWholePeriod(coverage, previous) ? await flowsFor(tx, scope, previous) : null;
  return { hasData: true, coverage, current, previous: prev };
}

/** Net business per RM (client spine) in the period. Empty when there is no data. */
export async function getNetBusinessByRm(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<{ hasData: boolean; byRm: Map<string | null, number> }> {
  const coverage = await getLedgerCoverage(tx, scope.tenantId);
  if (!coversPeriod(coverage, period)) return { hasData: false, byRm: new Map() };
  const rows = (await tx.execute(sql`
    SELECT i.rm_id,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(GROSS_TYPES)})), 0)
      - COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(REDEMPTION_TYPES)})), 0) AS net
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${scope.tenantId}::uuid
       AND t.status IN (${inList(PROCESSED_TXN_STATUSES)}) AND t.amount IS NOT NULL
       AND t.order_date >= ${period.from}::date AND t.order_date <= ${period.to}::date
       AND ${clientRecordWhere(scope, "i")}${amcTxn(scope)}
     GROUP BY i.rm_id
  `)).rows as Array<{ rm_id: string | null; net: string }>;
  return { hasData: true, byRm: new Map(rows.map((r) => [r.rm_id, Number(r.net)])) };
}

/** Net business per branch (client spine) in the period. */
export async function getNetBusinessByBranch(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<{ hasData: boolean; byBranch: Map<string | null, number> }> {
  const coverage = await getLedgerCoverage(tx, scope.tenantId);
  if (!coversPeriod(coverage, period)) return { hasData: false, byBranch: new Map() };
  const rows = (await tx.execute(sql`
    SELECT i.branch_id,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(GROSS_TYPES)})), 0)
      - COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(REDEMPTION_TYPES)})), 0) AS net
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${scope.tenantId}::uuid
       AND t.status IN (${inList(PROCESSED_TXN_STATUSES)}) AND t.amount IS NOT NULL
       AND t.order_date >= ${period.from}::date AND t.order_date <= ${period.to}::date
       AND ${clientRecordWhere(scope, "i")}${amcTxn(scope)}
     GROUP BY i.branch_id
  `)).rows as Array<{ branch_id: string | null; net: string }>;
  return { hasData: true, byBranch: new Map(rows.map((r) => [r.branch_id, Number(r.net)])) };
}

/** Monthly gross / redemption / net for the money-movement chart, oldest first. */
export async function getMonthlyFlows(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<Array<{ month: string; gross: number; redemption: number; net: number }>> {
  const rows = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', t.order_date), 'YYYY-MM') AS month,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(GROSS_TYPES)})), 0)      AS gross,
      COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (${inList(REDEMPTION_TYPES)})), 0) AS redemption
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${scope.tenantId}::uuid
       AND t.status IN (${inList(PROCESSED_TXN_STATUSES)}) AND t.amount IS NOT NULL
       AND t.order_date >= ${period.from}::date AND t.order_date <= ${period.to}::date
       AND ${clientRecordWhere(scope, "i")}${amcTxn(scope)}
     GROUP BY 1 ORDER BY 1
  `)).rows as Array<{ month: string; gross: string; redemption: string }>;
  return rows.map((r) => {
    const gross = Number(r.gross);
    const redemption = Number(r.redemption);
    return { month: r.month, gross, redemption, net: gross - redemption };
  });
}
