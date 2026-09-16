/**
 * Master scheduler — fires `schedule` triggers when their `next_run_at`
 * arrives. Uses cron-parser to compute next occurrences.
 */

import { sql } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { withSystem, withTenant } from "@/db/client";
import { workflowTriggers } from "@/db/schema";
import { startRunInTransaction } from "@/lib/workflow/runner";

export async function fireDueSchedules(): Promise<number> {
  let fired = 0;
  const rows = await withSystem(async (tx) => {
    return tx.execute(sql`
      SELECT t.*, w.tenant_id as wf_tenant
      FROM workflow_triggers t
      JOIN workflows w ON w.id = t.workflow_id
      WHERE t.kind = 'schedule'
        AND t.enabled = true
        AND (t.next_run_at IS NULL OR t.next_run_at <= now())
        AND w.enabled = true AND w.paused_at IS NULL
      ORDER BY t.next_run_at NULLS FIRST
      LIMIT 100
    `);
  });

  for (const t of rows.rows as any[]) {
    const cfg = t.config ?? {};
    const cron: string = t.cron_expression ?? cfg.cron;
    if (!cron) continue;
    const tenantId = t.wf_tenant ?? t.tenant_id;

    try {
      const created = await withTenant(tenantId, async (tx) => {
        const claimed = await tx.execute(sql`SELECT * FROM workflow_triggers WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND enabled = true AND (next_run_at IS NULL OR next_run_at <= now()) FOR UPDATE SKIP LOCKED`);
        const current = claimed.rows[0] as { next_run_at: Date | null } | undefined;
        if (!current) return false;
        const occurrence = current.next_run_at ? new Date(current.next_run_at) : new Date();
        const next = CronExpressionParser.parse(cron, { tz: cfg.timezone ?? "Asia/Kolkata", currentDate: occurrence }).next().toDate();
        await startRunInTransaction(tx, {
          tenantId, workflowId: t.workflow_id, triggeredBy: "schedule", triggerId: t.id,
          occurrenceKey: `schedule:${t.id}:${occurrence.toISOString()}`,
          contextSnapshot: { scheduledAt: occurrence.toISOString() },
        });
        await tx.execute(
          sql`UPDATE workflow_triggers SET last_run_at = ${occurrence}, next_run_at = ${next} WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid`
        );
        return true;
      });
      if (created) fired++;
    } catch (err) {
      console.error(`[scheduler] trigger ${t.id} occurrence rolled back:`, (err as Error).message);
    }
  }
  return fired;
}

export function startMasterSchedulerWorker() {
  const interval = Number(process.env.MASTER_SCHEDULER_INTERVAL_MS ?? 30_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await fireDueSchedules();
      if (n > 0) console.log(`[scheduler] fired=${n}`);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  console.log(`[scheduler] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
