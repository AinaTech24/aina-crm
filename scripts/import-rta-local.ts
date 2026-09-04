/**
 * Import an RTA file that is ON DISK, straight into a tenant — no S3 upload, no
 * BullMQ job, no `rta_file_imports` row required.
 *
 * The normal path (browser -> presigned S3 PUT -> queue -> worker) is the right
 * one for end users, but it is useless when you have the file locally and need
 * to know what it will actually do to a tenant's book. This runs the SAME engines
 * the worker runs — `importRtaFolios` for master/holdings, `processRtaFile` for
 * the feeds — so what you see here is what an upload would do.
 *
 * Defaults to a DRY RUN. Nothing is written unless you pass --commit.
 *
 *   npx tsx scripts/import-rta-local.ts --file <path> --tenant "VSN" [--password <zip pw>]
 *   npx tsx scripts/import-rta-local.ts --file <path> --tenant "VSN" --commit
 *
 * Options
 *   --file <path>       the .zip / .csv / .txt / .xls to import        (required)
 *   --tenant <q>        tenant UUID, or a substring of the firm name   (required)
 *   --password <pw>     ZIP password (repeatable; each is tried in turn).
 *                       RTA_ZIP_PASSWORDS=a,b works too and keeps them out of `ps`.
 *   --kind <kind>       force the feed kind (daily_transaction_feed, …).
 *                       Ignored for master/holdings files, which self-detect.
 *   --source <src>      cams | kfintech — inferred from the file when omitted
 *   --assign-rm <uuid>  set rm_id on clients this import creates
 *   --commit            actually write (otherwise dry run)
 *
 * Requires DATABASE_URL (and ALLOW_SYSTEM_TX=1 for the tenant lookup).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { decodeRtaToText } from "@/lib/rta/decode";
import { isSpreadsheet, readSpreadsheetToRows } from "@/lib/rta/xls";
import { parseRtaCsv, parseRtaRows } from "@/lib/rta";
import { importRtaFolios } from "@/lib/rta/import";
import { processRtaFile } from "@/lib/rta/process";
import { revalueAllFolios, recomputeCombinedAum } from "@/lib/finance/aum-persist";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";

// ── args ────────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function argAll(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const FILE = arg("file");
const TENANT_Q = arg("tenant");
const KIND = arg("kind") as RtaFileKind | undefined;
const SOURCE_ARG = arg("source") as RtaSource | undefined;
const ASSIGN_RM = arg("assign-rm") ?? null;
const COMMIT = process.argv.includes("--commit");
/**
 * ZIP passwords, from --password (repeatable) and/or RTA_ZIP_PASSWORDS
 * (comma-separated). Prefer the env var on a shared host: anything passed as an
 * argv is visible to every user in `ps`, and these open a firm's whole book.
 */
