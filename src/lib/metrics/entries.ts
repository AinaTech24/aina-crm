/**
 * Business Entries — the business the team RECORDS (a form per client visit:
 * product, scheme lines, amounts), as opposed to the RTA ledger (business.ts).
 *
 *   Business Entries   booked on the business date, every product (MF, PMS,
 *                      AIF, SIF, bonds …), split by asset class; counted once
 *                      confirmed (`confirmed` or `emailed`), never as a draft.
 *   RTA ledger         what CAMS / KFintech processed — MF only, no PMS / AIF
 *                      / SIF rows, and nothing until files are imported.
 *
 * EVERY dashboard's money-moved figures come from here — gross, redemption,
 * net business, SIP added / stopped / net SIP, the targets on them, trends,
 * month on month and the FY scorecard (the firm's decision of 2026-10-07).
 * Only AUM, the SIP book balance and SIP rejections are still the registrar's.
 * "Booked business" at the end of this file is that set of figures.
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
 *
 * ── When the RTA rejects what was booked ────────────────────────────────────
 *
 * Booked business is what TARGETS count. Each mutual-fund line is checked
 * against the RTA feed (lib/business/rta-match.ts); a line the RTA rejected —
 * a failed payment, a bounced first SIP debit — is, by the firm's setting
 * (bookedRejectionMode, Settings → Dashboard thresholds):
 *
 *   reverse   kept on the day it was booked, and subtracted on the day it was
 *             rejected (the default: a past day's figure never changes)
 *   drop      removed from the day it was booked
 *
 * So every figure here runs over `bel` rows that carry a `sign` (+1 booked,
 * −1 the reversal) and an `eff_date` (the business date, or the rejection
 * date). Incentives do not read this file: they count what the RTA processed
 * (business.ts).
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cleanIds, clientRecordWhere, hasClientFilter, textList, uuidList, type MetricPeriod, type MetricScope } from "./scope";
import { sipMonthlySql } from "./sip";
import type { FlowFigures } from "./business";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";

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
    sql`bel.eff_date >= ${p.from}::date AND bel.eff_date <= ${p.to}::date`,
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

export type RejectionMode = "reverse" | "drop";

/**
 * The lines as booked business: +1 on the business date and, under "reverse",
 * −1 on the rejection date for a line the RTA rejected. Under "drop" a rejected
 * line is simply absent.
 */
function signedLines(tenantId: string, mode: RejectionMode): SQL {
  const booked = mode === "drop" ? sql` AND l.rta_status <> 'rejected'` : sql``;
  const reversal = mode === "reverse"
    ? sql`
      UNION ALL
      SELECT l.*, -1 AS sign, l.rta_status_at AS eff_date
        FROM business_entry_lines l
       WHERE l.tenant_id = ${tenantId}::uuid AND l.rta_status = 'rejected' AND l.rta_status_at IS NOT NULL`
    : sql``;
  return sql`(
      SELECT l.*, 1 AS sign, e.business_date AS eff_date
        FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id
       WHERE l.tenant_id = ${tenantId}::uuid${booked}${reversal}
    )`;
}

const entryFrom = (tenantId: string, mode: RejectionMode) => sql`business_entries be
  JOIN ${signedLines(tenantId, mode)} bel ON bel.entry_id = be.id
  LEFT JOIN investors i ON i.id = be.investor_id
  LEFT JOIN users u ON u.id = be.rm_id`;

