/**
 * Take STP/SWP registrations out of a firm's SIP book now, instead of waiting
 * for its next registrar SIP report (lib/finance/sip-lifecycle.ts
 * markSystematicTransfers — the same rule the import runs), and retire the
 * Rs 0 copies a code-less CAMS report left beside their re-imported twins.
 *
 * Dry run by default: the change is made inside a transaction that is rolled
 * back, so the figures printed are exactly what --apply would leave.
 *
 * USAGE:
 *   tsx scripts/mark-sip-transfers.ts --tenant <uuid> [--tenant <uuid> …] [--no-ended] [--apply]
 */

import { refuseIfRtaWritesStopped } from "./lib/rta-script-guard";
import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "../src/db/client";
import { markSystematicTransfers } from "../src/lib/finance/sip-lifecycle";
import { refreshActiveSipAmount, sipMonthlySql } from "../src/lib/metrics/sip";

const args = process.argv.slice(2);
const TENANTS = args.flatMap((a, i) => (a === "--tenant" && args[i + 1] ? [args[i + 1]] : []));
const APPLY = args.includes("--apply");
/** Skip the "ended" step for a firm whose transaction feed is incomplete —
 *  silence in a ledger with gaps is not evidence that a SIP stopped. */
const ENDED = !args.includes("--no-ended");
const ROLLBACK = new Error("dry run — rolled back");

const lakh = (n: number) => `Rs ${(n / 1e5).toFixed(2)} L`;

async function book(tx: Tx, tenantId: string): Promise<{ monthly: number; sips: number }> {
  const r = (await tx.execute(sql`
    SELECT COALESCE(SUM(${sipMonthlySql("s")}), 0)::numeric AS monthly, COUNT(*)::int AS sips
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'active'
       AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND COALESCE(i.status, '') NOT IN ('closed', 'exited')
  `)).rows[0] as { monthly: string; sips: number };
  return { monthly: Number(r.monthly), sips: r.sips };
}

async function main() {
  if (!TENANTS.length) throw new Error("Pass --tenant <uuid> (repeatable). Add --apply to write.");
  console.log(APPLY ? "APPLY — writing changes" : "DRY RUN — nothing is kept (add --apply)");
  if (APPLY) for (const tenantId of TENANTS) await refuseIfRtaWritesStopped(tenantId, "mark-sip-transfers");
  for (const tenantId of TENANTS) {
    let line = "";
    try {
      await withTenant(tenantId, async (tx) => {
        // A maintenance pass over a whole firm's ledger: the same allowance an
        // RTA import gets (lib/rta/process.ts), not the app's 30 seconds.
        await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);
        const name = ((await tx.execute(sql`SELECT COALESCE(display_name, legal_name) AS n FROM tenants WHERE id = ${tenantId}::uuid`)).rows[0] as any)?.n ?? tenantId;
        const before = await book(tx, tenantId);
        // Rs 0 copies of a registration that a later report re-imported WITH its
        // amount (a file keyed on scheme name, then one with a code column).
        const dupes = (await tx.execute(sql`
          UPDATE sips z
             SET status = 'stopped', updated_at = now(),
                 remarks = 'Duplicate: the same registration was re-imported with its amount'
           WHERE z.tenant_id = ${tenantId}::uuid AND z.status = 'active' AND COALESCE(z.amount, 0) = 0
             AND EXISTS (
               SELECT 1 FROM sips o
                WHERE o.tenant_id = z.tenant_id AND o.id <> z.id AND o.status = 'active'
                  AND o.folio_number = z.folio_number AND COALESCE(o.amount, 0) > 0
                  AND lower(regexp_replace(COALESCE(o.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
                    = lower(regexp_replace(COALESCE(z.scheme_name, ''), '[^a-zA-Z0-9]', '', 'g'))
             )
          RETURNING z.id
        `)).rows.length;
        const marked = await markSystematicTransfers(tx, tenantId);
        // Registrations past their end date (+7 days' grace) whose scheme USED
        // to receive SIP instalments and has received none for 45 days: ended.
        // Matched per scheme (CAMS codes with or without the AMC letter), not
        // per folio — another live SIP in the same folio no longer keeps a
        // finished one open. A scheme with no transactions at all is left
        // alone: that is missing data, not evidence.
        const ended = !ENDED ? 0 : (await tx.execute(sql`
          WITH cand AS (
            SELECT s.id, s.folio_number, s.scheme_code
              FROM sips s
             WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'active' AND COALESCE(s.amount, 0) > 0
               AND s.end_date IS NOT NULL AND s.end_date < current_date - 7
          ), ev AS (
            SELECT c.id, max(x.order_date) FILTER (WHERE x.type = 'sip') AS last_sip
              FROM cand c
              JOIN transactions x
                ON x.tenant_id = ${tenantId}::uuid AND x.folio_number = c.folio_number
               AND (x.scheme_code = c.scheme_code
                    OR (length(x.scheme_code) BETWEEN length(c.scheme_code) + 1 AND length(c.scheme_code) + 2
                        AND right(x.scheme_code, length(c.scheme_code)) = c.scheme_code
                        AND left(x.scheme_code, 1) ~ '[A-Za-z]'))
             GROUP BY c.id
          )
          UPDATE sips s SET status = 'completed', updated_at = now()
            FROM ev
           WHERE s.id = ev.id AND ev.last_sip IS NOT NULL AND ev.last_sip < current_date - 45
          RETURNING s.id
        `)).rows.length;
        await refreshActiveSipAmount(tx, { tenantId });
        const after = await book(tx, tenantId);
        line = `${name}: SIP book ${lakh(before.monthly)} (${before.sips} SIPs) -> ${lakh(after.monthly)} (${after.sips} SIPs); ${marked} STP/SWP registrations, ${dupes} Rs 0 duplicates and ${ended} ended SIPs taken out`;
        if (!APPLY) throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    console.log(line);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
