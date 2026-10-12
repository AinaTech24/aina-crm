/**
 * Close "active" SIPs whose instalments stopped long ago.
 *
 * A registrar's SIP report keeps listing a registration after it stops
 * collecting, and KFintech's carries no cease date, so the importer stores it
 * as active and the SIP book counts it for ever. On Nimesh C Shah (8 Oct 2026)
 * 258 such SIPs, Rs 11.66 L a month, had last collected 1 to 175 months
 * earlier; the firm's own SIP book is Rs 45–46 L against the CRM's Rs 55.84 L.
 *
 * Evidence, per SIP, never a date alone:
 *   - the same folio + scheme (CAMS codes with or without the AMC letter, or
 *     the scheme name) DID receive instalments — a SIP or purchase inflow of
 *     the SIP's amount, or any SIP-type inflow — and
 *   - none for longer than the frequency allows (monthly 95 days, quarterly
 *     200, half-yearly 380, yearly 760), and
 *   - the firm's feed for that registrar is current (an instalment on its
 *     folios in the last 40 days), so the silence is not a missing file.
 * A SIP with no transactions at all in its folio + scheme is left alone: that
 * is missing data, not evidence. One started in the last 45 days too.
 *
 * Closed as `completed`, which the SIP-report importer reopens only on a new
 * instalment of the same amount (lib/rta/process.ts), so a SIP that restarts
 * comes back by itself. The SIP cache is refreshed afterwards.
 *
 * Dry run by default.
 *   tsx scripts/close-silent-sips.ts --tenant <uuid>
 *   tsx scripts/close-silent-sips.ts --tenant <uuid> --apply
 */
import "dotenv/config";
import { refuseIfRtaWritesStopped } from "./lib/rta-script-guard";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { refreshActiveSipAmount } from "../src/lib/metrics/sip";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
const APPLY = args.includes("--apply");
const ROLLBACK = new Error("dry run");
const lakh = (n: number) => `Rs ${(n / 1e5).toFixed(2)} L`;

const monthly = sql`(s.amount::numeric * CASE s.frequency WHEN 'quarterly' THEN 1.0/3 WHEN 'weekly' THEN 52.0/12
  WHEN 'fortnightly' THEN 26.0/12 WHEN 'half_yearly' THEN 1.0/6 WHEN 'yearly' THEN 1.0/12 ELSE 1 END)`;

async function main() {
  if (!T || T.startsWith("--")) throw new Error("Pass --tenant <uuid>. Add --apply to write.");
  // A firm under RTA governance (validate-first, paused, halted, emergency) is
  // never rewritten by a script — the release's write guard (B-1 integration).
  if (APPLY) await refuseIfRtaWritesStopped(T, "close-silent-sips");
  console.log(APPLY ? "APPLY — writing changes" : "DRY RUN — nothing is written (add --apply)");
  try {
    await withTenant(T, async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '180s'`);
      const book = async () => (await tx.execute(sql`
        SELECT COALESCE(sum(${monthly}), 0)::numeric AS m, count(*)::int AS n
          FROM sips s JOIN investors i ON i.id = s.investor_id
         WHERE s.tenant_id = ${T}::uuid AND s.status = 'active'
           AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND COALESCE(i.status, '') NOT IN ('closed', 'exited')
      `)).rows[0] as { m: string; n: number };
      const before = await book();

      const rows = (await tx.execute(sql`
        WITH a AS (
          SELECT s.id, s.amount, s.frequency, s.folio_number, s.scheme_code, s.scheme_name, s.start_date,
                 ${monthly} AS mm, f.rta
            FROM sips s LEFT JOIN folios f ON f.id = s.folio_id
           WHERE s.tenant_id = ${T}::uuid AND s.status = 'active' AND COALESCE(s.amount, 0) > 0
             AND (s.start_date IS NULL OR s.start_date <= current_date - 45)
        ), ev AS (
          SELECT a.id,
                 max(x.order_date) FILTER (
                   WHERE x.type = 'sip'
                      OR (x.type IN ('sip', 'purchase') AND abs(x.amount - a.amount) <= greatest(1, a.amount * 0.002))
                 ) AS last_paid
            FROM a
            JOIN transactions x
              ON x.tenant_id = ${T}::uuid AND x.direction = 'inflow' AND x.status IN ('processed', 'successful')
             AND x.folio_number = a.folio_number
             AND (x.scheme_code = a.scheme_code
                  OR (length(x.scheme_code) BETWEEN length(a.scheme_code) + 1 AND length(a.scheme_code) + 2
                      AND right(x.scheme_code, length(a.scheme_code)) = a.scheme_code
                      AND left(x.scheme_code, 1) ~ '[A-Za-z]')
                  OR lower(regexp_replace(COALESCE(x.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                   = lower(regexp_replace(COALESCE(a.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g')))
           GROUP BY a.id
        ), fresh AS (
          -- Registrars whose feed reached this firm in the last 40 days.
          SELECT DISTINCT f.rta FROM transactions x JOIN folios f ON f.id = x.folio_id
           WHERE x.tenant_id = ${T}::uuid AND x.type = 'sip' AND x.order_date >= current_date - 40
        )
        SELECT a.id, a.mm, ev.last_paid::text AS last_paid
          FROM a JOIN ev ON ev.id = a.id
         WHERE ev.last_paid IS NOT NULL
           AND a.rta IN (SELECT rta FROM fresh)
           AND ev.last_paid < current_date - CASE a.frequency WHEN 'quarterly' THEN 200 WHEN 'half_yearly' THEN 380
                                                              WHEN 'yearly' THEN 760 ELSE 95 END
      `)).rows as Array<{ id: string; mm: string; last_paid: string }>;

      const total = rows.reduce((t, r) => t + Number(r.mm), 0);
      console.log(`SIP book now ${lakh(Number(before.m))} (${before.n} active SIPs)`);
      console.log(`silent SIPs to close: ${rows.length}, ${lakh(total)} a month`);
      const byYear = new Map<string, number>();
      for (const r of rows) byYear.set(r.last_paid.slice(0, 4), (byYear.get(r.last_paid.slice(0, 4)) ?? 0) + 1);
      console.log("  last instalment by year: " + [...byYear].sort().map(([y, n]) => `${y}: ${n}`).join(" · "));

      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500);
        await tx.execute(sql`
          UPDATE sips s
             SET status = 'completed', updated_at = now(),
                 remarks = 'Closed: no instalment since ' || v.last_paid || ' (the registrar lists it with no cease date)'
            FROM (VALUES ${sql.join(part.map((r) => sql`(${r.id}::uuid, ${r.last_paid})`), sql`, `)}) AS v(id, last_paid)
           WHERE s.id = v.id AND s.tenant_id = ${T}::uuid AND s.status = 'active'
        `);
      }
      await refreshActiveSipAmount(tx, { tenantId: T });
      const after = await book();
      console.log(`SIP book after ${lakh(Number(after.m))} (${after.n} active SIPs)`);
      if (!APPLY) throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
