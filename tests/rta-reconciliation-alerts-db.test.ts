/**
 * Final security patch, P1 — the RTA posting reconciliation is recorded,
 * monitored and its alerts are never silently lost (migration 0244).
 *
 * Against a real Postgres. The webhook is a stub fetch (no network), slots are
 * computed for dates far from today so a test never collides with a real run,
 * and the crash / Redis cases run the code in a separate process.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

const TEST_DB = process.env.TEST_DATABASE_URL;

const h = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([...h.headers.entries()]),
  cookies: async () => ({ get: (n: string) => (h.cookies.has(n) ? { name: n, value: h.cookies.get(n)! } : undefined) }),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;

/** A webhook stub: records every call; `plan(key)` decides each answer. */
function hook(plan: (key: string, n: number) => number | "throw" | Promise<number>) {
  const calls: Array<{ url: string; key: string; body: any }> = [];
  const perKey = new Map<string, number>();
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const key = init.headers["idempotency-key"] ?? "";
    const n = (perKey.get(key) ?? 0) + 1;
    perKey.set(key, n);
    calls.push({ url, key, body: JSON.parse(init.body) });
    const a = await plan(key, n);
    if (a === "throw") throw new Error("connect ECONNREFUSED https://user:secret@hooks.example.invalid");
    return { ok: a >= 200 && a < 300, status: a };
  };
  return { fetchImpl, calls, callsFor: (id: string, ch = "primary") => calls.filter((c) => c.key === `${id}:${ch}`) };
}

