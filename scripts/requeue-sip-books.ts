/**
 * Re-queue SIP-book imports that landed with no amounts.
 *
 * The CAMS WBR49 register calls its instalment column AUTO_AMOUNT, which the
 * header aliases didn't know. Because resolveHeader returns only the columns it
 * matched — never merged with the positional fallback — the field stayed
 * undefined, every row parsed to 0, and the import reported success. One firm
 * ended up with 5,767 active SIPs worth Rs 0.
 *
 * The parser is fixed; this re-runs the SAME files already in S3 through the
 * SAME pipeline so the stored rows pick the amounts up. processSipBook upserts
 * on (folio, scheme), so re-running is idempotent — it updates in place rather
 * than duplicating.
 *
 * Unlike retry-failed-rta-imports.ts this also picks up `partial` and
 * `completed` rows, because a silently-zeroed import is recorded as a SUCCESS.
 * That is the whole reason it went unnoticed.
 *
 * Usage (inside the worker container):
 *   npx tsx scripts/requeue-sip-books.ts --tenant <uuid>            # dry run
 *   npx tsx scripts/requeue-sip-books.ts --tenant <uuid> --commit
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";
import { Q } from "@/workers/queues";

const COMMIT = process.argv.includes("--commit");
const TENANT = process.argv.includes("--tenant") ? process.argv[process.argv.indexOf("--tenant") + 1] : null;

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/requeue-sip-books.ts --tenant <uuid> [--commit]");
    process.exit(1);
  }
  console.log(COMMIT ? "MODE: COMMIT — jobs will be queued" : "MODE: DRY RUN");

  const rows = await withSystem(async (tx) =>
    (
      await tx.execute(sql`
        SELECT id, tenant_id, source, kind, status, file_key, file_name,
               rows_imported, created_at::text AS created_at
          FROM rta_file_imports
         WHERE tenant_id = ${TENANT}::uuid
           AND kind = 'monthly_sip_book'
           AND status IN ('completed', 'partial', 'failed')
           AND file_key IS NOT NULL
         ORDER BY created_at
      `)
    ).rows as Array<Record<string, any>>
  );

  if (!rows.length) {
    console.log("no SIP-book imports to re-queue");
    return;
  }

  // getMailbackPasswords reads the encrypted per-tenant row, so it needs a
  // tenant-scoped transaction — not the bare tenant id.
  const pw = await withTenant(TENANT, async (tx) => getMailbackPasswords(tx, TENANT));
  let queued = 0;

  for (const r of rows) {
    // passwordCandidates(), not pw.camsPassword: that field is the DEPRECATED
    // single-password shape, and a tenant saved under the current multi-entry
    // shape has it undefined — which read as "no password saved" and skipped
    // every file. Hand the importer the whole list; it tries each in turn.
    const candidates = passwordCandidates(pw, String(r.source)).map((e) => e.password);
    if (!candidates.length) {
      console.log(`  NO-PW  ${r.source}  ${String(r.file_name).slice(0, 44)} — no ${r.source} password saved; skipping`);
      continue;
    }
    console.log(
      `  ${COMMIT ? "QUEUE" : "would"}  ${String(r.source).padEnd(9)} ${String(r.status).padEnd(9)} ` +
        `imported=${String(r.rows_imported ?? 0).padStart(5)}  ${String(r.file_name).slice(0, 44)}`
    );
    if (!COMMIT) continue;

    // Back to 'uploaded' so the row reflects in-flight state and the worker's
    // already-finished guard doesn't short-circuit the re-run.
    await withTenant(r.tenant_id, async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
           SET status = 'uploaded', remarks = 'Re-queued: SIP amounts were parsed as zero', parsed_at = NULL
         WHERE id = ${r.id}::uuid
      `);
    });

    await Q.rtaImport().add(
      "import",
      {
        importId: r.id,
        tenantId: r.tenant_id,
        source: r.source,
        kind: r.kind,
        key: r.file_key,
        filename: r.file_name,
        passwords: candidates,
        userId: "00000000-0000-0000-0000-000000000000",
        roles: [],
      },
      { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } }
    );
    queued++;
  }

  console.log(`\n${COMMIT ? `queued ${queued} job(s)` : "dry run — nothing queued"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("failed:", e?.message ?? e);
    process.exit(1);
  });
