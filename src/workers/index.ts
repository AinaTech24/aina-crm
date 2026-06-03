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
import { startWorkflowRulesSchedulerWorker } from "./workflow-rules-scheduler";
import { startBlueprintSLAWorker } from "./blueprint-sla-worker";
import { startScheduledCommsWorker } from "./scheduled-comms";
import { startReportSchedulerWorker } from "./report-scheduler";
import { startAiSensyTemplateSyncWorker } from "./aisensy-template-sync";
import { startCampaignDispatcherWorker } from "./campaign-dispatcher";
import { runDailyOpsScan } from "./daily-ops-scanner";
import { runMonthlyComplianceSweep } from "./monthly-compliance-seeder";
import { runReconciliationScan } from "./reconciliation-scanner";
import { runHoldingsReconciliation } from "./reconciliation-holdings";
import { runMarketScan } from "./market-scanner";
import { runFeedIngest } from "./feed-ingest";
import { runStatementScheduler } from "./statement-scheduler";
import { refreshNav } from "@/lib/finance/nav-feed";

const groups = (process.env.WORKER_GROUPS ?? "outbox,wf,seg,sched,wa_sync,ops,monthly,nav,recon,market,feed,statements")
  .split(",")
  .map((s) => s.trim());
// 'sched' covers the scheduled-comms drain too (kept with the other schedulers).

const stops: Array<() => void> = [];

if (groups.includes("outbox")) stops.push(startOutboxPollerWorker());
if (groups.includes("wf")) stops.push(startWorkflowRunnerWorker());
if (groups.includes("seg")) stops.push(startSegmentMaterializerWorker());
if (groups.includes("sched")) {
  stops.push(startMasterSchedulerWorker());
  stops.push(startWorkflowRulesSchedulerWorker());
  stops.push(startBlueprintSLAWorker());
  stops.push(startScheduledCommsWorker());
  stops.push(startCampaignDispatcherWorker());
  stops.push(startReportSchedulerWorker());
}
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

/**
 * Daily NAV refresh — downloads the AMFI NAVAll feed once a day at 07:00 local
 * time (after the prior day's NAVs are published) and upserts scheme_nav. This
 * is what keeps live portfolio valuation + XIRR current. Self-scheduled tick,
 * same rationale as the daily-ops scanner (single sweep, not per-tenant).
 */
if (groups.includes("nav")) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(7, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    const t = setTimeout(async () => {
      try {
        const r = await refreshNav();
        console.log(`[nav-refresh] upserted ${r.written} schemes (nav date ~${r.navDate})`);
      } catch (err) {
        console.error("[nav-refresh] failed:", (err as Error).message);
      }
      scheduleNext();
    }, delayMs);
    t.unref?.();
    stops.push(() => clearTimeout(t));
    console.log(
      `[nav-refresh] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)} min)`
    );
  };
  if (process.env.NAV_REFRESH_ON_BOOT === "1") {
    void refreshNav().then((r) =>
      console.log(`[nav-refresh] boot run upserted ${r.written} schemes`)
    );
  }
  scheduleNext();
}

/**
 * Reconciliation scanner — fires once a day at 07:30 local (after the 07:00
 * NAV refresh). Turns newly-ingested RTA transactions (redemptions, SIP
 * bounces) into automation events so the recipes chase them hands-off, and
 * reports AUM drift. Self-scheduled tick, same rationale as the ops scanner.
 */
if (groups.includes("recon")) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(7, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    const t = setTimeout(async () => {
      try {
        await runReconciliationScan();
        // Three-way holdings reconciliation right after — reconciles the freshly
        // ingested feed against the CRM ledger + live NAV and writes exceptions.
        await runHoldingsReconciliation();
      } catch (err) {
        console.error("[reconciliation-scanner] sweep failed:", (err as Error).message);
      }
      scheduleNext();
    }, delayMs);
    t.unref?.();
    stops.push(() => clearTimeout(t));
    console.log(
      `[reconciliation-scanner] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)} min)`
    );
  };
  if (process.env.RECON_ON_BOOT === "1") {
    void runReconciliationScan().then((r) =>
      console.log(`[reconciliation-scanner] boot run:`, r.totals)
    );
  }
  scheduleNext();
}

/**
 * Market scanner — ticks hourly. Reads the configured index feed and, on a
 * qualifying NIFTY drop, fans out one `market.nifty_drop` event per
 * marketing-opted-in investor (the market_volatility_broadcast recipe consumes
 * it). No-ops when no index feed is configured. The per-day dedup index makes
 * the hourly cadence safe (at most one nudge per client per drop day).
 */
if (groups.includes("market")) {
  const tick = async () => {
    try {
      const r = await runMarketScan();
      if (r.qualified) {
        console.log(
          `[market-scanner] drop ${r.changePct}% ≤ ${r.thresholdPct}% — emitted ${r.emitted} nudge(s)`
        );
      }
    } catch (err) {
      console.error("[market-scanner] tick failed:", (err as Error).message);
    }
  };
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  if (process.env.MARKET_SCAN_ON_BOOT === "1") void tick();
  console.log("[market-scanner] hourly market-drop watch armed");
}

/**
 * Live CAMS/KFin feed ingestion — polls the RTA drop folder every 15 minutes
 * and runs new files through the processor. No-ops when RTA_FEED_DIR is unset.
 * RTAs deliver daily; the short poll just means files are picked up promptly.
 */
if (groups.includes("feed")) {
  const tick = async () => {
    try {
      const r = await runFeedIngest();
      if (r.enabled && r.filesFound > 0) {
        console.log(`[feed-ingest] ${r.filesIngested} ingested, ${r.filesFailed} failed of ${r.filesFound} file(s)`);
      }
    } catch (err) {
      console.error("[feed-ingest] tick failed:", (err as Error).message);
    }
  };
  const interval = setInterval(tick, 15 * 60 * 1000); // every 15 min
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  if (process.env.FEED_INGEST_ON_BOOT === "1") void tick();
  console.log("[feed-ingest] RTA drop-folder watch armed (15 min)");
}

/**
 * Scheduled auto-statements — once a day at 08:00 local, emails the live PDF
 * statement to every client whose cadence (monthly/quarterly) is due. The
 * per-period watermark means it sends each client at most once per period.
 */
if (groups.includes("statements")) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(8, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    const t = setTimeout(async () => {
      try {
        const r = await runStatementScheduler();
        if (r.sent > 0) console.log(`[statement-scheduler] sent ${r.sent} auto-statement(s)`);
      } catch (err) {
        console.error("[statement-scheduler] run failed:", (err as Error).message);
      }
      scheduleNext();
    }, delayMs);
    t.unref?.();
    stops.push(() => clearTimeout(t));
    console.log(`[statement-scheduler] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)} min)`);
  };
  if (process.env.STATEMENTS_ON_BOOT === "1") void runStatementScheduler();
  scheduleNext();
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
