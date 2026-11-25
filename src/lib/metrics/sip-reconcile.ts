/**
 * Why the SIP book can differ from what the client says (2026-11-25, Akshar: ₹2.70 Cr against ₹3.30 Cr;
 * another firm read higher than the client's figure while AUM was right for both).
 *
 * AUM comes from the folio master / holdings and the transaction feed. The SIP BOOK comes from ONE
 * report only — the registrar's SIP registration report (CAMS WBR49 / R49, KFintech MFSD243 / 230 / 313)
 * — plus SIPs booked by hand. So a firm can import every AUM and transaction file and still have a stale
 * book: SIPs started since the last register are missing (book too LOW), SIPs stopped since are still
 * counted (book too HIGH), and a register refused for its ZIP password changes nothing at all.
 *
 * This compares the book with the registrar's own SIP DEBITS in the transaction feed, which the firm
 * does import, and says which register files arrived. Nothing here changes a SIP — it only explains.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aliveClient } from "./scope";

/** A file name that is a SIP registration report, whatever kind it was filed under. */
export const SIP_REGISTER_NAME_RE = /MFSD\s*(243|230|313)|WBR\s*49|R49\b|systematic[_ ]?registration|sip[_ ]?regist/i;
/** The same pattern for Postgres (its word boundary is \y; \b there is a backspace). */
const SIP_REGISTER_NAME_PG = "MFSD\\s*(243|230|313)|WBR\\s*49|R49\\y|systematic[_ ]?registration|sip[_ ]?regist";

export type RegisterStatus = {
  source: "cams" | "kfintech";
  lastImportedAt: string | null;
  lastPeriodEnd: string | null;
  /** SIP registers of this registrar refused (password) in the last 30 days. */
  refused: number;
};

