/**
 * Remove SIP rows left at zero by the AUTO_AMOUNT parser bug, where a correct
 * row for the same (folio, scheme) now exists.
 *
 * The broken CAMS WBR49 import wrote every SIP at amount 0 with an empty scheme
 * name. Re-importing with the fixed parser inserted the corrected rows rather
 * than updating the broken ones, because the upsert keys on (folio, scheme_code)
 * and the scheme code itself had been parsed from the wrong column. The result
 * is one dead row beside each live one — which both double-counts the SIP count
 * and shows up as duplication in the SIP book.
 *
 * Only deletes a zero row when a SIBLING with a real amount exists for the same
 * folio and scheme, so a legitimately-zero registration (a ceased SIP, say) is
 * never touched.
 *
 *   npx tsx scripts/dedupe-zero-sips.ts --tenant <uuid>            # dry run
 *   npx tsx scripts/dedupe-zero-sips.ts --tenant <uuid> --commit
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

const COMMIT = process.argv.includes("--commit");
const TENANT = process.argv.includes("--tenant") ? process.argv[process.argv.indexOf("--tenant") + 1] : null;

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/dedupe-zero-sips.ts --tenant <uuid> [--commit]");
    process.exit(1);
  }
  console.log(COMMIT ? "MODE: COMMIT — rows will be deleted" : "MODE: DRY RUN");

  await withTenant(
    TENANT,
    async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5min'`);

      const before = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS rows,
                 COUNT(*) FILTER (WHERE COALESCE(amount::numeric,0) = 0)::int AS zero_rows,
                 COALESCE(SUM(amount::numeric),0)::bigint AS total
            FROM sips WHERE tenant_id = ${TENANT}::uuid
        `)
      ).rows[0] as Record<string, unknown>;

      // A zero row is only junk if a real one covers the same folio+scheme.
      const doomed = sql`
        SELECT z.id
          FROM sips z
         WHERE z.tenant_id = ${TENANT}::uuid
           AND COALESCE(z.amount::numeric, 0) = 0
           AND EXISTS (
             SELECT 1 FROM sips g
              WHERE g.tenant_id = z.tenant_id
                AND g.folio_number = z.folio_number
                AND g.scheme_code  = z.scheme_code
                AND g.id <> z.id
                AND COALESCE(g.amount::numeric, 0) > 0
           )
      `;

      const n = (await tx.execute(sql`SELECT COUNT(*)::int AS c FROM (${doomed}) d`)).rows[0] as Record<string, unknown>;
      console.log(`\n  sip rows            ${Number(before.rows)}`);
      console.log(`  of which at zero    ${Number(before.zero_rows)}`);
      console.log(`  superseded by a real row (deletable)  ${Number(n.c)}`);
      console.log(`  legitimately zero, kept               ${Number(before.zero_rows) - Number(n.c)}`);

      if (!COMMIT) {
        console.log("\nDry run only. Re-run with --commit to apply.\n");
        return;
      }

      const del = await tx.execute(sql`DELETE FROM sips WHERE id IN (${doomed})`);
      console.log(`\n  deleted ${(del as { rowCount?: number | null }).rowCount ?? 0} row(s)`);

      const after = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS rows,
                 COUNT(*) FILTER (WHERE COALESCE(amount::numeric,0) = 0)::int AS zero_rows,
                 COALESCE(SUM(amount::numeric),0)::bigint AS total,
                 (SELECT COUNT(*)::int FROM (
                    SELECT 1 FROM sips WHERE tenant_id = ${TENANT}::uuid
                     GROUP BY folio_number, scheme_code HAVING COUNT(*) > 1) x) AS dup_groups
            FROM sips WHERE tenant_id = ${TENANT}::uuid
        `)
      ).rows[0] as Record<string, unknown>;
      console.log(`  sip rows now        ${Number(after.rows)}  (zero: ${Number(after.zero_rows)}, duplicate folio+scheme groups: ${Number(after.dup_groups)})`);
      console.log(`  SIP book            Rs ${Number(after.total).toLocaleString("en-IN")}`);
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
