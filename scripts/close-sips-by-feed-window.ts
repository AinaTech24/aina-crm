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
 * Two corrections from the second run, when the since-inception feeds landed:
 *  - a SIP whose FOLIO still collected a SIP instalment in the window (under
 *    another scheme code or amount — a switch of scheme, a step-up) is left
 *    open: that is not evidence it stopped;
 *  - a SIP this script closed earlier that HAS collected in the window is
 *    reopened. The first CAMS run measured a feed that ended 16 Sep; the full
 *    feed then showed 130 of them (Rs 0.73 Cr a month) paying in September.
 *
 * A SIP past its END date with nothing collected after it is finished too,
 * whatever the window says (a SIP that ran to its term in the window).
 *
 *   tsx scripts/close-sips-by-feed-window.ts --tenant <uuid> [--rta cams|kfintech] [--days 75]   # dry run
 *   tsx scripts/close-sips-by-feed-window.ts --tenant <uuid> [--days 75] --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { refreshActiveSipAmount, sipMonthlySql } from "../src/lib/metrics/sip";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
// 75 days: a SIP stays in the book until about two instalments in a row are
// missed. 46 days (one miss) put Ahpal at Rs 3.75 Cr; 75 gives Rs 3.80 Cr, the
// firm's own figure from its registrar reports (8 Oct 2026). A registrar
// ceases a SIP after three misses, so a SIP between its second and third miss
// is still live there; 92 days counted those and read about Rs 4.17 Cr.
const DAYS = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 75;
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
      // The same registration: same folio, and the same scheme code — CAMS
      // writes it with the fund house's letter in the feed ("HGFGPG", "P1746")
      // and without it in the SIP register ("GFGPG", "1746"), so one ending in
      // the other counts — or the same amount, less the 0.005% stamp duty an
      // instalment arrives short of (Rs 4,99,975 for a Rs 5 L SIP). Matching on
      // the code with its letters stripped and the amount rounded closed live
      // Rs 5 L SIPs on 8 Oct 2026.
      const same = (a: string, b: string) => sql.raw(`(
        (${a}.code <> '' AND ${b}.code <> '' AND (${a}.code = ${b}.code
          OR (length(${a}.code) >= 3 AND length(${b}.code) - length(${a}.code) BETWEEN 1 AND 3 AND right(${b}.code, length(${a}.code)) = ${a}.code)
          OR (length(${b}.code) >= 3 AND length(${a}.code) - length(${b}.code) BETWEEN 1 AND 3 AND right(${a}.code, length(${b}.code)) = ${b}.code)))
        OR (${a}.amt > 0 AND abs(${b}.amt - ${a}.amt) <= greatest(1, ${a}.amt * 0.0002)))`);
      const ctes = (statuses: string) => sql`
        inst AS (
          SELECT folio_id, upper(COALESCE(scheme_code,'')) AS code, amount::numeric AS amt, max(order_date) AS d
            FROM transactions WHERE tenant_id = ${T}::uuid AND type = 'sip' AND direction = 'inflow' AND folio_id IS NOT NULL GROUP BY 1, 2, 3),
        by_folio AS (SELECT folio_id, max(d) AS d FROM inst GROUP BY 1),
        cut AS (SELECT (${reach.d}::date - ${DAYS}::int) AS since),
        cand AS (
          SELECT s.id, s.folio_id, upper(COALESCE(s.scheme_code,'')) AS code, s.amount::numeric AS amt, s.end_date, s.start_date, s.remarks
            FROM sips s JOIN investors i ON i.id = s.investor_id
           WHERE s.tenant_id = ${T}::uuid AND s.status IN (${sql.raw(statuses)})
             AND i.deleted_at IS NULL AND i.merged_into_id IS NULL ${onRta("s.folio_id")}),
        last AS (SELECT c.id, max(x.d) AS d FROM cand c JOIN inst x ON x.folio_id = c.folio_id AND ${same("c", "x")} GROUP BY c.id)`;

      // 1. Reopen what an earlier run closed and the feed now shows collecting —
      //    unless an open SIP on the folio already stands for that registration.
      const reopened = (await tx.execute(sql`
        WITH ${ctes("'completed'")},
        open_now AS (SELECT o.folio_id, upper(COALESCE(o.scheme_code,'')) AS code, o.amount::numeric AS amt FROM sips o
                      WHERE o.tenant_id = ${T}::uuid AND o.status = 'active'),
        back AS (
          -- one per registration, should two closed copies of it exist
          SELECT DISTINCT ON (c.folio_id, c.code, round(c.amt)) c.id
            FROM cand c JOIN last l ON l.id = c.id
           WHERE c.remarks LIKE '%Closed 8 Oct 2026: no instalment%' AND l.d >= (SELECT since FROM cut)
             AND NOT EXISTS (SELECT 1 FROM open_now o WHERE o.folio_id = c.folio_id AND ${same("c", "o")}))
        UPDATE sips s SET status = 'active', updated_at = now(),
               remarks = left(regexp_replace(COALESCE(s.remarks, ''), '( · )?Closed 8 Oct 2026: no instalment[^·]*', '') || ' · Reopened 8 Oct 2026: the full feed shows it collecting', 500)
          FROM back b WHERE s.id = b.id RETURNING s.id`)).rows.length;

      // 2. Close what collected nothing in the window, on a folio that collected
      //    no SIP instalment at all in it; and what ran past its end date with
      //    nothing collected after it.
      const closed = (await tx.execute(sql`
        WITH ${ctes("'active'")},
        silent AS (
          SELECT c.id, l.d AS last_inst, bf.d AS folio_last, c.end_date
            FROM cand c LEFT JOIN last l ON l.id = c.id LEFT JOIN by_folio bf ON bf.folio_id = c.folio_id
           WHERE c.start_date IS NULL OR c.start_date < (SELECT since FROM cut))
        UPDATE sips s SET status = 'completed', updated_at = now(),
               remarks = left(COALESCE(NULLIF(s.remarks, '') || ' · ', '') || CASE
                 WHEN x.end_date < ${reach.d}::date - 7 AND (x.last_inst IS NULL OR x.last_inst <= x.end_date)
                   THEN 'Closed 8 Oct 2026: ran to its end date (' || to_char(x.end_date, 'DD Mon YYYY') || ') with nothing collected after it'
                 ELSE 'Closed 8 Oct 2026: no instalment between '
                   || to_char((SELECT since FROM cut), 'DD Mon YYYY') || ' and the last imported feed day ('
                   || to_char(${reach.d}::date, 'DD Mon YYYY') || ')' || COALESCE('; last seen ' || to_char(x.last_inst, 'DD Mon YYYY'), '; none on record') END, 500)
          FROM silent x
         WHERE s.id = x.id AND (
               ((x.last_inst IS NULL OR x.last_inst < (SELECT since FROM cut)) AND (x.folio_last IS NULL OR x.folio_last < (SELECT since FROM cut)))
            OR (x.end_date < ${reach.d}::date - 7 AND (x.last_inst IS NULL OR x.last_inst <= x.end_date)))
        RETURNING s.id`)).rows.length;
      await refreshActiveSipAmount(tx, { tenantId: T });
      const after = await book();
      console.log(`${RTA ?? "all registrars"}: feed reaches ${String(reach.d).slice(0, 10)}; window ${DAYS} days`);
      console.log(`before: ${before.n} active SIPs · ${cr(before.m)} a month`);
      console.log(`reopen: ${reopened} SIPs (closed earlier, collecting in the window)`);
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
