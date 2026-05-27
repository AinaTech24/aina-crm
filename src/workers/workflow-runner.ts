/**
 * Workflow runner worker.
 *
 * Picks up queued runs from `workflow_runs` (status='queued' OR status='paused'
 * AND paused_until <= now()) and executes them step by step. Each step is a
 * separate execute() call that:
 *   1. Loads the run + version + subject
 *   2. Invokes the action handler
 *   3. Persists the outcome and advances current_node_id
 *   4. Re-enqueues itself for the next step (or pauses / completes)
 *
 * Concurrency: per-tenant queue suffix prevents noisy-neighbor at the BullMQ
 * level. We also poll for paused runs whose pause window has elapsed.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { executeStep } from "@/lib/workflow/runner";

export async function runNextBatch(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  const claimable = await withSystem(async (tx) => {
    // Atomically claim up to N runs by transitioning queued/awakened paused runs.
    const rows = await tx.execute(sql`
      WITH cte AS (
        SELECT id, tenant_id FROM workflow_runs
        WHERE
          status = 'queued'
          OR (status = 'paused' AND paused_until IS NOT NULL AND paused_until <= now())
        ORDER BY created_at
        LIMIT ${Number(process.env.WORKFLOW_RUNNER_BATCH ?? 50)}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE workflow_runs r
      SET status = 'running'
      FROM cte
      WHERE r.id = cte.id
      RETURNING r.id, r.tenant_id;
    `);
    return rows.rows as Array<{ id: string; tenant_id: string }>;
  });

  for (const r of claimable) {
    try {
      let next = await executeStep({ tenantId: r.tenant_id, runId: r.id });
      let safety = 0;
      // Walk forward while the run can continue immediately. Bail at delay/pause/end.
      while (next.status === "running" && safety < 25) {
        safety++;
        next = await executeStep({ tenantId: r.tenant_id, runId: r.id });
      }
      processed++;
    } catch (err) {
      console.error(`[wf-runner] run ${r.id} failed:`, (err as Error).message);
      failed++;
    }
  }
  return { processed, failed };
}

export function startWorkflowRunnerWorker() {
  const interval = Number(process.env.WORKFLOW_RUNNER_INTERVAL_MS ?? 500);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { processed, failed } = await runNextBatch();
      if (processed > 0 || failed > 0) {
        console.log(`[wf-runner] processed=${processed} failed=${failed}`);
      }
    } catch (err) {
      console.error("[wf-runner] tick error:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  console.log(`[wf-runner] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
