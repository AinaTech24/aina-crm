/**
 * Close "active" SIPs that collected nothing in the window before the firm's
 * LAST imported SIP instalment — the firm's live SIP register, measured from
 * the feed rather than from today, so a late file does not close live SIPs.
 *
 * Ahpal Financial Services, 8 Oct 2026: the feed reaches 16 Sep; SIPs with an
 * instalment since 1 Aug (46 days) total Rs 3.80 Cr a month — exactly the
 * firm's own SIP book — while 2,941 others (Rs 5.19 Cr) last paid before
 * August or never. Matching: same folio + scheme code without its AMC letter
 * prefix (CAMS writes "P1746" in the feed, "1746" in the SIP report), or the
 * same folio + amount. A SIP that started inside the window is left alone.
 *
 * Closed as `completed` with a remark; the SIP-report importer reopens a SIP
 * on a new instalment of the same amount, so one that restarts comes back.
 *
 *   tsx scripts/close-sips-by-feed-window.ts --tenant <uuid> [--rta cams|kfintech] [--days 46]   # dry run
 *   tsx scripts/close-sips-by-feed-window.ts --tenant <uuid> [--days 46] --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { refreshActiveSipAmount, sipMonthlySql } from "../src/lib/metrics/sip";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
const DAYS = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 46;
const APPLY = args.includes("--apply");
// One registrar at a time: each is measured against ITS feed's last instalment,
// so a registrar whose feed is behind never makes the other's SIPs look silent.
const RTA = args.includes("--rta") ? args[args.indexOf("--rta") + 1] : null;
const DRY = new Error("dry run");
const cr = (n: unknown) => `Rs ${(Number(n) / 1e7).toFixed(2)} Cr`;

async function main() {
  if (!T || T.startsWith("--")) throw new Error("Pass --tenant <uuid>");
  console.log(APPLY ? "APPLY" : "DRY RUN (add --apply)");
  try {
    await withTenant(T, async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '180s'`);
      const onRta = (col: string) => RTA
        ? sql`AND ${sql.raw(col)} IN (SELECT f.id FROM folios f WHERE f.tenant_id = ${T}::uuid AND f.rta = ${RTA})`
        : sql``;
      const book = async () => (await tx.execute(sql`
        SELECT count(*)::int AS n, COALESCE(sum(${sipMonthlySql("s")}), 0)::numeric AS m
          FROM sips s JOIN investors i ON i.id = s.investor_id
         WHERE s.tenant_id = ${T}::uuid AND s.status = 'active'
           AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND COALESCE(i.status,'') NOT IN ('closed','exited')`)).rows[0] as any;
      const reach = (await tx.execute(sql`
        SELECT max(order_date) AS d FROM transactions WHERE tenant_id = ${T}::uuid AND type = 'sip' AND direction = 'inflow' ${onRta("folio_id")}`)).rows[0] as any;
      if (!reach?.d) throw new Error("no SIP instalments on record — nothing to measure against");
      const before = await book();
      const closed = (await tx.execute(sql`
        WITH inst AS (
          SELECT folio_id, upper(regexp_replace(COALESCE(scheme_code,''), '^[A-Z]+', '')) AS code_tail, round(amount::numeric) AS amt, max(order_date) AS d
            FROM transactions WHERE tenant_id = ${T}::uuid AND type = 'sip' AND direction = 'inflow' AND folio_id IS NOT NULL GROUP BY 1, 2, 3),
        by_code AS (SELECT folio_id, code_tail, max(d) AS d FROM inst WHERE code_tail <> '' GROUP BY 1, 2),
        by_amt AS (SELECT folio_id, amt, max(d) AS d FROM inst GROUP BY 1, 2),
        cut AS (SELECT (${reach.d}::date - ${DAYS}::int) AS since),
        silent AS (
          SELECT s.id, GREATEST(c.d, m.d) AS last_inst
            FROM sips s JOIN investors i ON i.id = s.investor_id
            LEFT JOIN by_code c ON c.folio_id = s.folio_id AND c.code_tail = upper(regexp_replace(COALESCE(s.scheme_code,''), '^[A-Z]+', ''))
            LEFT JOIN by_amt m ON m.folio_id = s.folio_id AND m.amt = round(s.amount::numeric)
           WHERE s.tenant_id = ${T}::uuid AND s.status = 'active'
             AND i.deleted_at IS NULL AND i.merged_into_id IS NULL ${onRta("s.folio_id")}
             AND (s.start_date IS NULL OR s.start_date < (SELECT since FROM cut)))
        UPDATE sips s SET status = 'completed', updated_at = now(),
               remarks = left(COALESCE(NULLIF(s.remarks, '') || ' · ', '') || 'Closed 8 Oct 2026: no instalment between '
                 || to_char((SELECT since FROM cut), 'DD Mon YYYY') || ' and the last imported feed day ('
                 || to_char(${reach.d}::date, 'DD Mon YYYY') || ')' || COALESCE('; last seen ' || to_char(x.last_inst, 'DD Mon YYYY'), '; none on record'), 500)
          FROM silent x
         WHERE s.id = x.id AND (x.last_inst IS NULL OR x.last_inst < (SELECT since FROM cut))
        RETURNING s.id`)).rows.length;
      await refreshActiveSipAmount(tx, { tenantId: T });
      const after = await book();
      console.log(`${RTA ?? "all registrars"}: feed reaches ${String(reach.d).slice(0, 10)}; window ${DAYS} days`);
      console.log(`before: ${before.n} active SIPs · ${cr(before.m)} a month`);
      console.log(`close:  ${closed} SIPs`);
      console.log(`after:  ${after.n} active SIPs · ${cr(after.m)} a month`);
      if (!APPLY) throw DRY;
    });
  } catch (e) {
    if (e !== DRY) throw e;
    console.log("(rolled back — dry run)");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.cause?.message ?? e?.message ?? e); process.exit(1); });
