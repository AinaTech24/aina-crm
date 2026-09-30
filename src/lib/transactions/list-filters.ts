/**
 * Shared MF-transactions filter builder.
 *
 * The transactions list page, its KPI cards, and the Excel export must apply the
 * EXACT same WHERE logic so the numbers, the rows, and the downloaded file all
 * agree. This module is the single source of truth for translating the URL
 * search params (?q / ?txtype / ?status / ?rm / ?amc / ?source / date range)
 * into Drizzle conditions. Tenant isolation is handled by RLS (withTenant).
 *
 * The conditions reference both `transactions` and `investors` columns, so every
 * caller must LEFT JOIN investors on transactions.investorId.
 */

import { inArray, sql } from "drizzle-orm";
import { transactions, investors } from "@/db/schema";
import { clientRecordWhere } from "@/lib/metrics/scope";

export type TxListParams = Record<string, string | undefined>;

const csv = (v: string | undefined) => (v ?? "").split(",").filter(Boolean);

/** Expand a UI type selection to cover both canonical and legacy enum values. */
export function expandTypeFilter(raw: string[]): string[] {
  const out: string[] = [];
  for (const t of raw) {
    if (t === "lumpsum" || t === "purchase") out.push("lumpsum", "purchase");
    else if (t === "dividend" || t === "dividend_payout" || t === "dividend_reinvest")
      out.push("dividend_payout", "dividend_reinvest");
    else out.push(t);
  }
  return out;
}

/** Expand a UI status selection to cover both canonical and legacy enum values. */
export function expandStatusFilter(raw: string[]): string[] {
  const out: string[] = [];
  for (const s of raw) {
    if (s === "pending" || s === "submitted") out.push("pending", "submitted");
    else if (s === "processed" || s === "successful") out.push("processed", "successful");
    else if (s === "rejected" || s === "failed") out.push("rejected", "failed");
    else out.push(s);
  }
  return out;
}

/**
 * Do these filters actually reference the `investors` table?
 *
 * Only two do: the free-text search (investors.name) and the RM filter
 * (investors.rm_id). Everything else is columns on `transactions` alone.
 *
 * This matters because the KPI aggregate on /dashboard/transactions selects
 * nothing from investors, yet LEFT JOINed it unconditionally. With an empty
 * filter — the default page load — that joined every transaction row to the
 * client table to compute five counts that never look at it. Once one firm's
 * since-inception feed landed (0 -> 508,124 rows) the query blew past the 30s
 * statement timeout, and because each attempt held a pool slot for 30s the
 * connection pool drained behind it: the page died with "canceling statement
 * due to statement timeout" and everything ELSE started failing with "timeout
 * exceeded when trying to connect".
 *
 * Keep this in step with buildTransactionConditions below.
 */
export function transactionFiltersNeedInvestors(_sp: TxListParams): boolean {
  // Always: every list and export applies transactionClientCondition, which
  // reads the client row.
  return true;
}

/**
 * The client side of a transaction list, shared by the page and the export:
 * the firm, a live client record (not in Trash, not merged away — the rule the
 * dashboard's Net business and money-movement figures are summed over,
 * lib/metrics clientRecordWhere) and the dashboard's client filters as its
 * links send them (rm, branch, segment, category, fam, tag, src). Only ever
 * narrows. Needs the investors table joined.
 */
export function transactionClientCondition(sp: TxListParams, tenantId: string) {
  return sql`(${clientRecordWhere({
    tenantId,
    rmIds: csv(sp.rm),
    branchIds: csv(sp.branch),
    segments: csv(sp.segment),
    categories: csv(sp.category),
    familyIds: csv(sp.fam),
    tags: csv(sp.tag),
    leadSources: csv(sp.src),
  }, "investors")})`;
}

/** Build the array of Drizzle conditions for the transactions list (no cursor). */
export function buildTransactionConditions(sp: TxListParams): any[] {
  const conds: any[] = [];
  const q = (sp.q ?? "").trim();
  const dateFrom = sp.date_from ?? "";
  const dateTo = sp.date_to ?? "";
  const rm = csv(sp.rm);
  const amc = csv(sp.amc);
  const source = csv(sp.source);

  if (q) {
    conds.push(
      sql`(${transactions.schemeName} ILIKE ${`%${q}%`} OR ${investors.name} ILIKE ${`%${q}%`} OR ${transactions.folioNumber} ILIKE ${`%${q}%`})`
    );
  }
  const typeFilter = expandTypeFilter(csv(sp.txtype));
  if (typeFilter.length) conds.push(inArray(transactions.type, typeFilter as any));
  const statusFilter = expandStatusFilter(csv(sp.status));
  if (statusFilter.length) conds.push(inArray(transactions.status, statusFilter as any));
  if (dateFrom) conds.push(sql`${transactions.orderDate} >= ${dateFrom}::date`);
  if (dateTo) conds.push(sql`${transactions.orderDate} <= ${dateTo}::date`);
  // RM = the client's owning RM (book slice), not the executor — that's what an
  // MFD wants when reviewing a team member's transaction flow.
  if (rm.length) conds.push(inArray(investors.rmId, rm as any));
  if (amc.length) conds.push(inArray(transactions.amcName, amc as any));
  if (source.length) conds.push(inArray(transactions.sourceFeed, source as any));
  return conds;
}
