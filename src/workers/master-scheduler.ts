/**
 * Master scheduler — fires `schedule` triggers when their `next_run_at`
 * arrives. Uses cron-parser to compute next occurrences.
 */

import { sql } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { withSystem, withTenant } from "@/db/client";
import { workflowTriggers } from "@/db/schema";
import { startRun } from "@/lib/workflow/runner";

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
    try {
      const cfg = t.config ?? {};
      const cron: string = t.cron_expression ?? cfg.cron;
      if (!cron) continue;

      // Fire one run for the workflow. For schedules that target a set of
      // subjects (e.g., "all investors matching X"), the workflow's first
      // node is typically a `loop` that pages through subjects — but we
      // also support a workflow-level subjectQuery on the trigger which
      // expands to multiple runs.
      const tenantId = t.wf_tenant ?? t.tenant_id;

      if (cfg.subjectQuery) {
        // TODO: compile subjectQuery to SQL, page through, start a run per subject.
        // For v1, schedules fire a single run with no subject — workflows use
        // a loop with a `find_subjects` step (deferred to v2).
        await startRun({
          tenantId,
          workflowId: t.workflow_id,
          triggeredBy: "schedule",
          triggerId: t.id,
        });
      } else {
        await startRun({
          tenantId,
          workflowId: t.workflow_id,
          triggeredBy: "schedule",
          triggerId: t.id,
        });
      }

      // Compute next occurrence
      const next = CronExpressionParser.parse(cron, { tz: cfg.timezone ?? "Asia/Kolkata" }).next().toDate();
      await withTenant(tenantId, async (tx) => {
        await tx.execute(
          sql`UPDATE workflow_triggers SET last_run_at = now(), next_run_at = ${next} WHERE id = ${t.id}`
        );
      });
      fired++;
    } catch (err) {
      console.error(`[scheduler] trigger ${t.id} failed:`, (err as Error).message);
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