const PASSWORDS = [
  ...argAll("password"),
  ...(process.env.RTA_ZIP_PASSWORDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

async function main() {
  if (!FILE || !TENANT_Q) {
    console.error("Usage: npx tsx scripts/import-rta-local.ts --file <path> --tenant <uuid|name> [--password <pw>] [--kind <kind>] [--commit]");
    process.exit(1);
  }
  if (!fs.existsSync(FILE)) {
    console.error(`No such file: ${FILE}`);
    process.exit(1);
  }

  // ── 1. Resolve the tenant, and SHOW which one — importing a file into the
  //      wrong firm silently merges another book's clients by PAN, which is
  //      near-impossible to unpick afterwards. Refuse on an ambiguous match.
  const tenants = await withSystem(async (tx) => {
    const isUuid = /^[0-9a-f-]{36}$/i.test(TENANT_Q);
    const res = await tx.execute(
      isUuid
        ? sql`SELECT id, name, arn FROM tenants WHERE id = ${TENANT_Q}::uuid`
        : sql`SELECT id, name, arn FROM tenants WHERE name ILIKE ${"%" + TENANT_Q + "%"} ORDER BY created_at LIMIT 10`
    );
    return res.rows as Array<{ id: string; name: string; arn: string | null }>;
  });
  if (tenants.length === 0) {
    console.error(`No tenant matched "${TENANT_Q}".`);
    process.exit(1);
  }
  if (tenants.length > 1) {
    console.error(`"${TENANT_Q}" matched ${tenants.length} tenants — re-run with the exact id:`);
    for (const t of tenants) console.error(`   ${t.id}  ${t.name}  ${t.arn ?? "(no ARN)"}`);
    process.exit(1);
  }
  const tenant = tenants[0];

  console.log(`file    : ${path.basename(FILE)} (${fs.statSync(FILE).size.toLocaleString()} bytes)`);
  console.log(`tenant  : ${tenant.name}  [${tenant.id}]  ARN ${tenant.arn ?? "(none)"}`);
  console.log(`mode    : ${COMMIT ? "COMMIT — this WILL write" : "dry run (pass --commit to write)"}`);
  console.log("");

  // ── 2. Unzip (if needed) + decode to text, exactly as the worker does.
  let buf = fs.readFileSync(FILE);
  let innerName = path.basename(FILE);
  if (buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b) {
    let opened = false;
    for (const pw of PASSWORDS.length ? PASSWORDS : [undefined]) {
      try {
        const r = await extractRtaFileFromZip(new Uint8Array(buf), pw);
        buf = Buffer.from(r.data);
        innerName = r.filename;
        opened = true;
        console.log(`unzipped: ${innerName} (${buf.length.toLocaleString()} bytes)${pw ? "" : " [no password]"}`);
        break;
      } catch {
        /* try the next password */
      }
    }
    if (!opened) {
      console.error("Could not open the archive with the password(s) given. Pass --password <pw>.");
      process.exit(1);
    }
  }

  // ── 3. Master / holdings files self-identify by header signature. Try that
  //      first; only fall back to the feed engine when nothing matches, so a
  //      mis-picked --kind can't send a master through the transaction parser.
  const bytes = new Uint8Array(buf);
  const parsed = isSpreadsheet(bytes, innerName)
    ? parseRtaRows(readSpreadsheetToRows(bytes))
    : parseRtaCsv(new TextDecoder("latin1").decode(bytes));

  if (parsed.source !== "unknown" && parsed.folios.length > 0) {
    const kind = parsed.kind === "holdings" ? "holdings" : parsed.kind === "full" ? "full" : "master";
    const feedAum = parsed.folios.reduce((a, f) => a + (f.aum ?? 0), 0);
    console.log(`detected: ${parsed.source} ${parsed.reportType} · ${parsed.kind}`);
    console.log(`rows    : ${parsed.totalRows} · folios ${parsed.folios.length} · no-PAN ${parsed.missingPan}`);
    console.log(`file AUM: ${inr(feedAum)}${kind === "master" ? "   (a master carries no valuation — expected ₹0)" : ""}`);
    for (const w of parsed.warnings.slice(0, 3)) console.log(`warning : ${w}`);
    console.log("");

    const summary = await withTenant(tenant.id, (tx) =>
      importRtaFolios(tx as any, tenant.id, parsed.folios, {
        dryRun: !COMMIT,
        assignRmId: ASSIGN_RM,
        reportType: parsed.reportType,
        kind,
      })
    );
    console.log("clients : " + `${summary.investors.created} new · ${summary.investors.updated} updated · ${summary.investors.minors} minors`);
    console.log("folios  : " + `${summary.folios.created} new · ${summary.folios.updated} updated · ${summary.folios.skippedNoPan} skipped (no identity)`);
    console.log("schemes : " + summary.schemes);
    console.log("AMCs    : " + summary.amcs.slice(0, 8).map((a) => `${a.name}(${a.folios})`).join(", "));

    if (COMMIT && kind !== "master") {
      console.log("\nrevaluing folios + rolling up investor AUM…");
      const val = await withTenant(tenant.id, async (tx) => {
        const f = await revalueAllFolios(tx);
        const a = await recomputeCombinedAum(tx);
        return { f, a };
      });
      console.log(`folios repriced: ${val.f.folios} · investors updated: ${val.a.updated} · firm AUM now ${inr(val.a.totalAum)}`);
    }
    console.log(COMMIT ? "\n✅ committed" : "\n(dry run — nothing written)");
    return;
  }

  // ── 4. Feed file. These do NOT self-identify, so --kind is required.
  if (!KIND) {
    console.error("This file isn't a master/holdings report, so it needs an explicit --kind.");
    console.error(`Header did not match a known master signature: ${parsed.warnings[0] ?? "(no detail)"}`);
    console.error("e.g. --kind daily_transaction_feed | sip_rejection_report | monthly_sip_book | monthly_aum_statement | monthly_brokerage");
    process.exit(1);
  }
  const source: RtaSource =
    SOURCE_ARG ?? (/mfsd|kfin|karvy/i.test(innerName) ? "kfintech" : "cams");
  console.log(`detected: feed file · source ${source} · kind ${KIND}`);

  if (!COMMIT) {
    console.error("\nThe feed engine has no dry-run mode — it writes as it parses.");
    console.error("Re-run with --commit once you're satisfied this is the right file and tenant.");
    process.exit(1);
  }

  const text = decodeRtaToText(buf, innerName);
  const outcome = await withTenant(tenant.id, (tx) =>
    processRtaFile(tx as any, { tenantId: tenant.id, source, kind: KIND, text })
  );
  console.log(`rows    : ${outcome.rowsTotal} total · ${outcome.rowsImported} imported · ${outcome.rowsSkipped} skipped · ${outcome.rowsFailed} failed`);
  console.log(`period  : ${outcome.periodStart} → ${outcome.periodEnd}`);
  for (const e of outcome.errors.slice(0, 10)) console.log(`  row ${e.row}: ${e.reason}`);
  if (outcome.errors.length > 10) console.log(`  … and ${outcome.errors.length - 10} more`);
  console.log("\n✅ committed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ failed:", e?.message ?? e);
    if (e?.cause) console.error("cause:", (e.cause as any)?.message ?? e.cause);
    process.exit(1);
  });
