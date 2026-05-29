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
import { runDailyOpsScan } from "./daily-ops-scanner";
import { runMonthlyComplianceSweep } from "./monthly-compliance-seeder";

const groups = (process.env.WORKER_GROUPS ?? "outbox,wf,seg,sched,wa_sync,ops,monthly")
  .split(",")
  .map((s) => s.trim());

const stops: Array<() => void> = [];

if (groups.includes("outbox")) stops.push(startOutboxPollerWorker());
if (groups.includes("wf")) stops.push(startWorkflowRunnerWorker());
if (groups.includes("seg")) stops.push(startSegmentMaterializerWorker());
if (groups.includes("sched")) stops.push(startMasterSchedulerWorker());
if (groups.includes("wa_sync")) stops.push(startAiSensyTemplateSyncWorker());

/**
 * Daily ops scanner — fires once a day at 06:30 local time. Scans every
 * tenant for birthdays / anniversaries / minor-to-major / dormancy /
 * KYC + risk-profile expiry and emits events the recipes consume.
 *
 * Why not in master-scheduler: the scanner is a single sweep, not a
 * per-trigger fire. Wiring it through workflow_triggers would create
 * one trigger per tenant. A self-scheduled tick is cheaper and easier
 * to reason about.
 */
if (groups.includes("ops")) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(6, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    const t = setTimeout(async () => {
      try {
        await runDailyOpsScan();
      } catch (err) {
        console.error("[daily-ops-scanner] sweep failed:", err);
      }
      scheduleNext();
    }, delayMs);
    t.unref?.();
    stops.push(() => clearTimeout(t));
    console.log(
      `[daily-ops-scanner] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)} min)`
    );
  };
  // Also run on boot if the env var asks for it — useful for testing.
  if (process.env.DAILY_OPS_ON_BOOT === "1") {
    void runDailyOpsScan();
  }
  scheduleNext();
}

/**
 * Monthly compliance checklist — seeds the standard SEBI-flavoured tasks
 * to every active tenant on the 1st of each month at 06:00. Hourly tick
 * is cheap; we no-op unless it's actually the 1st and we haven't run
 * already in this calendar month.
 */
if (groups.includes("monthly")) {
  let lastRunYearMonth = ""; // YYYY-MM of last run
  const tick = async () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Only fire on the 1st of the month and at most once per calendar month.
    if (now.getDate() === 1 && ym !== lastRunYearMonth) {
      try {
        await runMonthlyComplianceSweep();
        lastRunYearMonth = ym;
      } catch (err) {
        console.error("[monthly-compliance] sweep failed:", err);
      }
    }
  };
  // Once on boot if requested.
  if (process.env.MONTHLY_COMPLIANCE_ON_BOOT === "1") {
    void runMonthlyComplianceSweep();
  }
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  console.log("[monthly-compliance] hourly check armed — fires on 1st of each month");
}

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
