/**
 * Where every client, rupee of AUM and rupee of SIP went after an import (2026-11-25, Urmi Financial Services:
 * the registrar's own figures were AUM ₹242.94 Cr, SIP book ₹73.06 L over 1,796 SIPs, 2,344 clients; the CRM's
 * dashboard read ₹182.33 Cr, ₹62.82 L and "1,022 clients").
 *
 * The three screens answer different questions, and nothing told the firm so:
 *  - "Clients" on the Owner Dashboard is clients HOLDING MONEY (AUM above zero). The registrar's "total
 *    clients" counts every investor it has ever had a folio for, including those who redeemed everything.
 *  - Headline AUM and the SIP book count LIVE clients only (not closed / exited, not in the Trash, not merged).
 *    A record that is left out takes its money and its SIPs with it.
 *  - AUM is the CRM's own valuation (units × the latest NAV) of the folios imported; the registrar's figure is
 *    as on the day of its file. A folio with no value, or a holdings file never imported, is simply absent.
 *
 * This reads the book once and splits it by record state, so the owner can see exactly which of those it is.
 * It only explains — it changes nothing.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { sipMonthlySql } from "./sip";

export type StateRow = { clients: number; aum: number; sip: number };

export type BookBreakdown = {
  /** Live clients: what the dashboards count. */
  live: StateRow & { funded: number; unfunded: number };
  /** Records the dashboards leave out, and why. */
  closedOrExited: StateRow;
  inTrash: StateRow;
  mergedAway: StateRow;
  /** Folios of live clients. */
  folios: { total: number; valued: number; unvalued: number };
  /** SIP registrations by state (every client), and the amount a month of the active ones. */
  sips: { active: number; activeAmount: number; activeOfLeftOut: number; activeOfLeftOutAmount: number; ended: number };
  /** Live clients that share a PAN with another record, or have none (a likely duplicate / placeholder). */
  duplicates: { noPan: number; sharedPan: number };
  /** The newest SIP register imported per registrar: rows read, placed in the book, skipped, and the first reason. */
  registers: Array<{
    source: string; fileName: string | null; importedAt: string | null;
    total: number; imported: number; skipped: number; failed: number; leftOut: number; firstReason: string | null;
  }>;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function loadBookBreakdown(tx: Tx, tenantId: string): Promise<BookBreakdown> {
  const t = sql`${tenantId}::uuid`;
  const byState = (await tx.execute(sql`
    WITH inv AS (
      SELECT i.id, COALESCE(i.aum, 0)::numeric AS aum,
             CASE WHEN i.merged_into_id IS NOT NULL THEN 'merged'
                  WHEN i.deleted_at IS NOT NULL THEN 'trash'
                  WHEN i.status IN ('closed', 'exited') THEN 'closed'
                  ELSE 'live' END AS state
        FROM investors i WHERE i.tenant_id = ${t}
    ),
    sip AS (
      SELECT s.investor_id, sum(${sipMonthlySql("s")}) AS amt, count(*)::int AS n
        FROM sips s WHERE s.tenant_id = ${t} AND s.status = 'active' GROUP BY s.investor_id
    )
    SELECT inv.state, count(*)::int AS clients, COALESCE(sum(inv.aum), 0) AS aum,
           count(*) FILTER (WHERE inv.aum > 0)::int AS funded,
           COALESCE(sum(sip.amt), 0) AS sip_amt, COALESCE(sum(sip.n), 0)::int AS sip_n
      FROM inv LEFT JOIN sip ON sip.investor_id = inv.id
     GROUP BY inv.state
  `)).rows as Array<{ state: string; clients: number; aum: string; funded: number; sip_amt: string; sip_n: number }>;
  const get = (s: string) => byState.find((r) => r.state === s);
  const row = (s: string): StateRow => ({ clients: num(get(s)?.clients), aum: num(get(s)?.aum), sip: num(get(s)?.sip_amt) });

  const liveRow = get("live");
  const live = { ...row("live"), funded: num(liveRow?.funded), unfunded: num(liveRow?.clients) - num(liveRow?.funded) };

  const f = (await tx.execute(sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE COALESCE(f.aum, 0) > 0)::int AS valued
      FROM folios f JOIN investors i ON i.id = f.investor_id
     WHERE f.tenant_id = ${t} AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status NOT IN ('closed', 'exited')
  `)).rows[0] as { total: number; valued: number } | undefined;

  const sipState = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE s.status = 'active')::int AS active,
           COALESCE(sum(${sipMonthlySql("s")}) FILTER (WHERE s.status = 'active'), 0)::numeric AS active_amt,
           count(*) FILTER (WHERE s.status = 'active' AND (i.deleted_at IS NOT NULL OR i.merged_into_id IS NOT NULL OR i.status IN ('closed', 'exited')))::int AS left_out,
           COALESCE(sum(${sipMonthlySql("s")}) FILTER (WHERE s.status = 'active' AND (i.deleted_at IS NOT NULL OR i.merged_into_id IS NOT NULL OR i.status IN ('closed', 'exited'))), 0)::numeric AS left_out_amt,
           count(*) FILTER (WHERE s.status <> 'active')::int AS ended
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${t}
  `)).rows[0] as Record<string, unknown> | undefined;

  const d = (await tx.execute(sql`
    SELECT count(*) FILTER (WHERE i.pan IS NULL OR i.pan = '' OR i.rta_nopan_key IS NOT NULL)::int AS no_pan,
           count(*) FILTER (WHERE i.pan IS NOT NULL AND i.pan <> '' AND i.rta_nopan_key IS NULL AND EXISTS (
             SELECT 1 FROM investors o WHERE o.tenant_id = i.tenant_id AND o.pan = i.pan AND o.id <> i.id
               AND o.deleted_at IS NULL AND o.merged_into_id IS NULL))::int AS shared_pan
      FROM investors i
     WHERE i.tenant_id = ${t} AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status NOT IN ('closed', 'exited')
  `)).rows[0] as { no_pan: number; shared_pan: number } | undefined;

  const regs = (await tx.execute(sql`
    SELECT DISTINCT ON (f.source) f.source, f.file_name, f.created_at::text AS at,
           COALESCE(f.rows_total, 0) AS total, COALESCE(f.rows_imported, 0) AS imported,
           COALESCE(f.rows_skipped, 0) AS skipped, COALESCE(f.rows_failed, 0) AS failed,
           (SELECT e->>'reason' FROM jsonb_array_elements(COALESCE(f.errors, '[]'::jsonb)) e
             WHERE (e->>'row')::int > 0 LIMIT 1) AS reason
      FROM rta_file_imports f
     WHERE f.tenant_id = ${t} AND f.deleted_at IS NULL AND f.kind = 'monthly_sip_book' AND f.status IN ('completed', 'partial')
     ORDER BY f.source, f.created_at DESC
  `)).rows as Array<Record<string, unknown>>;
  const registers = regs.map((g) => {
    const total = num(g.total), imported = num(g.imported), skipped = num(g.skipped), failed = num(g.failed);
    return {
      source: String(g.source), fileName: (g.file_name as string) ?? null, importedAt: (g.at as string) ?? null,
      total, imported, skipped, failed, leftOut: Math.max(0, total - imported - skipped - failed),
      firstReason: (g.reason as string) ?? null,
    };
  });

  return {
    registers,
    live,
    closedOrExited: row("closed"),
    inTrash: row("trash"),
    mergedAway: row("merged"),
    folios: { total: num(f?.total), valued: num(f?.valued), unvalued: num(f?.total) - num(f?.valued) },
    sips: {
      active: num(sipState?.active),
      activeAmount: num(sipState?.active_amt),
      activeOfLeftOut: num(sipState?.left_out),
      activeOfLeftOutAmount: num(sipState?.left_out_amt),
      ended: num(sipState?.ended),
    },
    duplicates: { noPan: num(d?.no_pan), sharedPan: num(d?.shared_pan) },
  };
}

