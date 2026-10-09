/**
 * When the RTA posting reconciliation runs, the record of every run, and the
 * monitor that notices when it did not (final security patch, P1; migration
 * 0244).
 *
 * Schedule: once a day at 06:30 in Asia/Kolkata (RTA_RECON_TIME_IST, "HH:MM").
 * The slot is computed in IST explicitly — India has no daylight saving, so a
 * fixed +05:30 offset is exact — and never from the host clock's time zone (a
 * UTC host used to run the "06:30" job at 12:00 IST).
 *
 * Every run is a row in rta_reconciliation_runs (slot date, scheduled time,
 * time zone, trigger, start, heartbeat, completion, outcome, firm counts) with
 * one rta_reconciliation_run_firms row per firm checked. One scheduled or
 * catch-up run per slot: the database refuses a second (unique index), so two
 * workers never both run it.
 *
 * reconMonitorTick (every minute from the worker's "ops" group; no Redis
 * involved) does five things:
 *   1. records the monitor's own heartbeat (scheduler_state
 *      'rta-reconciliation-monitor'), which the web health probe reads;
 *   2. marks a run whose heartbeat stopped (worker killed or crashed mid-run)
 *      `incomplete` and raises a critical alert;
 *   3. runs the due slot — on time (within RTA_RECON_GRACE_MIN, 15) as
 *      `schedule`, later as `catch_up` with a "missed" alert;
 *   4. delivers / retries / escalates persisted alerts;
 *   5. pings OPS_HEARTBEAT_URL (an external dead-man's switch), so a worker
 *      that stops entirely is noticed outside this system too.
 *
 * reconHealth is the same picture read from the database by the WEB process
 * (GET /api/health/rta-reconciliation): it does not depend on the worker, and
 * when the worker's heartbeat is missing it raises and delivers that alert
 * itself.
 */
import os from "node:os";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { captureError } from "@/lib/observability/capture";
import { deliverDueAlerts, maskSensitive, raiseOpsAlert, type DeliveryReport, type Fetch } from "@/lib/ops/alerts";
import { listPostingFirms, reconcileFirm, type FirmReconciliation } from "./monitor";

type Tx = any;

export const RECON_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MIN = 330; // +05:30, no daylight saving
export const MONITOR_JOB = "rta-reconciliation-monitor";

export function reconPolicy(env: NodeJS.ProcessEnv = process.env) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((env.RTA_RECON_TIME_IST ?? "06:30").trim());
  const hour = m ? Number(m[1]) : 6;
  const minute = m ? Number(m[2]) : 30;
  if (!m || hour > 23 || minute > 59) throw new Error(`RTA_RECON_TIME_IST must be HH:MM in IST (got "${env.RTA_RECON_TIME_IST}")`);
  const num = (k: string, d: number, min: number) => Math.max(Number(env[k] ?? d) || d, min);
  return {
    hour, minute, timeZone: RECON_TIME_ZONE,
    graceMinutes: num("RTA_RECON_GRACE_MIN", 15, 1),
    staleRunSeconds: num("RTA_RECON_STALE_SEC", 900, 1),
    monitorStaleMinutes: num("RTA_RECON_MONITOR_STALE_MIN", 10, 1),
    tickMs: num("RTA_RECON_TICK_MS", 60_000, 1_000),
    heartbeatUrl: env.OPS_HEARTBEAT_URL || "",
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The latest slot due at `now`: its IST date and the instant it was scheduled for. */
export function dueSlot(now: Date, env: NodeJS.ProcessEnv = process.env): { slotDate: string; scheduledFor: Date } {
  const p = reconPolicy(env);
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000); // wall clock in IST, read with UTC getters
  let y = ist.getUTCFullYear(), mo = ist.getUTCMonth(), d = ist.getUTCDate();
  let at = Date.UTC(y, mo, d, p.hour, p.minute) - IST_OFFSET_MIN * 60_000;
  if (at > now.getTime()) {
    const prev = new Date(Date.UTC(y, mo, d) - 864e5);
    y = prev.getUTCFullYear(); mo = prev.getUTCMonth(); d = prev.getUTCDate();
    at = Date.UTC(y, mo, d, p.hour, p.minute) - IST_OFFSET_MIN * 60_000;
  }
  return { slotDate: `${y}-${pad(mo + 1)}-${pad(d)}`, scheduledFor: new Date(at) };
}

