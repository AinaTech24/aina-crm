/**
 * FS-8 — the COMPLETE cancellation sequence in ONE test (final security patch):
 *
 *   1. queue an import            5. restart Redis (same data — AOF persistence)
 *   2. pause the firm             6. let delayed workers and retries execute
 *   3. stop Redis                    (and resume the firm, so nothing else holds it)
 *   4. cancel                     7. the cancelled import never stages or posts
 *                                 8. audit history and final status
 *
 * Real Postgres, a real redis-server on its own port (started, stopped and
 * restarted by the test), the real BullMQ worker (startRtaImportWorker) and
 * the real cancel route. Only object storage is an in-memory stub.
 *
 * Runs when TEST_DATABASE_URL is set and redis-server is installed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { MFSD201_HEADER, csvOf, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const HAVE_REDIS = spawnSync("redis-server", ["--version"]).status === 0;
// A port the OS says is free right now — never a random one, which could land
// on a Redis already running on this machine and then shut it down (B-1 stabilisation).
const PORT = Number(spawnSync(process.execPath, ["-e", "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: "utf8" }).stdout);

const h = vi.hoisted(() => ({ store: new Map<string, Uint8Array>(), session: null as any }));
vi.mock("@/lib/storage/s3", () => ({
  getObjectBytes: vi.fn(async (key: string) => {
    const b = h.store.get(key);
    if (!b) throw new Error("The specified key does not exist.");
    return Buffer.from(b);
  }),
  putObject: vi.fn(async (key: string, body: Uint8Array) => { h.store.set(key, body); }),
  deleteObject: vi.fn(async (key: string) => { h.store.delete(key); }),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => h.session) }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sip = (txn: string) => ({
  "Fund": "117", "Folio Number": "93800001", "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult,
});

describe.skipIf(!TEST_DB || !HAVE_REDIS)("FS-8: queue → pause → Redis down → cancel → Redis back → delayed jobs and retries run → nothing staged or posted (DB + Redis)", () => {
  let dir = "";
  let redisProc: ChildProcess | null = null;
  let stopWorker: (() => void) | null = null;
  let H2p: typeof import("./helpers/two-person");
  let ops: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const t = randomUUID();
  const owner = randomUUID();
  const logs: string[] = [];
  const timeline: string[] = [];
  const mark = (s: string) => timeline.push(`${new Date().toISOString()} ${s}`);

  const startRedis = async () => {
    redisProc = spawn("redis-server", ["--port", String(PORT), "--bind", "127.0.0.1", "--dir", dir, "--appendonly", "yes", "--appendfsync", "always", "--save", ""], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      if (spawnSync("redis-cli", ["-p", String(PORT), "ping"], { encoding: "utf8" }).stdout?.trim() === "PONG") return;
      await sleep(100);
    }
    throw new Error("redis-server did not start");
  };
  const stopRedis = async () => {
    spawnSync("redis-cli", ["-p", String(PORT), "shutdown"]); // AOF is fsynced on every write: the queue survives
    for (let i = 0; i < 50 && redisProc && redisProc.exitCode === null; i++) await sleep(100);
    redisProc = null;
  };
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const importRow = async (id: string) => (await q(sql`SELECT status, remarks, cancelled_at::text AS cancelled_at, cancelled_by::text AS cancelled_by, cancel_reason FROM rta_file_imports WHERE id = ${id}::uuid`))[0];
  const upload = async (name: string, rows: Record<string, string>[]) => {
    const id = randomUUID(), key = `tenants/${t}/rta/${id}-${name}`;
    h.store.set(key, csvOf(MFSD201_HEADER, rows));
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${key}, 'uploaded')`));
    return { id, key, job: { importId: id, tenantId: t, source: "kfintech" as const, kind: "daily_transaction_feed" as const, key, filename: name, userId: owner, roles: ["owner"] } };
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "fs8-redis-"));
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.REDIS_URL = `redis://127.0.0.1:${PORT}`;
    process.env.RTA_HOLD_RECHECK_MS = "1500";
    process.env.RTA_CANCEL_QUEUE_TIMEOUT_MS = "1500";
    process.env.RTA_PIPELINE_MODE = "validate_first";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    await startRedis();
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    H2p = await import("./helpers/two-person");
    ops = await H2p.createOperators("fs8");
    await H2p.release(ops, "global");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'FS-8 drill', 'FS-8 drill', ${"ARN-FS8" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${t}::uuid, ${`owner-${t.slice(0, 8)}@example.test`}, 'FS8 Owner', ARRAY['owner']::text[], 'active')`);
    });
    const orig = console.log;
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); orig(...a); });
  }, 60_000);

  afterAll(async () => {
    stopWorker?.();
    try { const { redis } = await import("@/workers/queues"); await redis().quit(); } catch { /* best effort */ }
    await stopRedis();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await H2p?.retireOperators(ops);
    delete process.env.RTA_PIPELINE_MODE; delete process.env.RTA_POSTING_MODE; delete process.env.RTA_POSTING_DATABASE;
  });

  it("the whole sequence, in one run", async () => {
    const { Q } = await import("@/workers/queues");
    const worker = await import("@/workers/rta-import-worker");
    const C = await import("@/lib/rta/posting/controls");
    const route = await import("@/app/api/super-admin/rta-pipeline/route");
    const queue = Q.rtaImport();
    const staged = async (importId: string) => (await q(sql`SELECT count(*)::int AS n FROM rta_staging_batches WHERE tenant_id = ${t}::uuid AND import_id = ${importId}::uuid`))[0].n as number;
    const firmTx = async () => (await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid`))[0].n as number;
    const jobState = async (id: string) => (await queue.getJob(id))?.getState() ?? "removed";
    const waitFor = async (what: string, f: () => Promise<boolean>, ms = 30_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await f()) return; await sleep(200); }
      throw new Error(`timed out waiting for: ${what}`);
    };

    // ── 1. Queue an import (the upload route's job shape), worker not yet running.
    const target = await upload("FS8-MFSD201.csv", [sip("880001"), sip("880002")]);
    const job1 = await queue.add("import", target.job, { attempts: 3, backoff: { type: "fixed", delay: 1000 } });
    expect(await job1.getState()).toBe("waiting");
    mark(`1 queued import ${target.id} as job ${job1.id}`);

    // ── 2. Pause the firm (one operator — a stop), then the worker comes up and parks the job.
    await C.activateTenant({ tenantId: t, mode: "paused", postingEnabled: false, reason: "FS-8 drill: pilot paused while the backlog is reviewed", approvedBy: ops.a.userId });
    stopWorker = worker.startRtaImportWorker();
    await waitFor("job parked (delayed) with a Held remark", async () => (await jobState(job1.id!)) === "delayed" && /^Held/.test((await importRow(target.id)).remarks ?? ""));
    expect((await importRow(target.id)).status).toBe("uploaded");
    expect(await staged(target.id)).toBe(0);
    // A second copy of the job (a re-queue / retry path) also waits, delayed.
    const job2 = await queue.add("import", target.job, { delay: 4000, attempts: 3, backoff: { type: "fixed", delay: 1000 } });
    mark(`2 firm paused; job ${job1.id} parked (delayed ${process.env.RTA_HOLD_RECHECK_MS} ms recheck); re-queued copy job ${job2.id} delayed 4 s`);

    // ── 3. Stop Redis.
    await stopRedis();
    expect(spawnSync("redis-cli", ["-p", String(PORT), "ping"]).status).not.toBe(0);
    mark("3 Redis stopped");

    // ── 4. Cancel, as a signed-in MFA-verified operator, while Redis is down.
    h.session = { userId: ops.a.userId, tenantId: ops.platformTenant, roles: ["platform_admin"], sid: ops.a.sid, isPlatformAdmin: true };
    const reason = "FS-8 drill: not on the approved pilot file inventory";
    const t0 = Date.now();
    const res = await route.POST(new NextRequest("http://localhost/api/super-admin/rta-pipeline", { method: "POST", body: JSON.stringify({ action: "cancel_import", tenantId: t, importId: target.id, reason }) }));
    expect(res.status).toBe(200);
    const cancelled = (await res.json()).import;
    expect(cancelled).toMatchObject({ status: "cancelled", queueChecked: false, jobsRemoved: 0 }); // Redis down: reported, not hung
    expect(Date.now() - t0).toBeLessThan(10_000);
    const afterCancel = await importRow(target.id);
    expect(afterCancel).toMatchObject({ status: "cancelled", cancelled_by: ops.a.userId, cancel_reason: reason });
    mark(`4 cancelled while Redis down in ${Date.now() - t0} ms (queueChecked=false)`);

    // ── 5. Restart Redis on the same data: the delayed jobs are still there.
    await startRedis();
    mark("5 Redis restarted (AOF)");

    // ── 6. Resume the firm (two operators), so only the cancellation can stop the import; let the
    //       delayed job, the re-queued copy and a fresh retry run on the worker that rode out the outage.
    await H2p.activate(ops, { tenantId: t, mode: "validate_first", postingEnabled: true, registrars: ["kfintech"], reportCodes: ["MFSD201"], changeRef: "CHG-FS8-RESUME", reason: "FS-8 drill: firm resumed by two operators" });
    const job3 = await queue.add("import", target.job, { attempts: 3, backoff: { type: "fixed", delay: 1000 } });
    const after = { job1: await jobState(job1.id!), job2: await jobState(job2.id!) };
    mark(`5b after restart the queue still holds: ${JSON.stringify(after)}`);
    const settled = async (id: string) => (await jobState(id)) === "completed";
    await waitFor("every job of the cancelled import ran", async () => (await settled(job1.id!)) && (await settled(job2.id!)) && (await settled(job3.id!)), 45_000)
      .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify({ job1: await jobState(job1.id!), job2: await jobState(job2.id!), job3: await jobState(job3.id!) })}`); });
    const states = { job1: await jobState(job1.id!), job2: await jobState(job2.id!), job3: await jobState(job3.id!) };
    mark(`6 firm resumed; jobs settled: ${JSON.stringify(states)}`);
    expect(states.job3).toBe("completed"); // the fresh retry certainly ran on the worker
    expect(states).toEqual({ job1: "completed", job2: "completed", job3: "completed" });
    for (const id of [job1.id, job2.id, job3.id]) {
      const j = await queue.getJob(id!);
      if (j) expect(j.failedReason ?? null).toBeNull();
    }

    // Not vacuous: an un-cancelled import queued now IS imported by the same worker.
    const control = await upload("FS8-control-MFSD201.csv", [sip("880101")]);
    const jc = await queue.add("import", control.job, { attempts: 1 });
    await waitFor("control import processed", async () => (await jobState(jc.id!)) === "completed" && !["uploaded", "parsing"].includes((await importRow(control.id)).status));
    expect(await staged(control.id)).toBeGreaterThan(0);
    mark(`6b control import ${control.id} processed → ${(await importRow(control.id)).status}, staged`);

    // ── 7. The cancelled import never staged or posted.
    expect(await staged(target.id)).toBe(0);
    expect((await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid AND order_id IN ('880001', '880002')`))[0].n).toBe(0);
    expect((await q(sql`SELECT count(*)::int AS n FROM rta_posted_transactions WHERE tenant_id = ${t}::uuid AND identity_key LIKE '%:88000_'`))[0].n).toBe(0);
    expect(h.store.has(target.key)).toBe(true); // the file is kept
    const runLog = logs.filter((l) => l.includes(target.id) && /cancelled by an operator — not run/.test(l));
    expect(runLog.length).toBeGreaterThanOrEqual(1);
    mark(`7 cancelled import: 0 staging batches, 0 transactions, 0 posted; worker refused it ${runLog.length} time(s)`);

    // ── 8. Audit history and final status.
    const final = await importRow(target.id);
    expect(final).toMatchObject({ status: "cancelled", cancelled_by: ops.a.userId, cancel_reason: reason });
    expect(final.cancelled_at).toBe(afterCancel.cancelled_at); // unchanged by everything after step 4
    expect(final.remarks).toMatch(/^Cancelled by a platform operator — nothing was imported/);
    const audit = await q(sql`SELECT action, actor_user_id::text AS who, reason FROM audit_log WHERE tenant_id = ${t}::uuid AND entity_id = ${target.id}::uuid ORDER BY at`);
    expect(audit.filter((a) => a.action === "rta.import.cancel")).toEqual([{ action: "rta.import.cancel", who: ops.a.userId, reason }]);
    const controls = await withSystem(async (tx) => (await tx.execute(sql`SELECT mode, posting_enabled FROM rta_pipeline_activations WHERE tenant_id = ${t}::uuid ORDER BY created_at`)).rows as any[]);
    expect(controls.map((c) => c.mode)).toEqual(["paused", "validate_first"]);
    mark(`8 final: ${final.status}, cancelled_at unchanged, audit rta.import.cancel ×1, activations paused → validate_first`);
    // Evidence for the handover (aggregates and ids only): FS8_EVIDENCE=<file>.
    if (process.env.FS8_EVIDENCE) writeFileSync(process.env.FS8_EVIDENCE, JSON.stringify({ timeline, jobStates: states, workerRefusals: runLog, finalStatus: final.status, audit }, null, 2));
  }, 180_000);
});
