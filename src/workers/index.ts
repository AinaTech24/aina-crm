/**
 * Worker process entry point. Run via `npm run worker`.
 *
 * Starts every background worker in a single Node process. In production
 * with higher load, split into multiple processes by passing
 * `WORKER_GROUPS=outbox,wf,seg` etc.
 */

import v8 from "node:v8";
import "dotenv/config";
import { startOutboxPollerWorker } from "./outbox-poller";
import { startWorkflowRunnerWorker } from "./workflow-runner";
import { startSegmentMaterializerWorker } from "./segment-materializer";
import { startMasterSchedulerWorker } from "./master-scheduler";
import { startWorkflowRulesSchedulerWorker } from "./workflow-rules-scheduler";
import { startWorkflowRulesTimeScannerWorker } from "./workflow-rules-time-scanner";
import { startBlueprintSLAWorker } from "./blueprint-sla-worker";
import { startScheduledCommsWorker } from "./scheduled-comms";
import { startReportSchedulerWorker } from "./report-scheduler";
import { startTaskReminderScannerWorker } from "./task-reminder-scanner";
import { startVartifyTemplateSyncWorker } from "./vartify-template-sync";
import { startCampaignDispatcherWorker } from "./campaign-dispatcher";
import { startImapPollerWorker } from "./imap-poller";
import { startRtaInboxPollerWorker } from "./rta-inbox-poller";
import { startZohoSyncWorker } from "./zoho-sync";
import { startRtaImportWorker } from "./rta-import-worker";
import { startDailyBriefingWorker } from "./daily-briefing";
import { startWeeklyDigestWorker } from "./weekly-digest";
import { runDailyOpsScan } from "./daily-ops-scanner";
import { runKycRefresh } from "@/lib/kyc/refresh";
import { runMonthlyComplianceSweep } from "./monthly-compliance-seeder";
import { runReconciliationScan } from "./reconciliation-scanner";
import { runAumRefresh } from "./aum-refresh";
import { runHoldingsReconciliation } from "./reconciliation-holdings";
import { runMarketScan } from "./market-scanner";
import { runFeedIngest } from "./feed-ingest";
import { runStatementScheduler } from "./statement-scheduler";
import { refreshNav } from "@/lib/finance/nav-feed";
import { syncMfSchemeCatalog, enrichMfSchemes } from "@/lib/finance/mfapi";
import { describeRun, getLastRun, recordRun } from "./scheduler-state";
import { recordDailySnapshots } from "./firm-snapshot-recorder";
import { runDscReminder } from "./dsc-reminder";
import { runReviewDueReminder } from "./review-due-reminder";
import { captureError } from "@/lib/observability/capture";

const groups = (process.env.WORKER_GROUPS ?? "outbox,wf,seg,sched,wa_sync,mail,ops,monthly,nav,recon,market,feed,statements,zoho,rta,briefing")
  .split(",")
  .map((s) => s.trim());
// 'sched' covers the scheduled-comms drain too (kept with the other schedulers).

const stops: Array<() => void> = [];

/**
 * Schedule a once-a-day fixed-time job with MISSED-RUN CATCH-UP + run recording.
 *
 * On boot, if today's scheduled time already passed and the job's last recorded
 * run predates it (process was down at that moment), it runs immediately instead
 * of silently skipping the day. Every run records a watermark + heartbeat in
 * `scheduler_state` so a readiness probe can tell automation is alive.
 */
function scheduleDaily(
  group: string,
  jobName: string,
  hour: number,
  minute: number,
  fn: () => Promise<unknown>,
  bootEnv?: string
) {
  if (!groups.includes(group)) return;

  const run = async (reason: string) => {
    try {
      // Read the job's OWN report rather than assuming a returned promise means
      // success — see describeRun: a swallowed per-tenant failure was being
      // recorded as "ok" every night.
      const result = await fn();
      const { status, detail } = describeRun(result, reason);
      await recordRun(jobName, status, detail);
    } catch (err) {
      captureError(`[${jobName}] ${reason} run failed`, err);
      await recordRun(jobName, "error", (err as Error)?.message);
    }
  };

  // Missed-run catch-up.
  void (async () => {
    const now = new Date();
    const scheduledToday = new Date(now);
    scheduledToday.setHours(hour, minute, 0, 0);
    if (now >= scheduledToday) {
      const last = await getLastRun(jobName);
      if (!last || last < scheduledToday) {
        console.log(`[${jobName}] missed today's ${hour}:${String(minute).padStart(2, "0")} run — catching up now`);
        await run("catchup");
      }
    }
    if (bootEnv && process.env[bootEnv] === "1") await run("boot");
  })();

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    const t = setTimeout(async () => {
      await run("scheduled");
      scheduleNext();
    }, delayMs);
    t.unref?.();
    stops.push(() => clearTimeout(t));
    console.log(`[${jobName}] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)} min)`);
  };
  scheduleNext();
}