describe.skipIf(!TEST_DB)("RTA reconciliation runs, monitor and alerts (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let R: typeof import("@/lib/rta/posting/recon-schedule");
  let AL: typeof import("@/lib/ops/alerts");
  let ops: import("./helpers/two-person").Operators;
  const firmA = randomUUID();
  const firmB = randomUUID();
  // A unique far-future IST day per test (the slot index is global): 06:30 IST = 01:00 UTC.
  // The run starts AFTER every slot already recorded in this database, never at
  // a random year: slots persist between runs, and a random year re-drew an
  // earlier run's slots (4 distinct years in 5 runs) — each then read as
  // "already run" (B-1 stabilisation).
  let base = Date.UTC(2031, 0, 1, 1, 0);
  let day = 0;
  const nextSlot = () => new Date(base + (++day) * 864e5);
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env, OPS_ALERT_WEBHOOK_URL: "https://alerts.example.invalid/hook", OPS_ALERT_ESCALATION_WEBHOOK_URL: "",
    RTA_ALERT_RETRY_BASE_MS: "10", RTA_ALERT_RETRY_MAX_MS: "50", OPS_HEARTBEAT_URL: "", ...extra,
  }) as NodeJS.ProcessEnv;
  const q = async (s: any) => withSystem(async (tx) => (await tx.execute(s)).rows as any[]);
  const alertByKey = async (key: string) => (await q(sql`SELECT * FROM ops_alerts WHERE dedup_key = ${key} ORDER BY first_seen_at DESC LIMIT 1`))[0];
  const zeros = async () => ({ validateFirstTransactionWithoutLedger: 0, ledgerWithoutTransaction: 0 });
  const firms = (...ids: string[]) => async () => ids;
  const ackAllOpen = async (where: any) => {
    for (const r of await q(sql`SELECT id::text FROM ops_alerts WHERE status = 'open' AND ${where}`)) {
      await withSystem((tx) => AL.acknowledgeAlert(tx, { id: r.id, by: ops.a.userId, note: "test cleanup: handled" }));
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.NEXTAUTH_SECRET ||= "test-secret-0123456789abcdef0123456789abcdef";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    R = await import("@/lib/rta/posting/recon-schedule");
    const last = (await withSystem(async (tx) => (await tx.execute(sql`SELECT max(slot_date)::text AS d FROM rta_reconciliation_runs WHERE slot_date >= DATE '2031-01-01'`)).rows[0])) as { d: string | null };
    if (last?.d) base = Math.max(base, Date.parse(`${last.d}T01:00:00Z`) + 864e5);
    AL = await import("@/lib/ops/alerts");
    const TP = await import("./helpers/two-person");
    ops = await TP.createOperators("recon");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES
      (${firmA}::uuid, 'Recon firm A', 'Recon firm A', ${"ARN-RCA" + firmA.slice(0, 6)}),
      (${firmB}::uuid, 'Recon firm B', 'Recon firm B', ${"ARN-RCB" + firmB.slice(0, 6)})`));
  });

  afterAll(async () => {
    const TP = await import("./helpers/two-person");
    await TP.retireOperators(ops);
  });

  it("the schedule is 06:30 Asia/Kolkata, computed in IST whatever the host's zone", () => {
    expect(R.describeSchedule({} as NodeJS.ProcessEnv)).toBe("06:30 Asia/Kolkata (IST, UTC+05:30)");
    // 06:29 IST on 9 Oct is still 8 Oct's slot; 06:30 IST (01:00 UTC) opens 9 Oct's.
    expect(R.dueSlot(new Date("2026-10-09T00:59:00Z"), {} as NodeJS.ProcessEnv)).toEqual({ slotDate: "2026-10-08", scheduledFor: new Date("2026-10-08T01:00:00Z") });
    expect(R.dueSlot(new Date("2026-10-09T01:00:00Z"), {} as NodeJS.ProcessEnv)).toEqual({ slotDate: "2026-10-09", scheduledFor: new Date("2026-10-09T01:00:00Z") });
    // 23:00 UTC on 8 Oct is 04:30 IST on 9 Oct — before the slot, so 8 Oct's.
    expect(R.dueSlot(new Date("2026-10-08T23:00:00Z"), {} as NodeJS.ProcessEnv).slotDate).toBe("2026-10-08");
    expect(R.dueSlot(new Date("2026-10-09T03:00:00Z"), { RTA_RECON_TIME_IST: "08:15" } as unknown as NodeJS.ProcessEnv).scheduledFor).toEqual(new Date("2026-10-09T02:45:00Z"));
    expect(() => R.reconPolicy({ RTA_RECON_TIME_IST: "25:00" } as unknown as NodeJS.ProcessEnv)).toThrow(/HH:MM in IST/);
  });

  it("a successful run is recorded (slot, scheduled time, zone, start, completion, outcome, each firm) — once per slot", async () => {
    const at = nextSlot();
    const H = hook(() => 200);
    const t = await R.reconMonitorTick({ now: new Date(at.getTime() + 60_000), env: env(), fetchImpl: H.fetchImpl, listFirms: firms(firmA, firmB), check: zeros, worker: "test-worker" });
    expect(t.missed).toBe(false);
    expect(t.ran).toMatchObject({ status: "ok" });
    const [run] = await q(sql`SELECT *, slot_date::text AS slot FROM rta_reconciliation_runs WHERE id = ${t.ran!.runId}::uuid`);
    expect(run).toMatchObject({ slot: R.dueSlot(at).slotDate, trigger: "schedule", schedule_timezone: "Asia/Kolkata", status: "ok", firms_checked: 2, firms_with_discrepancy: 0, worker: "test-worker" });
    expect(new Date(run.scheduled_for).toISOString()).toBe(at.toISOString());
    expect(run.completed_at).not.toBeNull();
    expect(new Date(run.completed_at).getTime()).toBeGreaterThanOrEqual(new Date(run.started_at).getTime());
    const perFirm = await q(sql`SELECT tenant_id::text AS t, ok FROM rta_reconciliation_run_firms WHERE run_id = ${run.id}::uuid ORDER BY 1`);
    expect(perFirm.map((x) => x.t).sort()).toEqual([firmA, firmB].sort());
    expect(perFirm.every((x) => x.ok)).toBe(true);
    // The next ticks in the same slot do not run it again; two workers racing for a new slot run it once.
    const again = await R.reconMonitorTick({ now: new Date(at.getTime() + 120_000), env: env(), fetchImpl: H.fetchImpl, listFirms: firms(firmA), check: zeros });
    expect(again.ran).toBeNull();
    const at2 = nextSlot();
    const race = await Promise.all([1, 2, 3].map(() => R.runReconciliation({ trigger: "schedule", now: at2, listFirms: firms(firmA), check: zeros })));
    expect(race.filter((r) => r.runId).length).toBe(1);
    expect(race.filter((r) => r.skipped === "slot_already_run").length).toBe(2);
    expect(await q(sql`SELECT id FROM rta_reconciliation_runs WHERE slot_date = ${R.dueSlot(at2).slotDate}::date`)).toHaveLength(1);
  });

  it("a discrepancy is recorded and raises ONE persisted critical alert (plus audit) — a repeat counts an occurrence, no second notice", async () => {
    await ackAllOpen(sql`dedup_key = ${`recon:discrepancy:${firmA}`}`);
    const bad = async (t: string) => (t === firmA ? { validateFirstTransactionWithoutLedger: 2, ledgerWithoutTransaction: 0 } : zeros());
    const at = nextSlot();
    const H = hook(() => 200);
    const t = await R.reconMonitorTick({ now: new Date(at.getTime() + 60_000), env: env(), fetchImpl: H.fetchImpl, listFirms: firms(firmA, firmB), check: bad });
    expect(t.ran).toMatchObject({ status: "discrepancy" });
    const [run] = await q(sql`SELECT status, firms_checked, firms_with_discrepancy FROM rta_reconciliation_runs WHERE id = ${t.ran!.runId}::uuid`);
    expect(run).toEqual({ status: "discrepancy", firms_checked: 2, firms_with_discrepancy: 1 });
    const a = await alertByKey(`recon:discrepancy:${firmA}`);
    expect(a).toMatchObject({ kind: "rta.reconciliation.discrepancy", severity: "critical", status: "open", firm_id: firmA, occurrences: 1, delivery_state: "delivered" });
    expect(a.details).toMatchObject({ counts: { validateFirstTransactionWithoutLedger: 2 }, runId: t.ran!.runId });
    expect(await q(sql`SELECT 1 FROM audit_log WHERE tenant_id = ${firmA}::uuid AND action = 'rta.posting.reconcile_alert'`)).not.toHaveLength(0);
    expect(H.callsFor(a.id)).toHaveLength(1);
    expect(H.callsFor(a.id)[0].body).toMatchObject({ alertId: a.id, kind: "rta.reconciliation.discrepancy", severity: "critical" });
    // Next day, still wrong: same open alert, occurrences 2, no new notification.
    const at2 = nextSlot();
    await R.reconMonitorTick({ now: new Date(at2.getTime() + 60_000), env: env(), fetchImpl: H.fetchImpl, listFirms: firms(firmA), check: bad });
    expect(await alertByKey(`recon:discrepancy:${firmA}`)).toMatchObject({ id: a.id, occurrences: 2 });
    expect(H.callsFor(a.id)).toHaveLength(1);
    // A check that throws: the run is `failed`, the firm is recorded, a critical alert is raised.
    const at3 = nextSlot();
    const f = await R.runReconciliation({ trigger: "schedule", now: at3, listFirms: firms(firmB), check: async () => { throw new Error("relation lost for PAN ABCDE1234F"); } });
    expect(f.status).toBe("failed");
    const [fr] = await q(sql`SELECT ok, error FROM rta_reconciliation_run_firms WHERE run_id = ${f.runId}::uuid`);
    expect(fr.ok).toBe(false);
    expect(fr.error).not.toMatch(PAN_RE);
    expect(fr.error).toContain("<PAN>");
    expect((await alertByKey(`recon:firm_failed:${firmB}`))?.status).toBe("open");
    await ackAllOpen(sql`dedup_key IN (${`recon:discrepancy:${firmA}`}, ${`recon:firm_failed:${firmB}`})`);
  });

  it("webhook fails, then recovers: retried with bounded backoff until delivered; every attempt is recorded", async () => {
    const a = await withSystem((tx) => AL.raiseOpsAlert(tx, { kind: "test.retry", severity: "critical", dedupKey: `test:retry:${randomUUID()}`, summary: "retry drill" }));
    const H = hook((key, n) => (key === `${a.id}:primary` ? (n === 1 ? 503 : n === 2 ? "throw" : 200) : 200));
    const slow = env({ RTA_ALERT_RETRY_BASE_MS: "60000", RTA_ALERT_RETRY_MAX_MS: "3600000" });
    expect((await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: slow })).retrying).toBeGreaterThanOrEqual(1);
    const r1 = (await q(sql`SELECT *, EXTRACT(EPOCH FROM (next_attempt_at - last_attempt_at))::int AS wait_s FROM ops_alerts WHERE id = ${a.id}::uuid`))[0];
    expect(r1).toMatchObject({ delivery_state: "retrying", delivery_attempts: 1, last_error: "HTTP 503" });
    expect(r1.wait_s).toBeGreaterThanOrEqual(59);
    // Not due yet → not sent again (the backoff is honoured).
    await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: slow });
    expect(H.callsFor(a.id)).toHaveLength(1);
    // Time passes (the wait is shortened in the database rather than slept through).
    await withSystem((tx) => tx.execute(sql`UPDATE ops_alerts SET next_attempt_at = now() WHERE id = ${a.id}::uuid`));
    await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: env() });
    const r2 = (await q(sql`SELECT * FROM ops_alerts WHERE id = ${a.id}::uuid`))[0];
    expect(r2).toMatchObject({ delivery_state: "retrying", delivery_attempts: 2 });
    expect(r2.last_error).toContain("<credentials>@"); // a URL credential in an error never stored
    expect(r2.last_error).not.toContain("secret");
    await sleep(80);
    await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: env() });
    const r3 = (await q(sql`SELECT * FROM ops_alerts WHERE id = ${a.id}::uuid`))[0];
    expect(r3).toMatchObject({ delivery_state: "delivered", delivery_attempts: 3, last_error: null });
    expect(H.callsFor(a.id)).toHaveLength(3);
    expect(H.callsFor(a.id).every((c) => c.key === `${a.id}:primary`)).toBe(true); // same idempotency key every time
    const d = await q(sql`SELECT attempt, outcome, http_status FROM ops_alert_deliveries WHERE alert_id = ${a.id}::uuid ORDER BY attempt`);
    expect(d).toEqual([{ attempt: 1, outcome: "failed", http_status: 503 }, { attempt: 2, outcome: "failed", http_status: null }, { attempt: 3, outcome: "delivered", http_status: 200 }]);
    // Delivered: never sent again.
    await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: env() });
    expect(H.callsFor(a.id)).toHaveLength(3);
    // Backoff is bounded.
    expect(AL.backoffMs(1, {} as NodeJS.ProcessEnv)).toBe(60_000);
    expect(AL.backoffMs(4, {} as NodeJS.ProcessEnv)).toBe(480_000);
    expect(AL.backoffMs(30, {} as NodeJS.ProcessEnv)).toBe(3_600_000);
    await ackAllOpen(sql`id = ${a.id}::uuid`);
  });

  it("webhook stays down: bounded attempts, then `undeliverable`, then escalated once; an unacknowledged delivered alert escalates too", async () => {
    const a = await withSystem((tx) => AL.raiseOpsAlert(tx, { kind: "test.down", severity: "critical", dedupKey: `test:down:${randomUUID()}`, summary: "down drill" }));
    const H = hook((key) => (key.startsWith(a.id) && key.endsWith(":primary") ? 500 : 200));
    const e = env({ RTA_ALERT_MAX_ATTEMPTS: "3", OPS_ALERT_ESCALATION_WEBHOOK_URL: "https://pager.example.invalid/escalate" });
    for (let i = 0; i < 6; i++) { await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: e }); await sleep(70); }
    const r = (await q(sql`SELECT * FROM ops_alerts WHERE id = ${a.id}::uuid`))[0];
    expect(r).toMatchObject({ delivery_state: "undeliverable", delivery_attempts: 3, status: "open" });
    expect(H.callsFor(a.id)).toHaveLength(3); // bounded: no fourth primary attempt
    expect(r.escalated_at).not.toBeNull();
    expect(r.escalation_reason).toMatch(/primary channel failed 3 time/);
    expect(H.callsFor(a.id, "escalation")).toHaveLength(1);
    expect(H.callsFor(a.id, "escalation")[0].url).toBe("https://pager.example.invalid/escalate");
    // The independent probe reports it.
    expect((await R.reconHealth()).problems.join(" | ")).toMatch(/could not be delivered/);

    // Delivered but nobody acknowledged within the window → escalated once.
    const b = await withSystem((tx) => AL.raiseOpsAlert(tx, { kind: "test.unacked", severity: "critical", dedupKey: `test:unacked:${randomUUID()}`, summary: "unacked drill" }));
    const H2 = hook(() => 200);
    await AL.deliverDueAlerts({ fetchImpl: H2.fetchImpl as any, env: e });
    expect((await q(sql`SELECT delivery_state, escalated_at FROM ops_alerts WHERE id = ${b.id}::uuid`))[0]).toEqual({ delivery_state: "delivered", escalated_at: null });
    await withSystem((tx) => tx.execute(sql`UPDATE ops_alerts SET delivered_at = now() - interval '2 hours' WHERE id = ${b.id}::uuid`));
    await AL.deliverDueAlerts({ fetchImpl: H2.fetchImpl as any, env: e });
    await AL.deliverDueAlerts({ fetchImpl: H2.fetchImpl as any, env: e });
    expect(H2.callsFor(b.id, "escalation")).toHaveLength(1);
    expect((await q(sql`SELECT escalation_reason FROM ops_alerts WHERE id = ${b.id}::uuid`))[0].escalation_reason).toMatch(/not acknowledged within 60 minutes/);

    // With no escalation channel configured the escalation is still recorded (and the probe shows it).
    const c = await withSystem((tx) => AL.raiseOpsAlert(tx, { kind: "test.noesc", severity: "critical", dedupKey: `test:noesc:${randomUUID()}`, summary: "no escalation channel" }));
    const H3 = hook(() => 500);
    for (let i = 0; i < 4; i++) { await AL.deliverDueAlerts({ fetchImpl: H3.fetchImpl as any, env: env({ RTA_ALERT_MAX_ATTEMPTS: "2" }) }); await sleep(70); }
    expect((await q(sql`SELECT outcome FROM ops_alert_deliveries WHERE alert_id = ${c.id}::uuid AND channel = 'escalation'`))).toEqual([{ outcome: "not_configured" }]);
    await ackAllOpen(sql`id IN (${a.id}::uuid, ${b.id}::uuid, ${c.id}::uuid)`);
  });

  it("duplicate delivery attempts: concurrent deliverers send an alert once; a repeated raise is one alert", async () => {
    const key = `test:dup:${randomUUID()}`;
    const a = await withSystem((tx) => AL.raiseOpsAlert(tx, { kind: "test.dup", severity: "warning", dedupKey: key, summary: "dup drill" }));
    const b = await withSystem((tx) => AL.raiseOpsAlert(tx, { kind: "test.dup", severity: "warning", dedupKey: key, summary: "dup drill" }));
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ id: a.id, created: false, occurrences: 2 });
    const H = hook(async () => { await sleep(150); return 200; });
    await Promise.all([1, 2, 3, 4].map(() => AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: env() })));
    expect(H.callsFor(a.id)).toHaveLength(1);
    expect(await q(sql`SELECT 1 FROM ops_alert_deliveries WHERE alert_id = ${a.id}::uuid`)).toHaveLength(1);
    expect(await q(sql`SELECT 1 FROM ops_alerts WHERE dedup_key = ${key}`)).toHaveLength(1);
    // Retries create no financial record: the run tables and the ledger are untouched by delivery.
    await ackAllOpen(sql`id = ${a.id}::uuid`);
  });

  it("alerts carry no PAN, client detail or credential", async () => {
    const a = await withSystem((tx) => AL.raiseOpsAlert(tx, {
      kind: "test.pii", severity: "warning", dedupKey: `test:pii:${randomUUID()}`,
      summary: "client ABCDE1234F failed", details: { note: "pan PQRSX9876Z", url: "postgres://app:hunter2@db.internal/x" },
    }));
    const H = hook(() => 200);
    await AL.deliverDueAlerts({ fetchImpl: H.fetchImpl as any, env: env() });
    const row = (await q(sql`SELECT summary, details FROM ops_alerts WHERE id = ${a.id}::uuid`))[0];
    const stored = JSON.stringify(row);
    const sent = JSON.stringify(H.callsFor(a.id)[0].body);
    for (const s of [stored, sent]) {
      expect(s).not.toMatch(PAN_RE);
      expect(s).not.toContain("hunter2");
    }
    expect(stored).toContain("<PAN>");
    await ackAllOpen(sql`id = ${a.id}::uuid`);
  });

  it("worker stopped before the run: the web probe answers 503 and notifies independently; on resume the slot is caught up with a `missed` alert", async () => {
    await ackAllOpen(sql`dedup_key = 'monitor:heartbeat_missing'`);
    await withSystem((tx) => tx.execute(sql`
      INSERT INTO scheduler_state (job_name, last_heartbeat_at, updated_at) VALUES (${R.MONITOR_JOB}, now() - interval '1 hour', now())
      ON CONFLICT (job_name) DO UPDATE SET last_heartbeat_at = now() - interval '1 hour'`));
    const health = await R.reconHealth();
    expect(health.ok).toBe(false);
    expect(health.problems.join(" | ")).toMatch(/no heartbeat from the reconciliation monitor for \d+ minutes/);

    // The real web route, from the web process: 503, and it raises + delivers the alert itself.
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => { sent.push({ url, key: init.headers["idempotency-key"], body: JSON.parse(init.body) }); return { ok: true, status: 200 }; });
    const prev = { tok: process.env.OPS_MONITOR_TOKEN, hook: process.env.OPS_ALERT_WEBHOOK_URL };
    process.env.OPS_MONITOR_TOKEN = "probe-token-test";
    process.env.OPS_ALERT_WEBHOOK_URL = "https://alerts.example.invalid/hook";
    try {
      const route = await import("@/app/api/health/rta-reconciliation/route");
      const denied = await route.GET(new NextRequest("http://localhost/api/health/rta-reconciliation"));
      expect(denied.status).toBe(403);
      const res = await route.GET(new NextRequest("http://localhost/api/health/rta-reconciliation", { headers: { authorization: "Bearer probe-token-test" } }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.problems.join(" | ")).toMatch(/no heartbeat/);
      expect(JSON.stringify(body)).not.toMatch(PAN_RE);
      const al = await alertByKey("monitor:heartbeat_missing");
      expect(al).toMatchObject({ kind: "ops.worker.heartbeat_missing", severity: "critical", status: "open", delivery_state: "delivered" });
      expect(sent.some((s) => s.key === `${al.id}:primary`)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      process.env.OPS_MONITOR_TOKEN = prev.tok;
      process.env.OPS_ALERT_WEBHOOK_URL = prev.hook;
    }

    // The worker comes back two hours after a slot it was down for.
    const at = nextSlot();
    const H = hook(() => 200);
    const t = await R.reconMonitorTick({ now: new Date(at.getTime() + 2 * 3600e3), env: env(), fetchImpl: H.fetchImpl, listFirms: firms(firmA), check: zeros });
    expect(t.missed).toBe(true);
    expect(t.ran).toMatchObject({ status: "ok" });
    const [run] = await q(sql`SELECT trigger, status FROM rta_reconciliation_runs WHERE id = ${t.ran!.runId}::uuid`);
    expect(run).toEqual({ trigger: "catch_up", status: "ok" });
    const missed = await alertByKey(`recon:missed:${R.dueSlot(at).slotDate}`);
    expect(missed).toMatchObject({ kind: "rta.reconciliation.missed", status: "open", delivery_state: "delivered" });
    // Heartbeat is back: the probe no longer reports the worker down.
    expect((await R.reconHealth()).problems.join(" | ")).not.toMatch(/no heartbeat/);
    await ackAllOpen(sql`dedup_key IN ('monitor:heartbeat_missing', ${`recon:missed:${R.dueSlot(at).slotDate}`})`);
  });

  it("worker crashes mid-run (SIGKILL): the run is marked `incomplete`, a critical alert is raised, and a catch-up run completes the slot", async () => {
    const at = nextSlot();
    const code = `
      import("./src/lib/rta/posting/recon-schedule").then(async (m0) => {
        const m = m0.runReconciliation ? m0 : m0.default;
        await m.runReconciliation({ trigger: "schedule", now: new Date(${at.getTime() + 60_000}), worker: "doomed-worker",
          listFirms: async () => [${JSON.stringify(firmA)}, ${JSON.stringify(firmB)}],
          check: (t) => t === ${JSON.stringify(firmB)} ? new Promise(() => {}) : Promise.resolve({ x: 0 }) });
      });`;
    const child = spawn("npx", ["tsx", "-e", code], { env: { ...process.env, DATABASE_URL: TEST_DB!, ALLOW_SYSTEM_TX: "1", DB_QUIET: "1" }, stdio: "ignore", detached: true });
    let run: any;
    for (let i = 0; i < 120 && !run; i++) {
      await sleep(250);
      run = (await q(sql`SELECT r.id::text AS id, r.status, (SELECT count(*) FROM rta_reconciliation_run_firms f WHERE f.run_id = r.id)::int AS n
        FROM rta_reconciliation_runs r WHERE r.slot_date = ${R.dueSlot(at).slotDate}::date AND r.worker = 'doomed-worker'`)).find((r) => r.n === 1);
    }
    expect(run).toMatchObject({ status: "running", n: 1 });
    process.kill(-child.pid!, "SIGKILL");
    await sleep(1500);
    expect((await q(sql`SELECT status FROM rta_reconciliation_runs WHERE id = ${run.id}::uuid`))[0].status).toBe("running");

    const H = hook(() => 200);
    const t = await R.reconMonitorTick({ now: new Date(at.getTime() + 5 * 60_000), env: env({ RTA_RECON_STALE_SEC: "1" }), fetchImpl: H.fetchImpl, listFirms: firms(firmA, firmB), check: zeros });
    expect(t.incomplete).toContain(run.id);
    const [dead] = await q(sql`SELECT status, completed_at, error FROM rta_reconciliation_runs WHERE id = ${run.id}::uuid`);
    expect(dead.status).toBe("incomplete");
    expect(dead.error).toMatch(/stopped or crashed/);
    expect(await alertByKey(`recon:incomplete:${run.id}`)).toMatchObject({ kind: "rta.reconciliation.incomplete", severity: "critical", status: "open", delivery_state: "delivered" });
    expect((await alertByKey(`recon:incomplete:${run.id}`)).details).toMatchObject({ firmsCheckedBeforeStop: 1, worker: "doomed-worker" });
    expect(t.missed).toBe(false); // the crash alert already says it; no second "missed" notice
    expect(t.ran).toMatchObject({ status: "ok" });
    expect((await q(sql`SELECT trigger, status, firms_checked FROM rta_reconciliation_runs WHERE id = ${t.ran!.runId}::uuid`))[0]).toEqual({ trigger: "catch_up", status: "ok", firms_checked: 2 });
    await ackAllOpen(sql`dedup_key = ${`recon:incomplete:${run.id}`}`);
  }, 60_000);

  it("Redis unavailable: the monitor and the run do not depend on it (separate process, REDIS_URL pointing nowhere)", async () => {
    const at = nextSlot();
    const code = `
      import("./src/lib/rta/posting/recon-schedule").then(async (m0) => {
        const m = m0.reconMonitorTick ? m0 : m0.default;
        const r = await m.reconMonitorTick({ now: new Date(${at.getTime() + 60_000}), listFirms: async () => [${JSON.stringify(firmA)}], check: async () => ({ x: 0 }),
          fetchImpl: async () => ({ ok: true, status: 200 }) });
        console.log("RAN " + r.ran.status + " " + r.ran.runId);
        process.exit(0);
      }, (e) => { console.error(e); process.exit(1); });`;
    const r = spawnSync("npx", ["tsx", "-e", code], { env: { ...process.env, DATABASE_URL: TEST_DB!, ALLOW_SYSTEM_TX: "1", DB_QUIET: "1", REDIS_URL: "redis://127.0.0.1:1", REDIS_HOST: "127.0.0.1", REDIS_PORT: "1" }, encoding: "utf8", timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/RAN ok [0-9a-f-]{36}/);
  }, 70_000);

  it("acknowledge via the API: a named, MFA-verified operator closes the alert (recorded, audited, final); a non-MFA session cannot", async () => {
    const J = await import("@/lib/auth/jwt");
    const asOperator = async (op: { userId: string; sid: string }) => {
      const token = await J.signSession({ userId: op.userId, tenantId: ops.platformTenant, roles: ["platform_admin"], email: "op@ops.test.invalid", name: "Test operator", isPlatformAdmin: true, sid: op.sid });
      h.cookies = new Map([["aina_session", token]]);
      h.headers = new Map([["x-pathname", "/api/super-admin/ops-alerts"]]);
    };
    const post = async (body: unknown) => {
      const route = await import("@/app/api/super-admin/ops-alerts/route");
      return route.POST(new NextRequest("http://localhost/api/super-admin/ops-alerts", { method: "POST", body: JSON.stringify(body) }));
    };
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: any) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; });
    const prevHook = process.env.OPS_ALERT_WEBHOOK_URL;
    process.env.OPS_ALERT_WEBHOOK_URL = "https://alerts.example.invalid/hook";
    try {
      await asOperator(ops.a);
      const test = await post({ action: "test", note: "on-call drill" });
      expect(test.status).toBe(200);
      const { alert } = await test.json();
      expect(sent.some((s) => s.alertId === alert.id && s.kind === "ops.alert.test")).toBe(true);
      expect((await q(sql`SELECT delivery_state FROM ops_alerts WHERE id = ${alert.id}::uuid`))[0].delivery_state).toBe("delivered");

      // A session of the same operator WITHOUT a completed second factor (password only) cannot acknowledge.
      const weakSid = `test-sid-weak-${randomUUID()}`;
      await withSystem((tx) => tx.execute(sql`INSERT INTO user_sessions (tenant_id, user_id, session_id, auth_method) VALUES (${ops.platformTenant}::uuid, ${ops.b.userId}::uuid, ${weakSid}, 'password_reset')`));
      await asOperator({ userId: ops.b.userId, sid: weakSid });
      const weak = await post({ action: "acknowledge", id: alert.id, note: "tried without MFA" });
      expect(weak.status).toBe(403);
      expect((await q(sql`SELECT status FROM ops_alerts WHERE id = ${alert.id}::uuid`))[0].status).toBe("open");

      // The MFA-verified on-call operator acknowledges it.
      await asOperator(ops.b);
      const ok = await post({ action: "acknowledge", id: alert.id, note: "received on the on-call phone; channel works" });
      expect(ok.status).toBe(200);
      const row = (await q(sql`SELECT status, acknowledged_by::text AS by, acknowledged_at, ack_note FROM ops_alerts WHERE id = ${alert.id}::uuid`))[0];
      expect(row).toMatchObject({ status: "acknowledged", by: ops.b.userId, ack_note: "received on the on-call phone; channel works" });
      expect(await q(sql`SELECT 1 FROM audit_log WHERE action = 'ops.alert.acknowledged' AND entity_id = ${alert.id}::uuid AND actor_user_id = ${ops.b.userId}::uuid`)).toHaveLength(1);
      // Final: a second acknowledgement is refused; the database refuses re-opening or deleting it.
      expect((await post({ action: "acknowledge", id: alert.id, note: "again" })).status).toBe(409);
      await expect(withSystem((tx) => tx.execute(sql`UPDATE ops_alerts SET status = 'open', acknowledged_at = NULL, acknowledged_by = NULL WHERE id = ${alert.id}::uuid`))).rejects.toThrow();
      await expect(withSystem((tx) => tx.execute(sql`DELETE FROM ops_alerts WHERE id = ${alert.id}::uuid`))).rejects.toThrow();
      await expect(withSystem((tx) => tx.execute(sql`DELETE FROM ops_alert_deliveries WHERE alert_id = ${alert.id}::uuid`))).rejects.toThrow();
      // The operator is never taken from the body.
      expect((await post({ action: "acknowledge", id: alert.id, note: "spoof", by: ops.a.userId })).status).toBe(400);
      // Listing shows who acknowledged and every delivery attempt.
      const route = await import("@/app/api/super-admin/ops-alerts/route");
      const list = await (await route.GET(new NextRequest("http://localhost/api/super-admin/ops-alerts?status=acknowledged"))).json();
      const mine = list.alerts.find((x: any) => x.id === alert.id);
      expect(mine).toMatchObject({ acknowledged_by: ops.b.userId, acknowledged_by_name: expect.stringContaining("Test operator") });
      expect(mine.deliveries).toEqual([expect.objectContaining({ channel: "primary", outcome: "delivered" })]);
    } finally {
      vi.unstubAllGlobals();
      process.env.OPS_ALERT_WEBHOOK_URL = prevHook;
    }
  });
});
