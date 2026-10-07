/**
 * Booked business vs the RTA — load, decide (rta-match-core.ts), save.
 *
 * Runs after every RTA import (workers/rta-import-worker.ts) and nightly
 * (workers/daily-ops-scanner.ts), and by hand (scripts/match-business-rta.ts).
 * It only re-decides lines that are still open — pending, not found, or
 * rejected within the search window (a payment retried the next day can still
 * turn a rejection into business) — so a settled line stays settled and a
 * second run changes nothing. Editing an entry replaces its lines, which
 * starts them over as pending; an entry moved back to draft or cancelled
 * lets go of its RTA records so another booking can claim them.
 *
 * What the outcome is FOR (lib/metrics/entries.ts): targets count booked
 * business, a rejected line subtracted on its rejection date (or dropped from
 * its booking date — the firm's choice); incentives count only what the RTA
 * processed.
 */

import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { getLedgerCoverage } from "@/lib/metrics/business";
import { indiaToday } from "@/lib/dashboards/system/period";
import {
  addDays, SEARCH_DAYS, settleLines,
  type MatchBounce, type MatchLine, type MatchTxn, type RtaLineStatus,
} from "./rta-match-core";

export type MatchSummary = { checked: number } & Record<RtaLineStatus, number>;

const idsJson = (ids: string[]) => JSON.stringify(ids);