if (groups.includes("outbox")) stops.push(startOutboxPollerWorker());
if (groups.includes("wf")) stops.push(startWorkflowRunnerWorker());
if (groups.includes("seg")) stops.push(startSegmentMaterializerWorker());
if (groups.includes("sched")) {
  stops.push(startMasterSchedulerWorker());
  stops.push(startWorkflowRulesSchedulerWorker());
  stops.push(startWorkflowRulesTimeScannerWorker());
  stops.push(startBlueprintSLAWorker());
  stops.push(startScheduledCommsWorker());
  stops.push(startCampaignDispatcherWorker());
  stops.push(startReportSchedulerWorker());
  // Task due-date/reminder sweep — fires overdue alerts (previously never
  // triggered) + per-task reminders every 5 min.
  stops.push(startTaskReminderScannerWorker());
}
if (groups.includes("wa_sync")) stops.push(startVartifyTemplateSyncWorker());
if (groups.includes("mail")) {
  stops.push(startImapPollerWorker());
  // Direct RTA mailback auto-import: polls the catch-all inbox MFDs forward to.
  stops.push(startRtaInboxPollerWorker());
}
if (groups.includes("zoho")) stops.push(startZohoSyncWorker());
if (groups.includes("rta")) {
  stops.push(startRtaImportWorker());
  // FP mailback import shares the "rta" worker group (same import surface).
}
// Morning briefing — 8 AM IST digest (in-app + email) per RM/owner. The worker
// computes the IST window itself (server clock is UTC) and dedupes per day, so
// a plain interval registration is correct here (not scheduleDaily/local-time).
if (groups.includes("briefing")) {
  stops.push(startDailyBriefingWorker());
  // Monday "your firm this week" digest for owners/branch heads (9 AM IST).
  stops.push(startWeeklyDigestWorker());
}

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
scheduleDaily("ops", "daily-ops-scanner", 6, 30, runDailyOpsScan, "DAILY_OPS_ON_BOOT");

/**
 * KYC status from the KRA, by PAN, through each firm's own NSE MF Invest
 * connection (lib/kyc/refresh.ts). 02:30 UTC = 08:00 IST, inside NSE's working
 * day. Only firms that saved their keys and left the daily refresh on; one call
 * at a time, oldest check first, capped per firm.
 */
scheduleDaily("ops", "kyc-status-refresh", 2, 30, runKycRefresh, "KYC_REFRESH_ON_BOOT");

/**
 * Daily firm snapshot — records each tenant's AUM / clients / SIP book at 00:05
 * local, powering the copilot's AUM/SIP trend. Scheduled early so the missed-run
 * catch-up in scheduleDaily seeds the very first data point immediately on the
 * deploy that ships this (00:05 has already passed on any normal-hours deploy).
 */
scheduleDaily("ops", "daily-firm-snapshot", 0, 5, recordDailySnapshots, "FIRM_SNAPSHOT_ON_BOOT");

/**
 * DDQ 4.26 — annual Declaration of Self-Certification. Checked daily at 07:00
 * (cheap: it no-ops the moment the FY's DSC is recorded) so the reminder lands
 * as soon as the new financial year opens and stays until the DSC is filed.
 */
scheduleDaily("ops", "dsc-reminder", 7, 0, runDscReminder, "DSC_REMINDER_ON_BOOT");

/**
 * Client review-due reminder — raises a task (7-day lead) AND an in-app bell
 * alert on the due date for each client whose review cadence falls due.
 * Cadence-agnostic: it covers the presets AND a custom "every N days"
 * schedule such as every 100 days.
 *
 * Hourly, not daily, and once on boot: an RM who logs a review today expects
 * the reminder to appear when it comes due, not up to 24h later. Both the task
 * and the notification are idempotent on (client, due date), so a re-run inside
 * the same day is a no-op — the extra ticks cost one indexed query per tenant.
 */
