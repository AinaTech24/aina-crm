/**
 * Scheduled auto-statements.
 *
 * Proactive transparency on autopilot: every client whose statement_cadence is
 * 'monthly' or 'quarterly' is auto-emailed their LIVE portfolio statement once
 * per period, with no RM effort. Renders the same PDF as the manual action via
 * the shared sendInvestorStatement() helper, so what the client receives on a
 * schedule is identical to an ad-hoc send.
 *
 * Due logic (watermark = investors.last_statement_sent_at):
 *   monthly   → due when last send is before the start of this month
 *   quarterly → due when last send is before the start of this calendar quarter
 * Sets the watermark after each send, so a same-day re-run is a no-op.
 *
 * Only clients with an email on file are auto-sent (statements go as a PDF
 * attachment). Each send writes a communications audit row.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { sendInvestorStatement } from "@/lib/finance/send-statement";

export interface StatementSchedulerResult {
  tenants: number;
  due: number;
  sent: number;
  failed: number;
  durationMs: number;
}

export async function runStatementScheduler(): Promise<StatementSchedulerResult> {
  const startedAt = Date.now();
  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active','trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });

  let due = 0;
  let sent = 0;
  let failed = 0;

  for (const tenantId of tenants) {
    try {
      await withTenant(tenantId, async (tx) => {
        // Clients due for a statement this period.
        const rows = await tx.execute(sql`
          SELECT id FROM investors
          WHERE tenant_id = ${tenantId}::uuid
            AND status = 'active'
            AND statement_cadence IN ('monthly','quarterly')
            AND email IS NOT NULL AND email <> ''
            AND (
              last_statement_sent_at IS NULL
              OR (statement_cadence = 'monthly'   AND last_statement_sent_at < date_trunc('month', now()))
              OR (statement_cadence = 'quarterly' AND last_statement_sent_at < date_trunc('quarter', now()))
            )
          ORDER BY id
          LIMIT 1000
        `);
        due += rows.rows.length;
        for (const row of rows.rows as Array<{ id: string }>) {
          const res = await sendInvestorStatement(tx, {
            tenantId,
            investorId: row.id,
            channel: "email",
            actorUserId: null,
          });
          if (res.ok) {
            sent++;
            await tx.execute(
              sql`UPDATE investors SET last_statement_sent_at = now(), updated_at = now() WHERE id = ${row.id}::uuid`
            );
          } else {
            failed++;
          }
        }
      });
    } catch (err: any) {
      console.error(`[statement-scheduler] tenant ${tenantId} failed:`, err?.message ?? err);
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[statement-scheduler] sent ${sent}/${due} statement(s), ${failed} failed across ${tenants.length} tenant(s)`);
  }
  return { tenants: tenants.length, due, sent, failed, durationMs: Date.now() - startedAt };
}
