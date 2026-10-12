/**
 * Remove duplicate SIP rows created when a folio master was re-imported.
 *
 * processSipBook matched an existing SIP on folio_ID — a surrogate key that
 * changes when the folio master is re-imported. The new folio row gets a fresh
 * uuid, the existing SIP still points at the old one, the lookup misses, and a
 * second active SIP is inserted. (Fixed in process.ts to match on folio_NUMBER,
 * which is what the registrar keys on and survives a re-import. This clears the
 * rows the old behaviour already wrote.)
 *
 * Deletes ONLY rows that are byte-identical on (folio_number, scheme_code,
 * amount, start_date), keeping the newest. A folio CAN legitimately hold two
 * SIPs in one scheme — different amounts or different start dates — and those
 * differ on this key, so they are never touched.
 *
 *   npx tsx scripts/dedupe-identical-sips.ts --tenant <uuid>            # dry run
 *   npx tsx scripts/dedupe-identical-sips.ts --tenant <uuid> --commit
 */
import { refuseIfRtaWritesStopped } from "./lib/rta-script-guard";
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

const COMMIT = process.argv.includes("--commit");
const TENANT = process.argv.includes("--tenant") ? process.argv[process.argv.indexOf("--tenant") + 1] : null;
const n = (v: unknown) => Number(v ?? 0);

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/dedupe-identical-sips.ts --tenant <uuid> [--commit]");
    process.exit(1);
  }
  if (COMMIT) await refuseIfRtaWritesStopped(TENANT, "dedupe-identical-sips");
  console.log(COMMIT ? "MODE: COMMIT — rows will be deleted" : "MODE: DRY RUN");

  await withTenant(
    TENANT,
    async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5min'`);

      // Newest row per identical group survives; every older twin is doomed.
      const doomed = sql`
        SELECT id FROM (
          SELECT id, row_number() OVER (
                   PARTITION BY folio_number, scheme_code, amount, start_date
                   ORDER BY created_at DESC, id
                 ) AS rn
            FROM sips
           WHERE tenant_id = ${TENANT}::uuid AND status = 'active'
        ) x WHERE rn > 1
      `;

      const before = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount::numeric),0)::bigint AS total,
                 (SELECT COUNT(*)::int FROM (${doomed}) d) AS deletable,
                 (SELECT COUNT(*)::int FROM (
                    SELECT 1 FROM sips WHERE tenant_id = ${TENANT}::uuid
                     GROUP BY folio_number, scheme_code HAVING COUNT(*) > 1) g) AS dup_groups
            FROM sips WHERE tenant_id = ${TENANT}::uuid
        `)
      ).rows[0] as Record<string, unknown>;

      console.log(`\n  sip rows                       ${n(before.rows)}`);
      console.log(`  duplicate folio+scheme groups  ${n(before.dup_groups)}`);
      console.log(`  identical twins (deletable)    ${n(before.deletable)}`);
      console.log(`  SIP book before                Rs ${n(before.total).toLocaleString("en-IN")}`);

      if (!COMMIT) {
        console.log("\nDry run only. Re-run with --commit to apply.\n");
        return;
      }

      const del = await tx.execute(sql`DELETE FROM sips WHERE id IN (${doomed})`);
      console.log(`\n  deleted ${(del as { rowCount?: number | null }).rowCount ?? 0} row(s)`);

      const after = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount::numeric),0)::bigint AS total,
                 (SELECT COUNT(*)::int FROM (
                    SELECT 1 FROM sips WHERE tenant_id = ${TENANT}::uuid
                     GROUP BY folio_number, scheme_code HAVING COUNT(*) > 1) g) AS dup_groups
            FROM sips WHERE tenant_id = ${TENANT}::uuid
        `)
      ).rows[0] as Record<string, unknown>;
      console.log(`  sip rows now                   ${n(after.rows)}  (duplicate groups: ${n(after.dup_groups)})`);
      console.log(`  SIP book                       Rs ${n(after.total).toLocaleString("en-IN")}`);
    },
    { userId: "00000000-0000-0000-0000-000000000000", roles: ["owner"] }
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("failed:", e?.message ?? e);
    process.exit(1);
  });