export type SipReconciliation = {
  registers: RegisterStatus[];
  /** Monthly SIPs the registrar debited in the last 45 days. */
  debited: { sips: number; amount: number };
  /** Debited, but no active SIP in the book for that folio + scheme — the book is missing these. */
  debitedNotInBook: { sips: number; amount: number };
  /** Active monthly SIPs started 60+ days ago whose folio is in the feed, with no debit in 60 days. */
  inBookNotDebited: { sips: number; amount: number };
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Folio + scheme as one key: scheme compared by code, else by its name with punctuation removed. */
const schemeKey = (alias: string) =>
  sql.raw(`lower(regexp_replace(COALESCE(NULLIF(${alias}.scheme_name, ''), ${alias}.scheme_code, ''), '[^a-zA-Z0-9]', '', 'g'))`);

export async function loadSipReconciliation(tx: Tx, tenantId: string): Promise<SipReconciliation> {
  const regs = (await tx.execute(sql`
    SELECT s.source,
           (SELECT max(f.created_at)::text FROM rta_file_imports f
             WHERE f.tenant_id = ${tenantId}::uuid AND f.deleted_at IS NULL AND f.source = s.source
               AND f.kind = 'monthly_sip_book' AND f.status IN ('completed', 'partial')) AS last_at,
           (SELECT max(f.period_end)::text FROM rta_file_imports f
             WHERE f.tenant_id = ${tenantId}::uuid AND f.deleted_at IS NULL AND f.source = s.source
               AND f.kind = 'monthly_sip_book' AND f.status IN ('completed', 'partial')) AS last_period,
           (SELECT count(*)::int FROM rta_file_imports f
             WHERE f.tenant_id = ${tenantId}::uuid AND f.deleted_at IS NULL AND f.source = s.source
               AND f.status = 'rejected' AND f.created_at > now() - interval '30 days'
               AND (f.kind = 'monthly_sip_book' OR f.file_name ~* ${SIP_REGISTER_NAME_PG})) AS refused
      FROM (VALUES ('cams'), ('kfintech')) AS s(source)
  `)).rows as Array<{ source: "cams" | "kfintech"; last_at: string | null; last_period: string | null; refused: number }>;

  // The newest processed SIP instalment per folio + scheme in the last 45 days (one monthly cycle and a margin).
  const debits = sql`
    SELECT DISTINCT ON (t.folio_number, ${schemeKey("t")})
           t.folio_number, ${schemeKey("t")} AS skey, t.amount::numeric AS amount
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${tenantId}::uuid AND t.type = 'sip'
       AND t.status IN ('processed', 'successful')
       AND t.order_date >= current_date - 45
       AND t.folio_number IS NOT NULL AND COALESCE(t.amount, 0) > 0
       AND ${aliveClient("i")}
     ORDER BY t.folio_number, ${schemeKey("t")}, t.order_date DESC`;

  const r = (await tx.execute(sql`
    WITH d AS (${debits}),
    book AS (
      SELECT s.id, s.folio_number, ${schemeKey("s")} AS skey, s.amount::numeric AS amount, s.start_date
        FROM sips s JOIN investors i ON i.id = s.investor_id
       WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'active'
         AND COALESCE(s.frequency, 'monthly') = 'monthly' AND ${aliveClient("i")}
    )
    SELECT
      (SELECT count(*) FROM d)::int AS debited_n,
      (SELECT COALESCE(sum(amount), 0) FROM d) AS debited_amt,
      (SELECT count(*) FROM d WHERE NOT EXISTS (
         SELECT 1 FROM book b WHERE b.folio_number = d.folio_number AND b.skey = d.skey))::int AS missing_n,
      (SELECT COALESCE(sum(amount), 0) FROM d WHERE NOT EXISTS (
         SELECT 1 FROM book b WHERE b.folio_number = d.folio_number AND b.skey = d.skey)) AS missing_amt,
      (SELECT count(*) FROM book b
        WHERE COALESCE(b.start_date, current_date - 365) <= current_date - 60
          AND EXISTS (SELECT 1 FROM transactions x WHERE x.tenant_id = ${tenantId}::uuid AND x.folio_number = b.folio_number
                        AND x.order_date >= current_date - 60)
          AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.tenant_id = ${tenantId}::uuid AND x.type = 'sip'
                            AND x.folio_number = b.folio_number AND ${schemeKey("x")} = b.skey
                            AND x.status IN ('processed', 'successful') AND x.order_date >= current_date - 60))::int AS stale_n,
      (SELECT COALESCE(sum(b.amount), 0) FROM book b
        WHERE COALESCE(b.start_date, current_date - 365) <= current_date - 60
          AND EXISTS (SELECT 1 FROM transactions x WHERE x.tenant_id = ${tenantId}::uuid AND x.folio_number = b.folio_number
                        AND x.order_date >= current_date - 60)
          AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.tenant_id = ${tenantId}::uuid AND x.type = 'sip'
                            AND x.folio_number = b.folio_number AND ${schemeKey("x")} = b.skey
                            AND x.status IN ('processed', 'successful') AND x.order_date >= current_date - 60)) AS stale_amt
  `)).rows[0] as Record<string, unknown> | undefined;

  return {
    registers: regs.map((g) => ({ source: g.source, lastImportedAt: g.last_at, lastPeriodEnd: g.last_period, refused: num(g.refused) })),
    debited: { sips: num(r?.debited_n), amount: num(r?.debited_amt) },
    debitedNotInBook: { sips: num(r?.missing_n), amount: num(r?.missing_amt) },
    inBookNotDebited: { sips: num(r?.stale_n), amount: num(r?.stale_amt) },
  };
}

/** Plain-language reasons, most important first. Pure, so it is tested without a database. */
export function reconciliationNotes(rec: SipReconciliation, today: string): string[] {
  const notes: string[] = [];
  const label = (s: string) => (s === "cams" ? "CAMS" : "KFintech");
  const daysAgo = (iso: string) => Math.floor((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 86_400_000);
  for (const g of rec.registers) {
    if (g.refused > 0) {
      notes.push(`${g.refused} ${label(g.source)} SIP register file${g.refused === 1 ? " was" : "s were"} refused in the last 30 days (ZIP password) — the book did not take ${g.refused === 1 ? "it" : "them"} in. Open RTA File Imports and enter that file's password.`);
    }
    if (!g.lastImportedAt) {
      if (rec.debited.sips > 0) notes.push(`No ${label(g.source)} SIP register (${g.source === "cams" ? "WBR49 / R49" : "MFSD243"}) has ever been imported, so none of its SIPs are in the book. Folio and transaction files do not carry SIP registrations.`);
    } else if (daysAgo(g.lastImportedAt) > 35) {
      notes.push(`The last ${label(g.source)} SIP register was imported ${daysAgo(g.lastImportedAt)} days ago. SIPs started or stopped since then are not reflected — import a fresh one.`);
    }
  }
  if (rec.debitedNotInBook.sips > 0) {
    notes.push(`${rec.debitedNotInBook.sips} SIP${rec.debitedNotInBook.sips === 1 ? "" : "s"} debited in the last 45 days are not in the book — the book is low by about ${inr(rec.debitedNotInBook.amount)} a month until the register that lists them is imported.`);
  }
  if (rec.inBookNotDebited.sips > 0) {
    notes.push(`${rec.inBookNotDebited.sips} active SIP${rec.inBookNotDebited.sips === 1 ? "" : "s"} (${inr(rec.inBookNotDebited.amount)} a month) had no debit in 60 days although their folio is in the feed — likely stopped. A current register stops them.`);
  }
  return notes;
}

function inr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
