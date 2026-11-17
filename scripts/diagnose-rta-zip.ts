/**
 * Diagnose a ZIP the RTA importer refused — run it where the CRM's data is.
 *
 *   # a stored import (reads the file from storage and the firm's saved passwords):
 *   docker exec app-worker-1 npx tsx scripts/diagnose-rta-zip.ts --import <rta_file_imports id>
 *   # …and also test a password you believe is right (never stored, never printed):
 *   docker exec app-worker-1 npx tsx scripts/diagnose-rta-zip.ts --import <id> --try 'the password'
 *   # a file on disk, no database:
 *   npx tsx scripts/diagnose-rta-zip.ts --file ./report.zip --try 'the password'
 *
 * Prints facts about the archive and, for AES, whether any candidate passes its exact
 * password check and in which form. Passwords appear only as length + a short hash.
 */
import { readFileSync } from "node:fs";
import { diagnoseZip } from "../src/lib/rta/zip-diagnose";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === `--${name}` && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]); });
  return out;
}

async function main() {
  const importId = arg("import");
  const file = arg("file");
  const tried = args("try");
  let buf: Buffer;
  let candidates = [...tried];
  let label = file ?? "";

  if (file) {
    buf = readFileSync(file);
  } else if (importId) {
    process.env.ALLOW_SYSTEM_TX ||= "1";
    const { withSystem, withTenant } = await import("../src/db/client");
    const { sql } = await import("drizzle-orm");
    const { getObjectBytes } = await import("../src/lib/storage/s3");
    const { getMailbackPasswords, passwordsToTry } = await import("../src/lib/rta/mailback-config");
    const row = await withSystem(async (tx) => {
      const r = await tx.execute(sql`SELECT tenant_id, source, kind, status, file_name, file_key, remarks FROM rta_file_imports WHERE id = ${importId}::uuid`);
      return r.rows[0] as { tenant_id: string; source: string; kind: string; status: string; file_name: string; file_key: string | null; remarks: string | null } | undefined;
    });
    if (!row) throw new Error("no such import");
    if (!row.file_key) throw new Error("the file is no longer stored");
    label = `${row.file_name} (${row.source} ${row.kind}, ${row.status})`;
    console.log("import:", label);
    console.log("remark:", (row.remarks ?? "").slice(0, 300));
    buf = await getObjectBytes(row.file_key);
    const saved = await withTenant(row.tenant_id, async (tx) => passwordsToTry(await getMailbackPasswords(tx, row.tenant_id), row.source));
    console.log(`saved passwords for this firm: ${saved.length}`);
    candidates = [...candidates, ...saved];
  } else {
    console.error("usage: --import <id> | --file <path>   [--try <password> ...]");
    process.exit(2);
  }

  console.log(`candidates tested: ${candidates.length}${tried.length ? ` (${tried.length} typed now)` : ""}`);
  const r = await diagnoseZip(new Uint8Array(buf), candidates);
  console.log(JSON.stringify(r, null, 2));
  console.log("\nVERDICT:", r.verdict);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