/** The firm's choice for rejected booked business (Settings → Dashboard thresholds). */
async function rejectionMode(tx: Tx): Promise<RejectionMode> {
  return (await loadDashboardThresholds(tx)).bookedRejectionMode;
}

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
  const mode = await rejectionMode(tx);
  const rows = (await tx.execute(sql`
    SELECT GROUPING(${productSql}) AS gp, GROUPING(${assetSql}) AS ga,
           ${productSql} AS product, ${assetSql} AS asset,
           COALESCE(SUM(bel.amount * bel.sign) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_GROSS)})), 0) AS gross,
           COALESCE(SUM(bel.amount * bel.sign) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_REDEMPTION)})), 0) AS redemption,
           COUNT(DISTINCT ${who}) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_REDEMPTION)}) AND bel.sign = 1)::int AS redeemers
      FROM ${entryFrom(scope.tenantId, mode)}
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
  const mode = await rejectionMode(tx);
  const r = (await tx.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM business_entries WHERE tenant_id = ${scope.tenantId}::uuid
        AND status IN (${inList(ENTRY_COUNTED)})) AS ever,
      COALESCE(SUM(${sipMonthlySql("bel")} * bel.sign) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_SIP_ADD)})), 0) AS added,
      COALESCE(SUM(bel.sign) FILTER (WHERE bel.txn_type IN (${inList(ENTRY_SIP_ADD)})), 0)::int AS added_n,
      COALESCE(SUM(${sipMonthlySql("bel")} * bel.sign) FILTER (WHERE bel.txn_type = 'sip_stop'), 0) AS stopped,
      COALESCE(SUM(bel.sign) FILTER (WHERE bel.txn_type = 'sip_stop'), 0)::int AS stopped_n
      FROM ${entryFrom(scope.tenantId, mode)}
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

/* ─────────────────────────────── booked business ─────────────────────────────── */

/**
 * The money-moved figures every dashboard shows, booked: the matrix's gross /
 * redemption / net over every product and the SIP flow's added / stopped /
 * net, in the shape the RTA functions in business.ts used to hand the cards
 * (FlowFigures), plus the counts behind them.
 */
export type BookedFigures = FlowFigures & {
  /** SIP and top-up lines booked (net of reversals). */
  newSipCount: number;
  /** SIP-stop lines booked. */
  stoppedSipCount: number;
  /** Distinct clients with a redemption booked. */
  redeemingClients: number;
};

export type BookedBusiness = {
  /** False when the firm has never confirmed an entry — "—", never ₹0. */
  hasData: boolean;
  current: BookedFigures | null;
  previous: BookedFigures | null;
};

const SAFE_PREFIX = /^[a-z][a-z0-9_]*$/;

/**
 * The booked figures as SELECT columns over signed lines `bel`, each limited
 * by `when` and named `<prefix>_…` — so one pass can read several date windows.
 * Read them back with readBookedFigures.
 */
export function bookedFigureColumns(prefix: string, when: SQL = sql`TRUE`): SQL {
  if (!SAFE_PREFIX.test(prefix)) throw new Error(`bad column prefix "${prefix}"`);
  const c = (name: string) => sql.raw(`${prefix}_${name}`);
  const who = sql`COALESCE(be.investor_id::text, lower(btrim(be.client_name)))`;
  return sql`
    COALESCE(SUM(bel.amount * bel.sign) FILTER (WHERE (${when}) AND bel.txn_type IN (${inList(ENTRY_GROSS)})), 0) AS ${c("gross")},
    COALESCE(SUM(bel.amount * bel.sign) FILTER (WHERE (${when}) AND bel.txn_type IN (${inList(ENTRY_REDEMPTION)})), 0) AS ${c("red")},
    COALESCE(SUM(${sipMonthlySql("bel")} * bel.sign) FILTER (WHERE (${when}) AND bel.txn_type IN (${inList(ENTRY_SIP_ADD)})), 0) AS ${c("sip_add")},
    COALESCE(SUM(bel.sign) FILTER (WHERE (${when}) AND bel.txn_type IN (${inList(ENTRY_SIP_ADD)})), 0)::int AS ${c("sip_add_n")},
    COALESCE(SUM(${sipMonthlySql("bel")} * bel.sign) FILTER (WHERE (${when}) AND bel.txn_type = 'sip_stop'), 0) AS ${c("sip_stop")},
    COALESCE(SUM(bel.sign) FILTER (WHERE (${when}) AND bel.txn_type = 'sip_stop'), 0)::int AS ${c("sip_stop_n")},
    COUNT(DISTINCT ${who}) FILTER (WHERE (${when}) AND bel.txn_type IN (${inList(ENTRY_REDEMPTION)}) AND bel.sign = 1)::int AS ${c("redeemers")}`;
}

/** The columns bookedFigureColumns(prefix) produced, as figures. */
export function readBookedFigures(row: Record<string, unknown> | undefined, prefix: string): BookedFigures {
  const n = (k: string) => {
    const v = Number(row?.[`${prefix}_${k}`] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const gross = n("gross");
  const redemption = n("red");
  const newSip = n("sip_add");
  const stoppedSip = n("sip_stop");
  return {
    gross, redemption, net: gross - redemption,
    newSip, stoppedSip, netSip: newSip - stoppedSip,
    newSipCount: n("sip_add_n"), stoppedSipCount: n("sip_stop_n"), redeemingClients: n("redeemers"),
  };
}

/** Has the firm ever confirmed a business entry? About the firm, so scope-free. */
export async function hasBookedBusiness(tx: Tx, tenantId: string): Promise<boolean> {
  const r = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM business_entries WHERE tenant_id = ${tenantId}::uuid
      AND status IN (${inList(ENTRY_COUNTED)})) AS ok
  `)).rows[0] as { ok: boolean } | undefined;
  return !!r?.ok;
}