/** "06:30 IST" — for messages and the handover. */
export const describeSchedule = (env: NodeJS.ProcessEnv = process.env) => {
  const p = reconPolicy(env);
  return `${pad(p.hour)}:${pad(p.minute)} ${p.timeZone} (IST, UTC+05:30)`;
};

export type ReconRun = {
  runId: string | null; skipped?: "slot_already_run"; status: "ok" | "discrepancy" | "failed" | null;
  firms: FirmReconciliation[];
};

/** Injection points for drills and tests: which firms, and the per-firm check (default reconcilePosting). */
type RunDeps = { listFirms?: () => Promise<string[]>; check?: (tenantId: string) => Promise<Record<string, number>> };

/**
 * Run the reconciliation once and record it. A `schedule` / `catch_up` run
 * claims its slot first; when the slot is already taken (run, running, or
 * failed) it does nothing. A `manual` run is always recorded separately.
 */
export async function runReconciliation(opts: { trigger: "schedule" | "catch_up" | "manual"; now?: Date; worker?: string; env?: NodeJS.ProcessEnv } & RunDeps): Promise<ReconRun> {
  const env = opts.env ?? process.env;
  const slot = dueSlot(opts.now ?? new Date(), env);
  const worker = opts.worker ?? `${os.hostname()}:${process.pid}`;
  const listFirms = opts.listFirms ?? listPostingFirms;

  const claimed = await withSystem(async (tx: Tx) => (await tx.execute(opts.trigger === "manual"
    ? sql`INSERT INTO rta_reconciliation_runs (slot_date, scheduled_for, schedule_timezone, trigger, worker)
          VALUES (${slot.slotDate}::date, now(), ${RECON_TIME_ZONE}, 'manual', ${worker}) RETURNING id::text AS id`
    : sql`INSERT INTO rta_reconciliation_runs (slot_date, scheduled_for, schedule_timezone, trigger, worker)
          VALUES (${slot.slotDate}::date, ${slot.scheduledFor.toISOString()}::timestamptz, ${RECON_TIME_ZONE}, ${opts.trigger}, ${worker})
          ON CONFLICT (slot_date) WHERE trigger IN ('schedule', 'catch_up') AND status IN ('running', 'ok', 'discrepancy', 'failed') DO NOTHING
          RETURNING id::text AS id`)).rows[0] as { id: string } | undefined);
  if (!claimed) return { runId: null, skipped: "slot_already_run", status: null, firms: [] };
  const runId = claimed.id;

  const firms: FirmReconciliation[] = [];
  try {
    for (const tenantId of await listFirms()) {
      const r = await reconcileFirm(tenantId, { runId, check: opts.check });
      firms.push(r);
      await withSystem(async (tx: Tx) => {
        await tx.execute(sql`
          INSERT INTO rta_reconciliation_run_firms (run_id, tenant_id, ok, counts, error)
          VALUES (${runId}::uuid, ${tenantId}::uuid, ${r.ok}, ${JSON.stringify(r.counts)}::jsonb, ${r.error ?? null})`);
        await tx.execute(sql`UPDATE rta_reconciliation_runs SET heartbeat_at = now() WHERE id = ${runId}::uuid`);
      });
    }
    const failed = firms.filter((f) => f.error).length;
    const discrepant = firms.filter((f) => !f.ok && !f.error).length;
    const status = failed ? "failed" : discrepant ? "discrepancy" : "ok";
    await withSystem((tx: Tx) => tx.execute(sql`
      UPDATE rta_reconciliation_runs SET status = ${status}, completed_at = now(), heartbeat_at = now(),
             firms_checked = ${firms.length}, firms_with_discrepancy = ${discrepant},
             error = ${failed ? `${failed} firm(s) could not be checked` : null}
       WHERE id = ${runId}::uuid AND status = 'running'`));
    return { runId, status, firms };
  } catch (e) {
    const error = maskSensitive(String((e as Error)?.message ?? e)).slice(0, 300);
    captureError("[rta-reconciliation] run failed", e, { runId });
    await withSystem(async (tx: Tx) => {
      await tx.execute(sql`
        UPDATE rta_reconciliation_runs SET status = 'failed', completed_at = now(), firms_checked = ${firms.length}, error = ${error}
         WHERE id = ${runId}::uuid AND status = 'running'`);
      await raiseOpsAlert(tx, {
        kind: "rta.reconciliation.failed", severity: "critical", dedupKey: `recon:failed:${slot.slotDate}`,
        summary: `The RTA posting reconciliation for ${slot.slotDate} failed before it finished; firms not yet checked are unverified.`,
        details: { runId, slotDate: slot.slotDate, firmsChecked: firms.length, error },
      });
    }).catch(() => {});
    return { runId, status: "failed", firms };
  }
}