function inr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
const n0 = (n: number) => n.toLocaleString("en-IN");

/** Plain-language reasons, most important first. Pure, so it is tested without a database. */
export function bookBreakdownNotes(b: BookBreakdown): string[] {
  const notes: string[] = [];
  const left = b.closedOrExited.clients + b.inTrash.clients + b.mergedAway.clients;
  const leftAum = b.closedOrExited.aum + b.inTrash.aum + b.mergedAway.aum;
  if (b.live.unfunded > 0) {
    notes.push(
      `${n0(b.live.funded)} clients hold money today; ${n0(b.live.unfunded)} more have a record but no balance (redeemed in full, or no holdings file imported for them). The Owner Dashboard's "Clients" figure is the first number; the registrar's "total clients" usually counts both.`
    );
  }
  if (b.closedOrExited.aum > 0 || b.inTrash.aum > 0 || b.mergedAway.aum > 0) {
    const parts = [
      b.closedOrExited.aum > 0 ? `${n0(b.closedOrExited.clients)} closed / exited (${inr(b.closedOrExited.aum)})` : "",
      b.inTrash.aum > 0 ? `${n0(b.inTrash.clients)} in the Trash (${inr(b.inTrash.aum)})` : "",
      b.mergedAway.aum > 0 ? `${n0(b.mergedAway.clients)} merged away (${inr(b.mergedAway.aum)})` : "",
    ].filter(Boolean);
    notes.push(`${inr(leftAum)} of AUM sits on records the dashboards leave out: ${parts.join(", ")}. Reopen or restore a client who still holds money and it is counted again.`);
  } else if (left > 0) {
    notes.push(`${n0(left)} records are closed, exited, in the Trash or merged away; none holds AUM.`);
  }
  if (b.folios.unvalued > 0) {
    notes.push(
      `${n0(b.folios.unvalued)} of ${n0(b.folios.total)} folios have no value. A folio gets one from a holdings / AUM file (CAMS WBR22, KFintech MFSD203 / 201) or from units × NAV in the transaction feed — import the latest holdings file, or check that the transaction history is complete.`
    );
  }
  if (b.sips.activeOfLeftOut > 0) {
    notes.push(`${n0(b.sips.activeOfLeftOut)} active SIPs (${inr(b.sips.activeOfLeftOutAmount)} a month) belong to closed / exited / trashed / merged clients and are kept out of the SIP book.`);
  }
  if (b.sips.ended > 0) {
    notes.push(`${n0(b.sips.ended)} SIP registrations are stopped, completed or rejected, and are not in the book. The registrar's SIP count may include some of them.`);
  }
  for (const g of b.registers) {
    const who = g.source === "cams" ? "CAMS" : g.source === "kfintech" ? "KFintech" : g.source;
    if (g.skipped > 0) {
      notes.push(
        `The latest ${who} SIP register read ${n0(g.total)} rows; ${n0(g.skipped)} could not be placed in the book${g.firstReason ? ` — e.g. "${g.firstReason}"` : ""}. A row is filed when its PAN names a client, even before its folio is imported; the rest need the folio master (CAMS WBR9 / WBR4, KFintech MFSD211) — import it, then Re-import the register.`
      );
    }
  }
  if (b.registers.length === 0) {
    notes.push("No SIP register (CAMS WBR49, KFintech MFSD243) has been imported, so no SIPs are in the book at all.");
  }
  if (b.duplicates.noPan > 0 || b.duplicates.sharedPan > 0) {
    const bits = [
      b.duplicates.noPan > 0 ? `${n0(b.duplicates.noPan)} live records have no PAN (a folio the registrar sent without one)` : "",
      b.duplicates.sharedPan > 0 ? `${n0(b.duplicates.sharedPan)} share a PAN with another record` : "",
    ].filter(Boolean);
    notes.push(`${bits.join("; ")}. These are the usual cause of more client records than the registrar's client count — see Merge Clients.`);
  }
  return notes;
}
