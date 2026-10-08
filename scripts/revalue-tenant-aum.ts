/**
 * Revalue every live client of one firm (investors.aum + the SIP cache) with
 * the current valuation rules, and print the firm's totals before and after.
 * Use it after a data repair or a valuation fix rather than waiting for the
 * nightly run. One transaction per 250 clients.
 *
 *   tsx scripts/revalue-tenant-aum.ts --tenant <uuid>           # totals only
 *   tsx scripts/revalue-tenant-aum.ts --tenant <uuid> --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { recomputeInvestorsAum } from "../src/lib/finance/aum-persist";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
const APPLY = args.includes("--apply");
const cr = (n: number) => `Rs ${(n / 1e7).toFixed(2)} Cr`;

async function totals() {
  return withTenant(T, async (tx) => {
    const r = (await tx.execute(sql`
      SELECT count(*) FILTER (WHERE COALESCE(aum,0) > 0)::int AS funded, COALESCE(sum(aum),0)::numeric AS aum,
             (SELECT COALESCE(sum(f.aum),0) FROM folios f JOIN investors j ON j.id = f.investor_id
               WHERE f.tenant_id = ${T}::uuid AND j.deleted_at IS NULL AND j.merged_into_id IS NULL)::numeric AS folio_aum
        FROM investors WHERE tenant_id = ${T}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND COALESCE(status,'') NOT IN ('closed','exited')
    `)).rows[0] as any;
    return `${r.funded} clients holding money · AUM ${cr(Number(r.aum))} · folio register ${cr(Number(r.folio_aum))}`;
  });
}

async function main() {
  if (!T || T.startsWith("--")) throw new Error("Pass --tenant <uuid>");
  console.log(`before: ${await totals()}`);
  if (!APPLY) return;
  let cursor: string | null = null, n = 0;
  for (;;) {
    const ids = await withTenant(T, async (tx) =>
      ((await tx.execute(sql`
        SELECT id FROM investors WHERE tenant_id = ${T}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
        ${cursor ? sql`AND id > ${cursor}::uuid` : sql``} ORDER BY id LIMIT 250
      `)).rows as Array<{ id: string }>).map((r) => String(r.id)),
    );
    if (!ids.length) break;
    await withTenant(T, (tx) => recomputeInvestorsAum(tx, ids));
    cursor = ids[ids.length - 1];
    n += ids.length;
    if (n % 1000 < 250) console.log(`  revalued ${n}`);
  }
  console.log(`after:  ${await totals()}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