export type TickReport = {
  slot: { slotDate: string; scheduledFor: string }; incomplete: string[]; ran: ReconRun | null;
  missed: boolean; delivery: DeliveryReport | null; heartbeatPinged: boolean | null;
};

/** One monitor pass. Safe to call from several workers at once and on every boot. */
export async function reconMonitorTick(opts: { now?: Date; env?: NodeJS.ProcessEnv; fetchImpl?: Fetch; worker?: string } & RunDeps = {}): Promise<TickReport> {
  const env = opts.env ?? process.env;
  const p = reconPolicy(env);
  const now = opts.now ?? new Date();
  const slot = dueSlot(now, env);
  const out: TickReport = { slot: { slotDate: slot.slotDate, scheduledFor: slot.scheduledFor.toISOString() }, incomplete: [], ran: null, missed: false, delivery: null, heartbeatPinged: null };

  // 1. The monitor is alive.
  await withSystem((tx: Tx) => tx.execute(sql`
    INSERT INTO scheduler_state (job_name, last_heartbeat_at, updated_at) VALUES (${MONITOR_JOB}, now(), now())
    ON CONFLICT (job_name) DO UPDATE SET last_heartbeat_at = now(), updated_at = now()`));

  // 2. A run whose heartbeat stopped did not finish: the worker stopped or crashed mid-run.
  await withSystem(async (tx: Tx) => {
    const dead = (await tx.execute(sql`
      UPDATE rta_reconciliation_runs SET status = 'incomplete', completed_at = now(),
             error = ${`no heartbeat for more than ${p.staleRunSeconds} s — the worker stopped or crashed during the run`}
       WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => ${p.staleRunSeconds}::int)
       RETURNING id::text AS id, slot_date::text AS slot, trigger, worker,
                 (SELECT count(*) FROM rta_reconciliation_run_firms f WHERE f.run_id = rta_reconciliation_runs.id)::int AS firms_done`)).rows as any[];
    for (const r of dead) {
      out.incomplete.push(r.id);
      await raiseOpsAlert(tx, {
        kind: "rta.reconciliation.incomplete", severity: "critical", dedupKey: `recon:incomplete:${r.id}`,
        summary: `The RTA posting reconciliation for ${r.slot} stopped part-way (worker stopped or crashed). A catch-up run follows; until it completes, firms are unverified.`,
        details: { runId: r.id, slotDate: r.slot, trigger: r.trigger, worker: r.worker, firmsCheckedBeforeStop: r.firms_done },
      });
    }
  });

  // 3. The due slot.
  const taken = await withSystem(async (tx: Tx) => (await tx.execute(sql`
    SELECT 1 FROM rta_reconciliation_runs WHERE slot_date = ${slot.slotDate}::date
       AND trigger IN ('schedule', 'catch_up') AND status IN ('running', 'ok', 'discrepancy', 'failed') LIMIT 1`)).rows.length > 0);
  if (!taken) {
    const late = now.getTime() - slot.scheduledFor.getTime() > p.graceMinutes * 60_000;
    const hadIncomplete = await withSystem(async (tx: Tx) => (await tx.execute(sql`
      SELECT 1 FROM rta_reconciliation_runs WHERE slot_date = ${slot.slotDate}::date AND status = 'incomplete' LIMIT 1`)).rows.length > 0);
    if (late && !hadIncomplete) {
      out.missed = true;
      await withSystem((tx: Tx) => raiseOpsAlert(tx, {
        kind: "rta.reconciliation.missed", severity: "warning", dedupKey: `recon:missed:${slot.slotDate}`,
        summary: `The RTA posting reconciliation scheduled for ${describeSchedule(env)} on ${slot.slotDate} did not run on time (worker or scheduler was down). It is being caught up now.`,
        details: { slotDate: slot.slotDate, scheduledFor: slot.scheduledFor.toISOString(), detectedAt: now.toISOString() },
      }));
    }
    out.ran = await runReconciliation({ trigger: late || hadIncomplete ? "catch_up" : "schedule", now, worker: opts.worker, env, listFirms: opts.listFirms, check: opts.check });
  }

  // 4. Alerts.
  out.delivery = await deliverDueAlerts({ fetchImpl: opts.fetchImpl, env });

  // 5. External dead-man's switch: no ping → the external service notifies on its own.
  if (p.heartbeatUrl) {
    try {
      const f = opts.fetchImpl ?? (fetch as unknown as Fetch);
      const res = await f(p.heartbeatUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: MONITOR_JOB, at: now.toISOString() }) });
      out.heartbeatPinged = res.ok;
    } catch {
      out.heartbeatPinged = false;
    }
  }
  return out;
}

