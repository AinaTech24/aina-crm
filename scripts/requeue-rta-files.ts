/**
 * Re-import a firm's stored RTA files, in the order the pipeline needs them.
 *
 * ORDER MATTERS, and getting it wrong is what caused the original mess:
 *
 *   1. folio_master_dump  — creates the clients and the folio register
 *   2. cas_holdings       — values those folios (this is what makes AUM real)
 *   3. daily_transaction_feed
 *   4. monthly_sip_book   — needs the folios to exist to attach a SIP
 *
 * A valuation or transaction file landing BEFORE the master has to invent the
 * folio it is posting against, which is how one firm ended up with every folio
 * stored twice and Rs 493 Cr double-counted. The blank-amc_code hole that
 * allowed it is fixed, but the ordering is still the difference between a clean
 * import and a reconciliation job.
 *
 * The worker runs at concurrency 1 and BullMQ is FIFO, so enqueueing in this
 * order is enough to guarantee it.
 *
 * Selects the LATEST stored file per (source, kind, reference) — the mailbox
 * accumulates re-sends of the same report, and importing older copies on top of
 * newer ones just rewinds the book.
 *
 *   npx tsx scripts/requeue-rta-files.ts --tenant <uuid>            # dry run
 *   npx tsx scripts/requeue-rta-files.ts --tenant <uuid> --commit
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";
import { Q } from "@/workers/queues";

const COMMIT = process.argv.includes("--commit");
const TENANT = process.argv.includes("--tenant") ? process.argv[process.argv.indexOf("--tenant") + 1] : null;
/** Only these references, if given: --refs 224596465,WBMST9746198 */
const REFS = process.argv.includes("--refs")
  ? new Set(process.argv[process.argv.indexOf("--refs") + 1].split(",").map((s) => s.trim()).filter(Boolean))
  : null;

/** Dependency order. Anything not listed is skipped. */
const KIND_ORDER = ["folio_master_dump", "cas_holdings", "daily_transaction_feed", "monthly_sip_book"];

/** Kinds handled by the rich (client-book) engine rather than the feed processor. */
const RICH_KINDS = new Set<string>(["folio_master_dump", "cas_holdings"]);

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/requeue-rta-files.ts --tenant <uuid> [--refs a,b] [--commit]");
    process.exit(1);
  }
  console.log(COMMIT ? "MODE: COMMIT — jobs will be queued" : "MODE: DRY RUN");

  const rows = (await withSystem(async (tx) =>
    (
      await tx.execute(sql`
        SELECT id, tenant_id, source, kind, status, file_key, file_name, rows_imported,
               created_at::text AS created_at,
               COALESCE(
                 substring(file_name from 'BMB([0-9]+)R'),
                 substring(file_name from '(WB[A-Z]+[0-9]+|WSREG[0-9]+)'),
                 file_name
               ) AS reference
          FROM rta_file_imports
         WHERE tenant_id = ${TENANT}::uuid
           AND file_key IS NOT NULL
           AND status <> 'rejected'
         ORDER BY created_at DESC
      `)
    ).rows as Array<Record<string, any>>
  )) as Array<Record<string, any>>;

  // Newest wins per (source, kind, reference); rows are already newest-first.
  const latest = new Map<string, Record<string, any>>();
  for (const r of rows) {
    if (!KIND_ORDER.includes(String(r.kind))) continue;
    if (REFS && !REFS.has(String(r.reference))) continue;
    const k = `${r.source}::${r.kind}::${r.reference}`;
    if (!latest.has(k)) latest.set(k, r);
  }

  const ordered = [...latest.values()].sort(
    (a, b) => KIND_ORDER.indexOf(String(a.kind)) - KIND_ORDER.indexOf(String(b.kind))
  );

  if (!ordered.length) {
    console.log("no files matched");
    return;
  }

  const pw = await withTenant(TENANT, async (tx) => getMailbackPasswords(tx, TENANT));
  let queued = 0;

  console.log("\n  #  kind                    source    reference       previously");
  console.log("  " + "-".repeat(70));
  for (const [i, r] of ordered.entries()) {
    const candidates = passwordCandidates(pw, String(r.source)).map((e) => e.password);
    const note = candidates.length ? "" : "   << NO PASSWORD SAVED — will be skipped";
    console.log(
      `  ${String(i + 1).padStart(2)}  ${String(r.kind).padEnd(23)} ${String(r.source).padEnd(9)} ` +
        `${String(r.reference).padEnd(15)} ${String(r.status).padEnd(9)} ${String(r.rows_imported ?? 0).padStart(7)}${note}`
    );
    if (!COMMIT || !candidates.length) continue;

    await withTenant(r.tenant_id, async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
           SET status = 'uploaded', remarks = 'Re-queued for a clean full re-import', parsed_at = NULL
         WHERE id = ${r.id}::uuid
      `);
    });

    const opts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
    const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

    if (RICH_KINDS.has(String(r.kind))) {
      // The rich engine resolves real AMC + scheme names and CREATES the client
      // book. Its job shape differs from the feed processor's: `rta`/`reportType`
      // rather than `source`/`kind`.
      await Q.rtaImport().add(
        "rich-import",
        {
          mode: "rich",
          importId: r.id,
          tenantId: r.tenant_id,
          key: r.file_key,
          filename: r.file_name,
          passwords: candidates,
          rta: r.source,
          reportType: "",
          dryRun: false,
          assignToMe: false,
          userId: SYSTEM_USER,
          roles: [],
        },
        opts
      );
    } else {
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
          userId: SYSTEM_USER,
          roles: [],
        },
        opts
      );
    }
    queued++;
  }

  console.log(`\n${COMMIT ? `queued ${queued} job(s) in dependency order` : "dry run — nothing queued"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("failed:", e?.message ?? e);
    process.exit(1);
  });
