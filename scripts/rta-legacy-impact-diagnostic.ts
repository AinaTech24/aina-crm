/**
 * Did the legacy KFintech importer actually affect a firm's live records?
 * READ ONLY (B-1 final qualification, 2026-10-14). Prepared for an authorized
 * operator; it repairs nothing and writes nothing.
 *
 * The legacy importer kept one CRM row per registrar transaction number and
 * stored no source row, so the database alone shows EXPOSURE, not impact
 * (docs/rta/handover/b1-legacy-impact-exposure.sql). This script re-reads the
 * firm's stored KFintech MFSD201 files with the release's verified parser
 * (the same grouping validate-first uses) and compares every registrar
 * transaction with the CRM row on record:
 *
 *   confirmed_multi_lot_truncated   the file reports the transaction in several
 *                                   lots and the CRM amount is not their sum
 *   confirmed_correction_posted     an R-coded folio-correction group has a CRM
 *                                   row (a correction leg counted as business)
 *   confirmed_unrecognised_posted   a code no registrar document defines
 *                                   (LTOF, IPO, CNO / CNI …) has a CRM row
 *   potential_amount_differs        one row in the file, a different CRM amount
 *   consistent                      the CRM row equals the file
 *   not_in_crm                      in the file, no CRM row (held, or later file)
 *
 * Output: counts and sums per category and per file, plus at most three MASKED
 * examples (registrar number …1234, folio …12). Never a PAN, name or full folio.
 *
 *   npx tsx scripts/rta-legacy-impact-diagnostic.ts --tenant <uuid> --imports [--json out.json]
 *   npx tsx scripts/rta-legacy-impact-diagnostic.ts --tenant <uuid> --file <MFSD201 file> [--file …]
 *
 * --imports reads every completed KFintech transaction-feed import of the firm
 * from object storage (read access only). Runs as the restricted application
 * role (RLS on); every query is inside a READ ONLY transaction.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";

const argv = process.argv.slice(2);
const arg = (f: string) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1] ?? null; };
const TENANT = arg("--tenant");
const FILES = argv.flatMap((a, i) => (a === "--file" && argv[i + 1] ? [argv[i + 1]] : []));
const FROM_IMPORTS = argv.includes("--imports");
const JSON_OUT = arg("--json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Category = "confirmed_multi_lot_truncated" | "confirmed_correction_posted" | "confirmed_unrecognised_posted" | "potential_amount_differs" | "consistent" | "not_in_crm";
const CATEGORIES: Category[] = ["confirmed_multi_lot_truncated", "confirmed_correction_posted", "confirmed_unrecognised_posted", "potential_amount_differs", "consistent", "not_in_crm"];
const mask = (s: string | null | undefined, keep: number) => (s ? "…" + String(s).slice(-keep) : "—");
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  if (!TENANT || !UUID.test(TENANT) || (!FROM_IMPORTS && !FILES.length)) {
    console.error("usage: --tenant <uuid> (--imports | --file <path> …) [--json out.json]");
    process.exit(2);
  }
  const { withTenant } = await import("@/db/client");
  const { readLines, tableFrom } = await import("@/lib/rta/staging/source");
  const { identifyLayout, normalizeRows } = await import("@/lib/rta/staging/layouts");
  const { groupTransactions } = await import("@/lib/rta/staging/group");
  const { isKfinReversalCode } = await import("@/lib/rta/consolidation");

  // The files: given on the command line, or every completed KFintech feed import of the firm.
  const sources: Array<{ label: string; buf: Buffer }> = FILES.map((f, i) => ({ label: `file ${i + 1}`, buf: readFileSync(f) }));
  if (FROM_IMPORTS) {
    const { getObjectBytes } = await import("@/lib/storage/s3");
    const imports = await withTenant(TENANT, async (tx: any) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      return (await tx.execute(sql`
        SELECT id::text, file_key, created_at::date::text AS day FROM rta_file_imports
         WHERE tenant_id = ${TENANT}::uuid AND source = 'kfintech' AND kind = 'daily_transaction_feed'
           AND status = 'completed' AND file_key IS NOT NULL AND deleted_at IS NULL
         ORDER BY created_at`)).rows as Array<{ id: string; file_key: string; day: string }>;
    });
    for (const im of imports) {
      try { sources.push({ label: `import ${mask(im.id, 6)} (${im.day})`, buf: await getObjectBytes(im.file_key) }); }
      catch (e: any) { console.warn(`import ${mask(im.id, 6)}: stored file not readable (${String(e?.message ?? e).slice(0, 80)}) — skipped`); }
    }
  }

  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, { transactions: 0, sourceRows: 0, registrarAmount: 0, crmAmount: 0, examples: [] as string[] }])) as Record<Category, { transactions: number; sourceRows: number; registrarAmount: number; crmAmount: number; examples: string[] }>;
  const perFile: Array<{ source: string; layout: string | null; transactions: number; byCategory: Partial<Record<Category, number>> }> = [];
  const seen = new Set<string>(); // a transaction re-reported in a later file is counted once

  for (const src of sources) {
    const lines = readLines(src.buf, "");
    const found = identifyLayout(lines);
    if (!found || found.layout.id !== "kfintech.mfsd201") { perFile.push({ source: src.label, layout: found?.layout.id ?? null, transactions: 0, byCategory: {} }); continue; }
    const table = tableFrom(lines, found.headerIndex);
    const norm = normalizeRows(TENANT, found.layout, table.header, table.rows);
    const byRow = new Map(norm.map((n) => [n.rowNo, n]));
    const econ = groupTransactions(TENANT, norm, "kfintech").filter((e) => e.registrarTxnNo && e.amcCode && !seen.has(`${e.amcCode}:${e.registrarTxnNo}`));
    econ.forEach((e) => seen.add(`${e.amcCode}:${e.registrarTxnNo}`));
    const crm = new Map<string, { amount: number; source: string | null }>();
    const keys = econ.map((e) => `${e.amcCode}:${e.registrarTxnNo}`);
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      const rows = await withTenant(TENANT, async (tx: any) => {
        await tx.execute(sql`SET TRANSACTION READ ONLY`);
        return (await tx.execute(sql`
          SELECT amc_code || ':' || order_id AS k, abs(amount)::float8 AS amount, source_feed FROM transactions
           WHERE tenant_id = ${TENANT}::uuid AND amc_code || ':' || order_id IN (${sql.join(part.map((k) => sql`${k}`), sql`, `)})`)).rows as Array<{ k: string; amount: number; source_feed: string | null }>;
      });
      for (const r of rows) crm.set(r.k, { amount: Number(r.amount), source: r.source_feed });
    }
    const byCategory: Partial<Record<Category, number>> = {};
    for (const e of econ) {
      const rows = e.rowNos.map((n) => byRow.get(n)).filter(Boolean) as typeof norm;
      const codes = rows.map((r) => String((r.attrs as any)?.typeCode ?? ""));
      const registrar = rows.reduce((a, r) => a + Math.abs(r.amount?.num ?? 0), 0);
      const c = crm.get(`${e.amcCode}:${e.registrarTxnNo}`);
      let cat: Category;
      if (!c || c.source === "rta_validate_first") cat = c ? "consistent" : "not_in_crm";
      else if (codes.some((x) => isKfinReversalCode(x))) cat = "confirmed_correction_posted";
      else if (e.rtaClass === "unknown") cat = "confirmed_unrecognised_posted";
      else if (e.multiLot) cat = Math.abs(c.amount - Number(e.reportedAmount ?? registrar).valueOf()) > 0.01 ? "confirmed_multi_lot_truncated" : "consistent";
      else cat = Math.abs(c.amount - registrar) > 0.01 ? "potential_amount_differs" : "consistent";
      const t = totals[cat];
      t.transactions++; t.sourceRows += rows.length; t.registrarAmount += registrar; t.crmAmount += c?.amount ?? 0;
      if (t.examples.length < 3 && cat !== "consistent" && cat !== "not_in_crm") t.examples.push(`txn ${mask(e.registrarTxnNo, 4)} folio ${mask(e.folioNumber, 2)} codes ${[...new Set(codes)].join("/")} rows ${rows.length} registrar ₹${r2(registrar)} CRM ₹${r2(c?.amount ?? 0)}`);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    perFile.push({ source: src.label, layout: found.layout.id, transactions: econ.length, byCategory });
  }

  const out = {
    tenant: TENANT, at: new Date().toISOString(), filesRead: sources.length,
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, { ...totals[c], registrarAmount: r2(totals[c].registrarAmount), crmAmount: r2(totals[c].crmAmount) }])),
    perFile,
    note: "confirmed_* are proved by the stored registrar file against the CRM row; potential_* need a person to look. Nothing was changed.",
  };
  if (JSON_OUT) (await import("node:fs")).writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  for (const c of CATEGORIES) {
    const t = out.categories[c];
    console.log(`${c.padEnd(32)} ${String(t.transactions).padStart(6)} txns  ${String(t.sourceRows).padStart(6)} rows  registrar ₹${t.registrarAmount}  CRM ₹${t.crmAmount}`);
    for (const ex of t.examples) console.log(`    e.g. ${ex}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(String(e?.stack ?? e).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>").slice(0, 600)); process.exit(1); });