if (groups.includes("ops")) {
  const tick = async () => {
    try {
      await runReviewDueReminder();
    } catch (err) {
      console.error("[review-due] tick failed:", (err as Error).message);
    }
  };
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  void tick();
  console.log("[review-due] armed (hourly + on boot)");
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
 * Download the AMFI feed, then save every client's AUM at those prices — one
 * chain, so the AUM can never be saved before the NAVs it needs, including on
 * the catch-up run after a restart (src/workers/aum-refresh.ts).
 *
 * `onlyIfChanged` is for the extra runs through the day: AMFI publishes from the
 * evening of the NAV date through the next morning, one fund house after
 * another, so a single 06:00 download leaves late publishers on the day before
 * until the next 06:00 — a day behind, every day. A run that finds no new NAV
 * stops after the download; one that does re-saves the AUM.
 *
 * Runs are queued one behind another: several catch-ups can fire together after
 * a restart, and two downloads upserting scheme_nav at once would only fight.
 */
let navChain: Promise<unknown> = Promise.resolve();
function refreshNavAndAum(tag: string, onlyIfChanged: boolean) {
  const job = async () => {
    let navError: unknown = null;
    let changed = 1;
    try {
      const r = await refreshNav();
      changed = r.changed;
      console.log(`[${tag}] upserted ${r.written} schemes, ${r.changed} with a new NAV (nav date ~${r.navDate})`);
    } catch (err) {
      // A failed download leaves the NAVs we have, but new registrar data still
      // needs its AUM saved. Record the failure after the refresh has run.
      navError = err;
      captureError(`[${tag}] AMFI download failed`, err);
    }
    let aum: unknown = { navChanged: changed };
    if (!onlyIfChanged || (changed > 0 && !navError)) aum = await runAumRefresh();
    if (navError) throw navError;
    return aum;
  };
  const run = navChain.then(job, job);
  navChain = run.catch(() => undefined);
  return run;
}

/**
 * Daily NAV refresh — 06:00 local, always followed by the AUM save. This is
 * what keeps live portfolio valuation + XIRR current. Self-scheduled tick, same
 * rationale as the daily-ops scanner (single sweep, not per-tenant).
 *
 * It must run BEFORE the 06:30 daily-ops scanner (which reads the saved AUM). At
 * 07:00 it ran after it, so the stored AUM the dashboards read was a day behind
 * the client page's live figure (15 Oct 2026: Ahpal Rs 720.45 Cr stored vs
 * Rs 726.47 Cr on the pages).
 *
 * The AUM save follows the download in this same chain (aum-refresh.ts): it used
 * to sit inside the scan transaction, where any other section failing rolled
 * every firm back.
 */
scheduleDaily("nav", "nav-refresh", 6, 0, () => refreshNavAndAum("nav-refresh", false), "NAV_REFRESH_ON_BOOT");

/**
 * Extra NAV passes through AMFI's publishing window (22:00 and 23:30 the night
 * of the NAV date; 09:00 and 12:00 for the slow publishers). Each re-saves the
 * AUM only when the download brought a new NAV, so a quiet pass costs one
 * download. Job names are separate so each has its own missed-run catch-up.
 */
for (const [name, hour, minute] of [
  ["nav-refresh-2200", 22, 0],
  ["nav-refresh-2330", 23, 30],
  ["nav-refresh-0900", 9, 0],
  ["nav-refresh-1200", 12, 0],
] as const) {
  scheduleDaily("nav", name, hour, minute, () => refreshNavAndAum(name, true));
}

/**
 * Daily MF scheme catalog sync — pulls the full scheme list from mfapi.in at
 * 05:30 (before the AMFI NAV refresh) and progressively enriches scheme detail
 * (fund house / type / category / latest NAV). Platform-shared (mf_schemes),
 * so every MFD tenant gets the same up-to-date scheme + AMC + NAV catalog,
 * which powers the scheme/AMC autocomplete. Lives in the "nav" group.
 */
scheduleDaily(
  "nav",
  "mfapi-catalog",
  5,
  30,
  async () => {
    const c = await syncMfSchemeCatalog();
    const e = await enrichMfSchemes(1500);
    console.log(`[mfapi-catalog] upserted ${c.written}/${c.fetched} schemes; enriched ${e.updated}/${e.scanned}`);
  },
  "MFAPI_SYNC_ON_BOOT"
);

/**
 * Reconciliation scanner — fires once a day at 07:30 local (after the 06:00
 * NAV refresh). Turns newly-ingested RTA transactions (redemptions, SIP
 * bounces) into automation events so the recipes chase them hands-off, and
 * reports AUM drift. Self-scheduled tick, same rationale as the ops scanner.
 */
scheduleDaily(
  "recon",
  "reconciliation-scanner",
  7,
  30,
  async () => {
    await runReconciliationScan();
    // Three-way holdings reconciliation right after — reconciles the freshly
    // ingested feed against the CRM ledger + live NAV and writes exceptions.
    await runHoldingsReconciliation();
  },
  "RECON_ON_BOOT"
);

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
scheduleDaily(
  "statements",
  "statement-scheduler",
  8,
  0,
  async () => {
    const r = await runStatementScheduler();
    if (r.sent > 0) console.log(`[statement-scheduler] sent ${r.sent} auto-statement(s)`);
  },
  "STATEMENTS_ON_BOOT"
);

// Last-resort safety net: a floating rejection or uncaught exception in any
// tick must NOT silently crash the whole worker (taking down every automation).
// Log + report; keep the process alive so PM2 doesn't churn-restart and lose a
// fixed-time window. A truly fatal error still surfaces loudly via captureError.
process.on("unhandledRejection", (reason) => {
  captureError("[worker] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  captureError("[worker] uncaughtException", err);
});

console.log(`✓ Worker process up. Groups: ${groups.join(", ")}`);

// Memory shape every 5 minutes (heap used / total / RSS / external, with the peaks since
// boot), so a heap cap for the worker can be chosen from measurements. Read-only; unref'd
// so it never keeps the process alive.
{
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  let peakRss = 0;
  let peakHeap = 0;
  const logMem = () => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    console.log(
      `[mem] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB ` +
        `arrayBuffers=${mb(m.arrayBuffers)}MB heapLimit=${mb(v8.getHeapStatistics().heap_size_limit)}MB peakRss=${mb(peakRss)}MB peakHeap=${mb(peakHeap)}MB`
    );
  };
  setInterval(logMem, 5 * 60 * 1000).unref();
  setTimeout(logMem, 60 * 1000).unref();
}

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
