/**
 * Business Entries — the business the team RECORDS (a form per client visit:
 * product, scheme lines, amounts), as opposed to the RTA ledger the KPI cards
 * read (business.ts). The Owner Dashboard shows both side by side, because
 * they answer different questions and can differ by timing and coverage:
 *
 *   Business Entries   booked on the business date, every product (MF, PMS,
 *                      AIF, SIF, bonds …), split by asset class; counted once
 *                      confirmed (`confirmed` or `emailed`), never as a draft.
 *   RTA ledger         what CAMS / KFintech processed — MF only, no PMS / AIF
 *                      / SIF rows, and nothing until files are imported.
 *
 * The gross / redemption rule is the Results MIS's (src/lib/business/mis.ts)
 * and the Branch Head Dashboard's (lib/dashboard/branch/sections.ts):
 *
 *   Gross        sip, sip_topup, lumpsum, additional_purchase, switch, stp.
 *                A switch or STP counts here because an entry records the
 *                target asset class explicitly — unlike the ledger, where both
 *                legs arrive as one inflow row.
 *   Redemption   redemption, swp.
 *   SIP added    sip + sip_topup lines, at their MONTHLY equivalent (the same
 *                factor table as the SIP book, sipMonthlySql).
 *   SIP stopped  sip_stop lines — a registration event, not money moved, so it
 *                is in neither gross nor redemption.
 *
 * ── Whose entry is it ───────────────────────────────────────────────────────
 *
 * An entry belongs to its CLIENT's RM and branch when it names a client, and
 * otherwise to the RM who booked it (and that RM's branch) — the Branch Head
 * Dashboard's rule. Client-only filters (segment, category, family, tags,
 * lead source) can only match an entry that names a client.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cleanIds, clientRecordWhere, hasClientFilter, textList, uuidList, type MetricPeriod, type MetricScope } from "./scope";
import { sipMonthlySql } from "./sip";

export const ENTRY_COUNTED = ["confirmed", "emailed"] as const;
export const ENTRY_GROSS = ["sip", "sip_topup", "lumpsum", "additional_purchase", "switch", "stp"] as const;
export const ENTRY_REDEMPTION = ["redemption", "swp"] as const;
export const ENTRY_SIP_ADD = ["sip", "sip_topup"] as const;

/** Constant lists as a literal IN clause — module constants only, never input. */
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x.replace(/'/g, "")}'`).join(", "));

/** The products the sheet names; everything else is "Other products". */
export const ENTRY_PRODUCTS = [
  { key: "mf", label: "Mutual Fund", types: ["mutual_fund"] },
  { key: "pms", label: "PMS", types: ["pms"] },
  { key: "aif", label: "AIF", types: ["aif"] },
  { key: "sif", label: "SIF", types: ["sif"] },
  { key: "other", label: "Other products", types: ["direct_equity", "bond", "ncd", "p2p", "las", "other"] },
] as const;

/** Asset-class rows under each product, in the order the sheet reads them. */
export const ENTRY_ASSET_CLASSES = [
  { key: "equity", label: "Equity" },
  { key: "liquid", label: "Liquid" },
  { key: "debt", label: "Debt" },
  { key: "hybrid", label: "Hybrid" },
  { key: "other", label: "Gold & other" },
] as const;

const productSql = sql.raw(`CASE ${ENTRY_PRODUCTS.filter((p) => p.key !== "other")
  .map((p) => `WHEN be.product_type IN (${p.types.map((t) => `'${t}'`).join(", ")}) THEN '${p.key}'`).join(" ")} ELSE 'other' END`);
const assetSql = sql.raw(`CASE WHEN bel.asset_class IN ('equity', 'liquid', 'debt', 'hybrid') THEN bel.asset_class ELSE 'other' END`);

/** Tenant + counted + in period + the scope's restrictions, over `be` / `bel` / `i` (client) / `u` (booking RM). */
function entryWhere(scope: MetricScope, p: MetricPeriod): SQL {
  const parts: SQL[] = [
    sql`be.tenant_id = ${scope.tenantId}::uuid`,
    sql`be.status IN (${inList(ENTRY_COUNTED)})`,
    sql`be.business_date >= ${p.from}::date AND be.business_date <= ${p.to}::date`,
    sql`(i.id IS NULL OR i.deleted_at IS NULL)`,
  ];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (rms.length) parts.push(sql`COALESCE(i.rm_id, be.rm_id) IN (${uuidList(rms)})`);
  if (branches.length) parts.push(sql`COALESCE(i.branch_id, u.branch_id) IN (${uuidList(branches)})`);
  if (hasClientFilter(scope)) {
    // Only an entry that names a client can match a client filter.
    parts.push(sql`i.id IS NOT NULL AND ${clientRecordWhere({ ...scope, rmIds: undefined, branchIds: undefined }, "i")}`);
  }
  if (scope.amcs?.length) parts.push(sql`COALESCE(bel.amc_name, be.amc_name) IN (${textList(scope.amcs)})`);
  return sql.join(parts, sql` AND `);
}

const ENTRY_FROM = sql`business_entries be
  JOIN business_entry_lines bel ON bel.entry_id = be.id
  LEFT JOIN investors i ON i.id = be.investor_id
  LEFT JOIN users u ON u.id = be.rm_id`;

export type EntryCell = { gross: number; redemption: number; net: number; redeemingClients: number };
export type EntryRow = { key: string; label: string } & EntryCell;
export type EntryProduct = { key: string; label: string; total: EntryCell; rows: EntryRow[] };

export type EntryMatrix = {
  /** False when the firm has never confirmed a business entry — "—", not ₹0. */
  everRecorded: boolean;
  products: EntryProduct[];
  total: EntryCell;
};

const cell = (g: number, r: number, n: number): EntryCell => ({ gross: g, redemption: r, net: g - r, redeemingClients: n });

/** Gross / redemption / net by product × asset class for the period. */
export async function getEntryMatrix(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<EntryMatrix> {
  const ever = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM business_entries WHERE tenant_id = ${scope.tenantId}::uuid
      AND status IN (${inList(ENTRY_COUNTED)})) AS ok
  `)).rows[0] as { ok: boolean } | undefined;
  // One client key: the linked client, else the name typed on the entry.
  const who = sql`COALESCE(be.investor_id::text, lower(btrim(be.client_name)))`;
  const rows = (await tx.execute(sql`
    SELECT GROUPING(${productSql}) AS gp, GROUPING(${assetSql}) AS ga,
           ${productSql} AS product, ${assetSql} AS asset,
           COALESCE(SUM(bel.amount) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_GROSS)})), 0) AS gross,
           COALESCE(SUM(bel.amount) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_REDEMPTION)})), 0) AS redemption,
           COUNT(DISTINCT ${who}) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_REDEMPTION)}))::int AS redeemers
      FROM ${ENTRY_FROM}
     WHERE ${entryWhere(scope, p)}
     GROUP BY GROUPING SETS ((${productSql}, ${assetSql}), (${productSql}), ())
  `)).rows as Array<{ gp: number; ga: number; product: string | null; asset: string | null; gross: string; redemption: string; redeemers: number }>;

  const at = (product: string | null, asset: string | null) =>
    rows.find((r) => r.product === product && r.asset === asset && (product == null ? Number(r.gp) === 1 : Number(r.gp) === 0)
      && (asset == null ? Number(r.ga) === 1 : Number(r.ga) === 0));
  const toCell = (r?: { gross: string; redemption: string; redeemers: number }) =>
    cell(Number(r?.gross ?? 0), Number(r?.redemption ?? 0), Number(r?.redeemers ?? 0));

  const products: EntryProduct[] = ENTRY_PRODUCTS.map((prod) => ({
    key: prod.key,
    label: prod.label,
    total: toCell(at(prod.key, null)),
    rows: ENTRY_ASSET_CLASSES.map((a) => ({ key: a.key, label: a.label, ...toCell(at(prod.key, a.key)) }))
      .filter((r) => r.gross || r.redemption),
  }));
  return { everRecorded: !!ever?.ok, products, total: toCell(at(null, null)) };
}

