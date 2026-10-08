/**
 * Booked business on a book — the money-moved figures of the Relationship
 * Manager and Branch Head dashboards. SERVER-ONLY.
 *
 * Gross, redemption, net business and SIP added / stopped / net SIP come from
 * Business Entries, every product, as booked (lib/metrics/entries.ts — the
 * firm's decision of 2026-10-07). They used to read the RTA ledger and the SIP
 * register; only the balances (AUM, SIP book) and SIP rejections still do.
 *
 * An entry is on a book by the same rule as everywhere else entries are
 * counted: the CLIENT's RM and branch when the entry names a client, and
 * otherwise the RM who booked it and that RM's branch. A client filter can only
 * match an entry that names a client. So the RM dashboard, the Branch Head
 * dashboard's RM rows and the Owner Dashboard's team table add up the same way.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  bookedEntriesFrom, bookedEntriesWhere, bookedFigureColumns, hasBookedBusiness, readBookedFigures,
  type BookedFigures,
} from "@/lib/metrics/entries";
import { clientRecordsWhereOn, hasClientFilter, type BookScope } from "./window";

export type { BookedFigures } from "@/lib/metrics/entries";

export type DateWindow = { from: string; to: string };

/** An entry on the book, over `be` / `i` (client) / `u` (booking RM). */
export function entryInBook(scope: BookScope): SQL {
  const rm = sql`COALESCE(i.rm_id, be.rm_id)`;
  const owner = scope.kind === "rm"
    ? sql`${rm} = ${scope.userId}::uuid`
    : scope.rmId
      ? sql`COALESCE(i.branch_id, u.branch_id) = ${scope.branchId}::uuid AND ${rm} = ${scope.rmId}::uuid`
      : sql`COALESCE(i.branch_id, u.branch_id) = ${scope.branchId}::uuid`;
  if (!hasClientFilter(scope)) return sql`(${owner})`;
  // The filters describe clients, so only an entry on a client in the
  // filtered book can match.
  return sql`(${owner} AND be.investor_id IN (SELECT ir.id FROM investors ir WHERE ${clientRecordsWhereOn("ir", scope)}))`;
}

/** The firm in this transaction — the loaders take a book, not a tenant. */
async function tenantOf(tx: Tx): Promise<string | null> {
  const r = (await tx.execute(sql`SELECT nullif(current_setting('app.tenant_id', true), '') AS t`)).rows[0] as
    | { t: string | null }
    | undefined;
  return r?.t ?? null;
}

/**
 * The signed booked lines on the book, for a loader that needs its own columns
 * or grouping: `SELECT … FROM ${s.from} WHERE ${s.where} AND bel.eff_date …`
 * over `be` / `bel` (signed: amount × sign, dated eff_date) / `i` / `u`.
 * Null when the firm has never confirmed an entry.
 */
export async function bookedLinesOnBook(tx: Tx, scope: BookScope): Promise<{ from: SQL; where: SQL } | null> {
  const tenantId = await tenantOf(tx);
  if (!tenantId || !(await hasBookedBusiness(tx, tenantId))) return null;
  return {
    from: await bookedEntriesFrom(tx, tenantId),
    where: sql`${bookedEntriesWhere(tenantId)} AND ${entryInBook(scope)}`,
  };
}

const ZERO: BookedFigures = {
  gross: 0, redemption: 0, net: 0, newSip: 0, stoppedSip: 0, netSip: 0,
  newSipCount: 0, stoppedSipCount: 0, redeemingClients: 0,
};

/**
 * Booked figures on the book for several date windows in one pass —
 * `{ cur: {from, to}, prev: {...}, fy: {...} }` → the same keys, figured.
 * `ever` is false when the firm has never confirmed an entry: every figure is
 * then unknown ("—"), not ₹0.
 */
export async function loadBookedFlows<K extends string>(
  tx: Tx, scope: BookScope, windows: Record<K, DateWindow>,
): Promise<{ ever: boolean; flows: Record<K, BookedFigures> }> {
  const keys = Object.keys(windows) as K[];
  const blank = Object.fromEntries(keys.map((k) => [k, { ...ZERO }])) as Record<K, BookedFigures>;
  const src = keys.length ? await bookedLinesOnBook(tx, scope) : null;
  if (!src) return { ever: false, flows: blank };

  const prefix = (i: number) => `w${i}`;
  const cols = keys.map((k, i) =>
    bookedFigureColumns(prefix(i), sql`bel.eff_date >= ${windows[k].from}::date AND bel.eff_date <= ${windows[k].to}::date`),
  );
  const lo = keys.map((k) => windows[k].from).sort()[0];
  const hi = keys.map((k) => windows[k].to).sort().reverse()[0];
  const row = (await tx.execute(sql`
    SELECT ${sql.join(cols, sql`, `)}
      FROM ${src.from}
     WHERE ${src.where} AND bel.eff_date >= ${lo}::date AND bel.eff_date <= ${hi}::date
  `)).rows[0] as Record<string, unknown> | undefined;
  const flows = Object.fromEntries(keys.map((k, i) => [k, readBookedFigures(row, prefix(i))])) as Record<K, BookedFigures>;
  return { ever: true, flows };
}

/** Booked figures on the book by calendar month ('YYYY-MM'), between two dates. */
export async function loadBookedByMonth(
  tx: Tx, scope: BookScope, from: string, to: string,
): Promise<{ ever: boolean; months: Map<string, BookedFigures> }> {
  const src = await bookedLinesOnBook(tx, scope);
  if (!src) return { ever: false, months: new Map() };
  const rows = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', bel.eff_date), 'YYYY-MM') AS month, ${bookedFigureColumns("f")}
      FROM ${src.from}
     WHERE ${src.where} AND bel.eff_date >= ${from}::date AND bel.eff_date <= ${to}::date
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;
  return { ever: true, months: new Map(rows.map((r) => [String(r.month), readBookedFigures(r, "f")])) };
}

/**
 * Booked figures on the book per RM — the client's RM, else the RM who booked
 * it (null: a client with no RM, booked by nobody named).
 */
export async function loadBookedByRm(
  tx: Tx, scope: BookScope, from: string, to: string,
): Promise<{ ever: boolean; byRm: Map<string | null, BookedFigures> }> {
  const src = await bookedLinesOnBook(tx, scope);
  if (!src) return { ever: false, byRm: new Map() };
  const rows = (await tx.execute(sql`
    SELECT COALESCE(i.rm_id, be.rm_id)::text AS rm, ${bookedFigureColumns("f")}
      FROM ${src.from}
     WHERE ${src.where} AND bel.eff_date >= ${from}::date AND bel.eff_date <= ${to}::date
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;
  return { ever: true, byRm: new Map(rows.map((r) => [(r.rm as string | null) ?? null, readBookedFigures(r, "f")])) };
}

/**
 * The Business Entries list on the same rows a booked figure counted, as far
 * as its filters reach: the period, counted entries only, and the book's one
 * person when it has one (the list filters by the RM who BOOKED an entry, so a
 * colleague's booking on one of my clients is in my figure but not this list).
 */
export function entriesHref(scope: BookScope, from: string, to: string): string {
  const person = scope.kind === "rm" ? scope.userId : scope.rmId ?? null;
  const qs = new URLSearchParams({ from, to, status: "confirmed,emailed" });
  if (person) qs.set("rm", person);
  return `/dashboard/business-entries?${qs.toString()}`;
}