export async function matchBookedBusiness(
  tx: Tx,
  tenantId: string,
  opts: { today?: string } = {},
): Promise<MatchSummary> {
  const today = opts.today ?? indiaToday();
  const summary: MatchSummary = {
    checked: 0, pending: 0, confirmed: 0, mismatch: 0, rejected: 0, not_found: 0, not_applicable: 0,
  };
  const thresholds = await loadDashboardThresholds(tx);

  // An entry that no longer counts lets go of the RTA records it held.
  await tx.execute(sql`
    DELETE FROM business_entry_rta_matches m
     USING business_entry_lines l, business_entries e
     WHERE m.tenant_id = ${tenantId}::uuid AND l.id = m.line_id AND e.id = l.entry_id
       AND e.status NOT IN ('confirmed', 'emailed')
  `);

  // The open lines of counted entries.
  const open = (await tx.execute(sql`
    SELECT l.id, e.investor_id, e.product_type,
           to_char(e.business_date, 'YYYY-MM-DD') AS business_date,
           l.txn_type, l.scheme_name, l.from_scheme_name,
           COALESCE(l.folio_no, e.folio_no) AS folio_no, l.amount
      FROM business_entry_lines l
      JOIN business_entries e ON e.id = l.entry_id
     WHERE l.tenant_id = ${tenantId}::uuid AND e.tenant_id = ${tenantId}::uuid
       AND e.status IN ('confirmed', 'emailed')
       AND (l.rta_status IN ('pending', 'not_found')
            OR (l.rta_status = 'rejected' AND e.business_date >= ${addDays(today, -SEARCH_DAYS)}::date))
  `)).rows as Array<{
    id: string; investor_id: string | null; product_type: string; business_date: string;
    txn_type: string; scheme_name: string; from_scheme_name: string | null; folio_no: string | null; amount: string | null;
  }>;
  if (!open.length) return summary;

  const lines: MatchLine[] = open.map((r) => ({
    id: r.id,
    investorId: r.investor_id,
    productType: r.product_type,
    businessDate: r.business_date,
    txnType: r.txn_type,
    schemeName: r.scheme_name,
    fromSchemeName: r.from_scheme_name,
    folioNo: r.folio_no,
    amount: Number(r.amount ?? 0),
  }));

  // Their current links are decided again with them.
  await tx.execute(sql`
    DELETE FROM business_entry_rta_matches
     WHERE tenant_id = ${tenantId}::uuid
       AND line_id IN (SELECT jsonb_array_elements_text(${idsJson(lines.map((l) => l.id))}::jsonb)::uuid)
  `);

  // What the RTA has for those clients around those dates, not settling another line.
  const investorIds = [...new Set(lines.map((l) => l.investorId).filter((x): x is string => !!x))];
  const dates = lines.map((l) => l.businessDate).sort();
  const from = addDays(dates[0], -1);
  const to = addDays(dates[dates.length - 1], SEARCH_DAYS);
  let txns: MatchTxn[] = [];
  let bounces: MatchBounce[] = [];
  if (investorIds.length) {
    const clients = idsJson(investorIds);
    txns = ((await tx.execute(sql`
      SELECT t.id, t.investor_id, t.type, t.status, to_char(t.order_date, 'YYYY-MM-DD') AS order_date,
             t.amount, t.scheme_name, t.folio_number, t.reason_description
        FROM transactions t
       WHERE t.tenant_id = ${tenantId}::uuid
         AND t.investor_id IN (SELECT jsonb_array_elements_text(${clients}::jsonb)::uuid)
         AND t.order_date >= ${from}::date AND t.order_date <= ${to}::date
         AND NOT EXISTS (SELECT 1 FROM business_entry_rta_matches m WHERE m.transaction_id = t.id)
    `)).rows as Array<Record<string, string | null>>).map((r) => ({
      id: r.id!,
      investorId: r.investor_id!,
      type: r.type!,
      status: r.status!,
      orderDate: r.order_date!,
      amount: r.amount == null ? null : Number(r.amount),
      schemeName: r.scheme_name,
      folioNumber: r.folio_number,
      reason: r.reason_description,
    }));
    bounces = ((await tx.execute(sql`
      SELECT investor_id, scheme_name, folio_number,
             to_char(rejection_date, 'YYYY-MM-DD') AS rejection_date, rejection_amount, rejection_reason
        FROM sip_rejections
       WHERE tenant_id = ${tenantId}::uuid
         AND investor_id IN (SELECT jsonb_array_elements_text(${clients}::jsonb)::uuid)
         AND rejection_date >= ${from}::date AND rejection_date <= ${to}::date
    `)).rows as Array<Record<string, string | null>>).map((r) => ({
      investorId: r.investor_id!,
      schemeName: r.scheme_name,
      folioNumber: r.folio_number,
      rejectionDate: r.rejection_date!,
      amount: Number(r.rejection_amount ?? 0),
      reason: r.rejection_reason,
    }));
  }

  const coverage = await getLedgerCoverage(tx, tenantId);
  const outcomes = settleLines(lines, txns, bounces, {
    today,
    ledgerLast: coverage.last,
    notFoundDays: thresholds.rtaNotFoundDays,
    sipNotFoundDays: thresholds.rtaSipNotFoundDays,
  });

  await tx.execute(sql`
    UPDATE business_entry_lines l
       SET rta_status = v.status, rta_status_at = v.status_at, rta_amount = v.rta_amount,
           rta_note = v.note, rta_checked_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(outcomes.map((o) => ({
        id: o.lineId, status: o.status, status_at: o.statusAt, rta_amount: o.rtaAmount, note: o.note,
      })))}::jsonb) AS v(id uuid, status text, status_at date, rta_amount numeric, note text)
     WHERE l.id = v.id AND l.tenant_id = ${tenantId}::uuid
  `);
  const links = outcomes.flatMap((o) => o.txnIds.map((t) => ({ line_id: o.lineId, transaction_id: t })));
  if (links.length) {
    await tx.execute(sql`
      INSERT INTO business_entry_rta_matches (tenant_id, line_id, transaction_id)
      SELECT ${tenantId}::uuid, v.line_id, v.transaction_id
        FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS v(line_id uuid, transaction_id uuid)
      ON CONFLICT (transaction_id) DO NOTHING
    `);
  }

  summary.checked = outcomes.length;
  for (const o of outcomes) summary[o.status] += 1;
  return summary;
}

/** After an RTA import. Best effort: a failure here never fails the import. */
export async function matchBookedBusinessAfterImport(tenantId: string | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    await withTenant(tenantId, (tx) => matchBookedBusiness(tx, tenantId));
  } catch (e) {
    console.error("[rta-match] matching booked business after import failed", tenantId, (e as Error)?.message);
  }
}