export type EntrySipFlow = {
  everRecorded: boolean;
  /** Monthly equivalent of SIPs and top-ups booked in the period. */
  added: number;
  addedCount: number;
  /** SIP stops booked in the period (amount per instalment, as entered, monthly-equivalent). */
  stopped: number;
  stoppedCount: number;
  net: number;
};

/** Gross SIP added, SIP stops and net SIP from Business Entries. */
export async function getEntrySipFlow(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<EntrySipFlow> {
  const r = (await tx.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM business_entries WHERE tenant_id = ${scope.tenantId}::uuid
        AND status IN (${inList(ENTRY_COUNTED)})) AS ever,
      COALESCE(SUM(${sipMonthlySql("bel")}) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_SIP_ADD)})), 0) AS added,
      COUNT(*) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_SIP_ADD)}))::int AS added_n,
      COALESCE(SUM(${sipMonthlySql("bel")}) FILTER (WHERE bel.txn_type = 'sip_stop'), 0) AS stopped,
      COUNT(*) FILTER (WHERE bel.txn_type = 'sip_stop')::int AS stopped_n
      FROM ${ENTRY_FROM}
     WHERE ${entryWhere(scope, p)}
  `)).rows[0] as Record<string, string | number | boolean> | undefined;
  const added = Number(r?.added ?? 0);
  const stopped = Number(r?.stopped ?? 0);
  return {
    everRecorded: !!r?.ever,
    added, addedCount: Number(r?.added_n ?? 0),
    stopped, stoppedCount: Number(r?.stopped_n ?? 0),
    net: added - stopped,
  };
}