export type ReconHealth = {
  ok: boolean; problems: string[]; schedule: string;
  monitor: { lastHeartbeatAt: string | null; ageMinutes: number | null };
  dueSlot: { slotDate: string; scheduledFor: string };
  lastRun: { slotDate: string; trigger: string; status: string; startedAt: string; completedAt: string | null; firmsChecked: number | null; firmsWithDiscrepancy: number | null } | null;
  alerts: { open: number; undeliverable: number; escalated: number; unacknowledgedCritical: number };
};

/**
 * The reconciliation's health, read from the database alone (no worker, no
 * Redis). Aggregates only — no firm, client or figure.
 */
export async function reconHealth(opts: { now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<ReconHealth> {
  const env = opts.env ?? process.env;
  const p = reconPolicy(env);
  const now = opts.now ?? new Date();
  const slot = dueSlot(now, env);
  return withSystem(async (tx: Tx) => {
    const hb = (await tx.execute(sql`SELECT last_heartbeat_at, EXTRACT(EPOCH FROM (now() - last_heartbeat_at)) / 60.0 AS age FROM scheduler_state WHERE job_name = ${MONITOR_JOB}`)).rows[0] as any;
    const slotRun = (await tx.execute(sql`
      SELECT status FROM rta_reconciliation_runs WHERE slot_date = ${slot.slotDate}::date AND trigger IN ('schedule', 'catch_up')
       ORDER BY started_at DESC LIMIT 1`)).rows[0] as any;
    const last = (await tx.execute(sql`
      SELECT slot_date::text, trigger, status, started_at, completed_at, firms_checked, firms_with_discrepancy, heartbeat_at,
             heartbeat_at < now() - make_interval(secs => ${p.staleRunSeconds}::int) AS stale
        FROM rta_reconciliation_runs WHERE trigger IN ('schedule', 'catch_up') ORDER BY started_at DESC LIMIT 1`)).rows[0] as any;
    const a = (await tx.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
             count(*) FILTER (WHERE status = 'open' AND delivery_state = 'undeliverable')::int AS undeliverable,
             count(*) FILTER (WHERE status = 'open' AND escalated_at IS NOT NULL)::int AS escalated,
             count(*) FILTER (WHERE status = 'open' AND severity = 'critical')::int AS critical
        FROM ops_alerts`)).rows[0] as any;

    const problems: string[] = [];
    const age = hb?.age == null ? null : Number(hb.age);
    if (age == null) problems.push("the reconciliation monitor has never run (is the worker's ops group running?)");
    else if (age > p.monitorStaleMinutes) problems.push(`no heartbeat from the reconciliation monitor for ${Math.round(age)} minutes — the worker or its scheduler has stopped`);
    const late = now.getTime() - slot.scheduledFor.getTime() > p.graceMinutes * 60_000;
    if (late && !slotRun) problems.push(`the ${slot.slotDate} reconciliation (${describeSchedule(env)}) has not run`);
    if (slotRun?.status === "incomplete") problems.push(`the ${slot.slotDate} reconciliation stopped part-way and has not been completed`);
    if (slotRun?.status === "failed") problems.push(`the ${slot.slotDate} reconciliation failed`);
    if (last?.status === "running" && last.stale) problems.push("a reconciliation run has stopped sending heartbeats (crashed or killed)");
    if (Number(a.undeliverable)) problems.push(`${a.undeliverable} alert(s) could not be delivered`);
    if (Number(a.critical)) problems.push(`${a.critical} critical alert(s) not yet acknowledged`);

    return {
      ok: problems.length === 0, problems, schedule: describeSchedule(env),
      monitor: { lastHeartbeatAt: hb?.last_heartbeat_at ? new Date(hb.last_heartbeat_at).toISOString() : null, ageMinutes: age == null ? null : Math.round(age * 10) / 10 },
      dueSlot: { slotDate: slot.slotDate, scheduledFor: slot.scheduledFor.toISOString() },
      lastRun: last ? {
        slotDate: last.slot_date, trigger: last.trigger, status: last.status, startedAt: new Date(last.started_at).toISOString(),
        completedAt: last.completed_at ? new Date(last.completed_at).toISOString() : null,
        firmsChecked: last.firms_checked, firmsWithDiscrepancy: last.firms_with_discrepancy,
      } : null,
      alerts: { open: Number(a.open), undeliverable: Number(a.undeliverable), escalated: Number(a.escalated), unacknowledgedCritical: Number(a.critical) },
    };
  });
}

/**
 * The web side of the independent monitor: when the worker's heartbeat is
 * missing (or the day's run did not happen), raise that alert and deliver it
 * from THIS process — a dead worker cannot notify anyone itself.
 */
export async function raiseHealthAlerts(h: ReconHealth, opts: { fetchImpl?: Fetch; env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;
  const p = reconPolicy(env);
  const workerDown = h.monitor.ageMinutes == null || h.monitor.ageMinutes > p.monitorStaleMinutes;
  const notRun = h.problems.some((x) => x.includes("has not run"));
  if (!workerDown && !notRun) return null;
  await withSystem(async (tx: Tx) => {
    if (workerDown) await raiseOpsAlert(tx, {
      kind: "ops.worker.heartbeat_missing", severity: "critical", dedupKey: `monitor:heartbeat_missing`,
      summary: "The background worker's reconciliation monitor has stopped sending heartbeats: scheduled reconciliation, alert retries and RTA automation are not running.",
      details: { lastHeartbeatAt: h.monitor.lastHeartbeatAt, ageMinutes: h.monitor.ageMinutes, detectedBy: "web health probe" },
    });
    if (notRun) await raiseOpsAlert(tx, {
      kind: "rta.reconciliation.missed", severity: "warning", dedupKey: `recon:missed:${h.dueSlot.slotDate}`,
      summary: `The RTA posting reconciliation scheduled for ${h.schedule} on ${h.dueSlot.slotDate} has not run.`,
      details: { slotDate: h.dueSlot.slotDate, scheduledFor: h.dueSlot.scheduledFor, detectedBy: "web health probe" },
    });
  });
  return deliverDueAlerts({ fetchImpl: opts.fetchImpl, env });
}
