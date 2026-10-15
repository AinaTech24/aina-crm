/**
 * Put back the date of CAMS transactions a daily feed misread month-first.
 *
 * A daily CAMS feed whose trades all fall on the 1st–12th of a month has no
 * date over 12 to tell day-first from month-first, and the parser defaulted to
 * day-first: 8/11/2026 (11 Aug) became 8 Nov. Found 15 Oct 2026: 255 rows at
 * Anmol Money and Sandeep Garg dated in November / December. The parser now
 * decides from the clock and the calendar too (detectDateOrder).
 *
 * A transaction dated after tomorrow gets its day and month swapped back — but
 * only when the swapped date is a real date no later than the day the row was
 * imported. When a twin with that date already exists (same folio, scheme
 * code, type, amount within Re 1), the misdated copy is a duplicate and is
 * deleted. The clients touched are revalued. Dry run by default.
 *
 *   tsx scripts/fix-swapped-feed-dates.ts                 # every firm, dry run
 *   tsx scripts/fix-swapped-feed-dates.ts --tenant <uuid> --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "../src/db/client";
import { recomputeInvestorsAum } from "../src/lib/finance/aum-persist";

const args = process.argv.slice(2);
const ONLY = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : null;
const APPLY = args.includes("--apply");

async function main() {
  console.log(APPLY ? "APPLY" : "DRY RUN (add --apply)");
  const tenants = await withSystem(async (tx) => (await tx.execute(sql`
    SELECT DISTINCT tenant_id::text AS id FROM transactions WHERE order_date > current_date + 1`)).rows as Array<{ id: string }>);
  for (const { id } of tenants) {
    if (ONLY && id !== ONLY) continue;
    await withTenant(id, async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
      const rows = (await tx.execute(sql`
        WITH fut AS (
          SELECT t.id, t.investor_id, t.folio_id, t.scheme_code, t.type, t.amount, t.order_date, t.created_at,
                 CASE WHEN extract(day from t.order_date) <= 12
                      THEN make_date(extract(year from t.order_date)::int, extract(day from t.order_date)::int, extract(month from t.order_date)::int) END AS swapped
            FROM transactions t WHERE t.tenant_id = ${id}::uuid AND t.order_date > current_date + 1)
        SELECT f.id, f.investor_id, f.order_date::text AS was, f.swapped::text AS fixed,
               EXISTS (SELECT 1 FROM transactions o WHERE o.tenant_id = ${id}::uuid AND o.id <> f.id
                         AND o.folio_id IS NOT DISTINCT FROM f.folio_id AND o.scheme_code IS NOT DISTINCT FROM f.scheme_code
                         AND o.type = f.type AND o.order_date = f.swapped AND abs(COALESCE(o.amount, 0) - COALESCE(f.amount, 0)) < 1) AS twin
          FROM fut f
         WHERE f.swapped IS NOT NULL AND f.swapped <= (f.created_at AT TIME ZONE 'Asia/Kolkata')::date`)).rows as Array<{ id: string; investor_id: string; was: string; fixed: string; twin: boolean }>;
      const fix = rows.filter((r) => !r.twin), dupes = rows.filter((r) => r.twin);
      const left = (await tx.execute(sql`SELECT count(*)::int n FROM transactions WHERE tenant_id = ${id}::uuid AND order_date > current_date + 1`)).rows[0] as any;
      console.log(`${id}: ${fix.length} to re-date, ${dupes.length} duplicate(s) to delete, ${Number(left.n) - rows.length} future-dated left as they are (cannot be a swap)`);
      for (const r of rows.slice(0, 3)) console.log(`   e.g. ${r.was} → ${r.fixed}${r.twin ? " (duplicate)" : ""}`);
      if (!APPLY || !rows.length) return;
      for (let i = 0; i < fix.length; i += 200) {
        const part = fix.slice(i, i + 200);
        await tx.execute(sql`
          UPDATE transactions t SET order_date = v.d::date, updated_at = now()
            FROM (VALUES ${sql.join(part.map((r) => sql`(${r.id}::uuid, ${r.fixed})`), sql`, `)}) AS v(id, d)
           WHERE t.id = v.id AND t.tenant_id = ${id}::uuid`);
      }
      if (dupes.length) {
        await tx.execute(sql`DELETE FROM transactions WHERE tenant_id = ${id}::uuid AND id IN (${sql.join(dupes.map((r) => sql`${r.id}::uuid`), sql`, `)})`);
      }
      await recomputeInvestorsAum(tx, [...new Set(rows.map((r) => r.investor_id).filter(Boolean))]);
      console.log(`   applied; ${new Set(rows.map((r) => r.investor_id)).size} client(s) revalued`);
    });
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.cause?.message ?? e?.message ?? e); process.exit(1); });
