/**
 * Booked business vs the RTA, as Operations' worklist — phase 2 of the firm's
 * decision of 2026-10-02 (CLAUDE.md "Booked business vs the RTA").
 * lib/business/rta-match.ts decides each line's outcome; this only reads it.
 *
 *   exceptions — mutual-fund lines of counted entries (confirmed / emailed),
 *     booked in the period, that the RTA rejected, never reported (not found)
 *     or processed for a different amount (mismatch);
 *   unbooked   — processed RTA purchases in the period that settle no booked
 *     line: business nobody booked (it still counts for the client's RM).
 *     Counted only from the firm's first counted entry — a firm that does not
 *     book business would otherwise see every purchase here. SIP instalments
 *     are left out: only a SIP's first debit settles a booking, so the rest
 *     are never "unbooked".
 *
 * Scoped like the other registers: clientScope(w) over the client. The
 * own-work view (self) gets null — these are clients' records, not tasks.
 */

import { sql } from "drizzle-orm";
import { clientScope, selfOnly, type OpsWindow } from "./window";

type Tx = any;
type Row = Record<string, unknown>;

export type BookedRtaRow = {
  lineId: string;
  entryId: string;
  investorId: string | null;
  client: string;
  rm: string | null;
  scheme: string;
  type: string;
  booked: number;
  rtaAmount: number | null;
  status: "rejected" | "not_found" | "mismatch";
  statusAt: string | null;
  note: string | null;
  businessDate: string;
};

export type UnbookedRow = {
  id: string;
  investorId: string;
  client: string;
  rm: string | null;
  scheme: string | null;
  type: string;
  amount: number | null;
  date: string | null;
};

export type BookedRtaDesk = {
  rejected: number;
  notFound: number;
  mismatch: number;
  /** Booked value of the lines in exception. */
  value: number;
  rows: BookedRtaRow[];
  more: number;
  /** Null when the firm has no counted entry yet (nothing to compare with). */
  unbooked: { count: number; value: number; rows: UnbookedRow[]; more: number; since: string } | null;
};

const PURCHASE_TYPES = ["purchase", "lumpsum", "additional_purchase"];
const PROCESSED = ["processed", "successful"];

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

export async function loadBookedVsRta(tx: Tx, w: OpsWindow, limit = 25): Promise<BookedRtaDesk | null> {
  if (selfOnly(w)) return null;
  const scope = clientScope(w);
  const lineWhere = sql`e.tenant_id = ${w.tenantId}::uuid
    AND e.status IN ('confirmed', 'emailed') AND e.product_type = 'mutual_fund'
    AND e.business_date BETWEEN ${w.from}::date AND ${w.to}::date
    AND l.rta_status IN ('rejected', 'not_found', 'mismatch')
    AND ${scope}`;

  const c = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE l.rta_status = 'rejected')::int AS rejected,
           COUNT(*) FILTER (WHERE l.rta_status = 'not_found')::int AS not_found,
           COUNT(*) FILTER (WHERE l.rta_status = 'mismatch')::int AS mismatch,
           COALESCE(SUM(l.amount::numeric), 0) AS v
      FROM business_entry_lines l
      JOIN business_entries e ON e.id = l.entry_id
      LEFT JOIN investors i ON i.id = e.investor_id
     WHERE ${lineWhere}
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT l.id, e.id AS entry_id, e.investor_id, COALESCE(i.name, e.client_name) AS client, u.name AS rm,
           l.scheme_name, l.txn_type, l.amount::numeric AS amount, l.rta_amount::numeric AS rta_amount,
           l.rta_status, l.rta_status_at::text AS status_at, l.rta_note, e.business_date::text AS business_date,
           COUNT(*) OVER () AS total
      FROM business_entry_lines l
      JOIN business_entries e ON e.id = l.entry_id
      LEFT JOIN investors i ON i.id = e.investor_id
      LEFT JOIN users u ON u.id = e.rm_id
     WHERE ${lineWhere}
     ORDER BY CASE l.rta_status WHEN 'rejected' THEN 0 WHEN 'not_found' THEN 1 ELSE 2 END,
              e.business_date DESC, l.amount DESC
     LIMIT ${limit}
  `)).rows as Row[];

  // Business nobody booked: only once the firm books business at all.
  const first = (await tx.execute(sql`
    SELECT MIN(business_date)::text AS d FROM business_entries
     WHERE tenant_id = ${w.tenantId}::uuid AND status IN ('confirmed', 'emailed') AND product_type = 'mutual_fund'
  `)).rows[0] as Row | undefined;
  const since = str(first?.d);
  let unbooked: BookedRtaDesk["unbooked"] = null;
  if (since) {
    const from = since > w.from ? since : w.from;
    const txWhere = sql`t.tenant_id = ${w.tenantId}::uuid
      AND t.status IN (${sql.join(PROCESSED.map((s) => sql`${s}`), sql`, `)})
      AND t.type IN (${sql.join(PURCHASE_TYPES.map((s) => sql`${s}`), sql`, `)})
      AND t.order_date BETWEEN ${from}::date AND ${w.to}::date
      AND NOT EXISTS (SELECT 1 FROM business_entry_rta_matches m WHERE m.transaction_id = t.id)
      AND ${scope}`;
    const uc = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(t.amount::numeric), 0) AS v
        FROM transactions t JOIN investors i ON i.id = t.investor_id WHERE ${txWhere}
    `)).rows[0] as Row | undefined;
    const ur = (await tx.execute(sql`
      SELECT t.id, t.investor_id, i.name AS client, u.name AS rm, t.scheme_name, t.type,
             t.amount::numeric AS amount, t.order_date::text AS date, COUNT(*) OVER () AS total
        FROM transactions t
        JOIN investors i ON i.id = t.investor_id
        LEFT JOIN users u ON u.id = i.rm_id
       WHERE ${txWhere}
       ORDER BY t.order_date DESC NULLS LAST, t.amount DESC NULLS LAST
       LIMIT ${limit}
    `)).rows as Row[];
    unbooked = {
      count: num(uc?.n),
      value: num(uc?.v),
      since,
      rows: ur.map((r) => ({
        id: String(r.id), investorId: String(r.investor_id), client: String(r.client ?? "-"), rm: str(r.rm),
        scheme: str(r.scheme_name), type: String(r.type), amount: numOrNull(r.amount), date: str(r.date),
      })),
      more: Math.max(0, (ur.length ? num(ur[0].total) : 0) - ur.length),
    };
  }

  return {
    rejected: num(c?.rejected),
    notFound: num(c?.not_found),
    mismatch: num(c?.mismatch),
    value: num(c?.v),
    rows: rows.map((r) => ({
      lineId: String(r.id), entryId: String(r.entry_id), investorId: str(r.investor_id), client: String(r.client ?? "-"),
      rm: str(r.rm), scheme: String(r.scheme_name ?? "-"), type: String(r.txn_type), booked: num(r.amount),
      rtaAmount: numOrNull(r.rta_amount), status: String(r.rta_status) as BookedRtaRow["status"],
      statusAt: str(r.status_at), note: str(r.rta_note), businessDate: String(r.business_date),
    })),
    more: Math.max(0, (rows.length ? num(rows[0].total) : 0) - rows.length),
    unbooked,
  };
}
