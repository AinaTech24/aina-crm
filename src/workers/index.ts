/**
 * Worker process entry point. Run via `npm run worker`.
 *
 * Starts every background worker in a single Node process. In production
 * with higher load, split into multiple processes by passing
 * `WORKER_GROUPS=outbox,wf,seg` etc.
 */

import "dotenv/config";
import { startOutboxPollerWorker } from "./outbox-poller";
import { startWorkflowRunnerWorker } from "./workflow-runner";
import { startSegmentMaterializerWorker } from "./segment-materializer";
import { startMasterSchedulerWorker } from "./master-scheduler";
import { startAiSensyTemplateSyncWorker } from "./aisensy-template-sync";

const groups = (process.env.WORKER_GROUPS ?? "outbox,wf,seg,sched,wa_sync")
  .split(",")
  .map((s) => s.trim());

const stops: Array<() => void> = [];

if (groups.includes("outbox")) stops.push(startOutboxPollerWorker());
if (groups.includes("wf")) stops.push(startWorkflowRunnerWorker());
if (groups.includes("seg")) stops.push(startSegmentMaterializerWorker());
if (groups.includes("sched")) stops.push(startMasterSchedulerWorker());
if (groups.includes("wa_sync")) stops.push(startAiSensyTemplateSyncWorker());

console.log(`✓ Worker process up. Groups: ${groups.join(", ")}`);

const shutdown = async () => {
  console.log("Shutting down workers...");
  for (const stop of stops) {
    try {
      stop();
    } catch {}
  }
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