/**
 * The signed booked lines, for a caller that places entries in a book of its
 * own (the RM and Branch dashboards, lib/dashboard/my/booked.ts):
 * `FROM ${await bookedEntriesFrom(tx, t)} WHERE ${bookedEntriesWhere(t)} AND …`
 * over `be` (entry), `bel` (signed line), `i` (client) and `u` (booking RM).
 */
export async function bookedEntriesFrom(tx: Tx, tenantId: string): Promise<SQL> {
  return entryFrom(tenantId, await rejectionMode(tx));
}

/** Counted entries of the firm, on a client not deleted (or on none). */
export function bookedEntriesWhere(tenantId: string): SQL {
  return sql`be.tenant_id = ${tenantId}::uuid AND be.status IN (${inList(ENTRY_COUNTED)})
    AND (i.id IS NULL OR i.deleted_at IS NULL)`;
}

async function bookedFor(tx: Tx, scope: MetricScope, p: MetricPeriod, from: SQL): Promise<BookedFigures> {
  const r = (await tx.execute(sql`
    SELECT ${bookedFigureColumns("f")}
      FROM ${from}
     WHERE ${entryWhere(scope, p)}
  `)).rows[0] as Record<string, unknown> | undefined;
  return readBookedFigures(r, "f");
}

/** Booked business in the period (and the comparison period), for a scope. */
export async function getBookedBusiness(
  tx: Tx, scope: MetricScope, period: MetricPeriod, previous?: MetricPeriod | null,
): Promise<BookedBusiness> {
  if (!(await hasBookedBusiness(tx, scope.tenantId))) return { hasData: false, current: null, previous: null };
  const from = entryFrom(scope.tenantId, await rejectionMode(tx));
  return {
    hasData: true,
    current: await bookedFor(tx, scope, period, from),
    previous: previous ? await bookedFor(tx, scope, previous, from) : null,
  };
}

/** Booked net business per RM — the client's RM, else the RM who booked it. */
export async function getBookedNetByRm(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<{ hasData: boolean; byRm: Map<string | null, number> }> {
  if (!(await hasBookedBusiness(tx, scope.tenantId))) return { hasData: false, byRm: new Map() };
  const rows = (await tx.execute(sql`
    SELECT COALESCE(i.rm_id, be.rm_id)::text AS k, ${bookedFigureColumns("f")}
      FROM ${entryFrom(scope.tenantId, await rejectionMode(tx))}
     WHERE ${entryWhere(scope, period)}
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;
  return { hasData: true, byRm: new Map(rows.map((r) => [(r.k as string | null) ?? null, readBookedFigures(r, "f").net])) };
}

/** Booked net business per branch — the client's branch, else the booking RM's. */
export async function getBookedNetByBranch(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<{ hasData: boolean; byBranch: Map<string | null, number> }> {
  if (!(await hasBookedBusiness(tx, scope.tenantId))) return { hasData: false, byBranch: new Map() };
  const rows = (await tx.execute(sql`
    SELECT COALESCE(i.branch_id, u.branch_id)::text AS k, ${bookedFigureColumns("f")}
      FROM ${entryFrom(scope.tenantId, await rejectionMode(tx))}
     WHERE ${entryWhere(scope, period)}
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;
  return { hasData: true, byBranch: new Map(rows.map((r) => [(r.k as string | null) ?? null, readBookedFigures(r, "f").net])) };
}

/** Booked gross / redemption / net by month for the money-movement chart, oldest first. */
export async function getBookedMonthlyFlows(
  tx: Tx, scope: MetricScope, period: MetricPeriod,
): Promise<Array<{ month: string; gross: number; redemption: number; net: number }>> {
  const rows = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', bel.eff_date), 'YYYY-MM') AS month, ${bookedFigureColumns("f")}
      FROM ${entryFrom(scope.tenantId, await rejectionMode(tx))}
     WHERE ${entryWhere(scope, period)}
     GROUP BY 1 ORDER BY 1
  `)).rows as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const f = readBookedFigures(r, "f");
    return { month: String(r.month), gross: f.gross, redemption: f.redemption, net: f.net };
  });
}
