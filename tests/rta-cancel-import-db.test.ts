/**
 * Final pilot patch, P2 — cancelling a parked RTA import, against a real
 * Postgres (and, with TEST_REDIS_URL, a real Redis / BullMQ queue).
 *
 * Proves: one signed-in two-factor platform operator cancels a queued or
 * parked import; the row says CANCELLED (never a worker crash) with who, when
 * and why, plus an audit row; the file and the row's provenance are kept; the
 * queued / delayed job is removed from Redis; a job that survives anyway (a
 * delayed retry, a re-queue) does nothing; the re-run route refuses it; the
 * database refuses to move a cancelled row back; a firm session, an operator
 * without 2FA and a running import are refused.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { MFSD201_HEADER, csvOf, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const TEST_REDIS = process.env.TEST_REDIS_URL;

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
vi.mock("@/lib/rta/import-access", async (orig) => ({ ...(await orig<typeof import("@/lib/rta/import-access")>()), assertRtaImportAccess: vi.fn(async () => {}) }));

const dbError = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e: any) { return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`; } };

describe.skipIf(!TEST_DB)("cancelling a parked RTA import (DB)", () => {
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let worker: typeof import("@/workers/rta-import-worker");
  let route: typeof import("@/app/api/super-admin/rta-pipeline/route");
  const t = randomUUID();
  const owner = randomUUID();
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const row = async (id: string) => (await q(sql`SELECT status, remarks, cancelled_at, cancelled_by::text AS cancelled_by, cancel_reason, file_key, file_name FROM rta_file_imports WHERE id = ${id}::uuid`))[0];
  /** An import parked by a pause, as the worker leaves it (row back to uploaded, file kept). */
  const parked = async (name: string) => {
    const id = randomUUID(), key = `tenants/${t}/rta/${id}-${name}`;
    h.store.set(key, csvOf(MFSD201_HEADER, [{ "Fund": "120", "Folio Number": "1", "Product Code": "120EQGP", "Transaction Number": "1", PAN1: P.adult }]));
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status, remarks)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${key}, 'uploaded',
              'Auto-imported from forwarded email (registrar) · Held — RTA imports are paused for this firm; it runs when the firm resumes')`));
    return { id, key, job: { importId: id, tenantId: t, source: "kfintech" as const, kind: "daily_transaction_feed" as const, key, filename: name, userId: owner, roles: ["owner"] } };
  };
  const post = (body: unknown) => route.POST(new NextRequest("http://localhost/api/super-admin/rta-pipeline", { method: "POST", body: JSON.stringify(body) }));
  const asOperator = (op: { userId: string; sid: string }) => { h.session = { userId: op.userId, tenantId: ops2p.platformTenant, roles: ["platform_admin"], sid: op.sid, isPlatformAdmin: true }; };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.RTA_PIPELINE_MODE = "validate_first";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    process.env.RTA_CANCEL_QUEUE_TIMEOUT_MS = "1500";
    if (TEST_REDIS) process.env.REDIS_URL = TEST_REDIS; else process.env.REDIS_URL = "redis://127.0.0.1:1"; // unreachable: the cancel must not hang
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    worker = await import("@/workers/rta-import-worker");
    route = await import("@/app/api/super-admin/rta-pipeline/route");
    H2p = await import("./helpers/two-person");
    ops2p = await H2p.createOperators("cancel");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Cancel drill', 'Cancel drill', ${"ARN-CX" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${t}::uuid, ${`owner-${t.slice(0, 8)}@example.test`}, 'Cancel Owner', ARRAY['owner']::text[], 'active')`);
    });
    // Paused (one operator): imports park.
    const C = await import("@/lib/rta/posting/controls");
    await C.activateTenant({ tenantId: t, mode: "paused", postingEnabled: false, reason: "cancel drill: pilot paused while the backlog is reviewed", approvedBy: ops2p.a.userId });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await H2p?.retireOperators(ops2p);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const table of ["rta_pipeline_activations", "rta_staging_batches", "rta_file_imports", "audit_log", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
    if (TEST_REDIS) { const { redis } = await import("@/workers/queues"); await redis().quit().catch(() => {}); }
  });

  it("refuses a firm session, an operator without two-factor, a revoked session and a running import", async () => {
    const p = await parked("refusals.csv");
    h.session = { userId: owner, tenantId: t, roles: ["owner"], sid: "x" };
    expect((await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "not on the approved inventory" })).status).toBe(403);
    const no2fa = await H2p.createOperator(ops2p.platformTenant, "cx-no2fa", { twoFa: false });
    asOperator(no2fa);
    expect((await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "not on the approved inventory" })).status).toBe(403);
    const revoked = await H2p.createOperator(ops2p.platformTenant, "cx-revoked");
    await withSystem((tx) => tx.execute(sql`UPDATE user_sessions SET revoked_at = now() WHERE session_id = ${revoked.sid}`));
    asOperator(revoked);
    expect((await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "not on the approved inventory" })).status).toBe(401);
    await withTenant(t, (tx) => tx.execute(sql`UPDATE rta_file_imports SET status = 'parsing' WHERE id = ${p.id}::uuid`));
    asOperator(ops2p.a);
    const running = await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "not on the approved inventory" });
    expect(running.status).toBe(409);
    expect((await row(p.id)).status).toBe("parsing");
  });

  it("one operator cancels: CANCELLED (not a crash) with who, when and why; audit row; file and provenance kept", async () => {
    const p = await parked("backlog-1.csv");
    asOperator(ops2p.a);
    const res = await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "not on the approved pilot file inventory (CHG-INV-7)" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.import).toMatchObject({ importId: p.id, status: "cancelled" });
    const r = await row(p.id);
    expect(r).toMatchObject({ status: "cancelled", cancelled_by: ops2p.a.userId, cancel_reason: "not on the approved pilot file inventory (CHG-INV-7)", file_key: p.key, file_name: "backlog-1.csv" });
    expect(r.cancelled_at).toBeTruthy();
    expect(r.remarks).toMatch(/^Cancelled by a platform operator — nothing was imported; the file is kept/);
    expect(r.remarks).not.toMatch(/crash|worker/i);
    expect(h.store.has(p.key)).toBe(true);
    const audit = await q(sql`SELECT actor_user_id::text AS who, reason, at FROM audit_log WHERE tenant_id = ${t}::uuid AND action = 'rta.import.cancel' AND entity_id = ${p.id}::uuid`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ who: ops2p.a.userId, reason: "not on the approved pilot file inventory (CHG-INV-7)" });
    if (!TEST_REDIS) expect(body.import.queueChecked).toBe(false); // Redis unreachable: reported, never hung
  });

  it("a job that survives (delayed retry, resumed firm) does nothing; the re-run route refuses; the database keeps it final", async () => {
    const p = await parked("backlog-2.csv");
    asOperator(ops2p.b);
    expect((await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "duplicate of a file already imported" })).status).toBe(200);
    const batches = async () => (await q(sql`SELECT count(*)::int AS n FROM rta_staging_batches WHERE tenant_id = ${t}::uuid`))[0].n as number;
    const b0 = await batches();
    await worker.runRtaImportJob(p.job);
    await expect(worker.runRichImportJob({ mode: "rich", importId: p.id, tenantId: t, key: p.key, filename: "backlog-2.csv", rta: "kfintech", reportType: "", dryRun: false, assignToMe: false, userId: owner, roles: ["owner"] } as any))
      .rejects.toMatchObject({ name: "ImportCancelledError" });
    expect((await row(p.id)).status).toBe("cancelled");
    expect(await batches()).toBe(b0);
    expect(h.store.has(p.key)).toBe(true);
    h.session = { userId: owner, tenantId: t, roles: ["owner"], permissions: [], branchId: null, sid: "x" };
    const reimport = await import("@/app/api/rta-imports/[id]/reimport/route");
    const rr = await reimport.POST(new NextRequest(`http://localhost/api/rta-imports/${p.id}/reimport`, { method: "POST" }), { params: Promise.resolve({ id: p.id }) });
    expect(rr.status).toBe(409);
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`UPDATE rta_file_imports SET status = 'uploaded' WHERE id = ${p.id}::uuid`)))).toMatch(/cancelled RTA import is final/);
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`UPDATE rta_file_imports SET cancel_reason = 'changed afterwards' WHERE id = ${p.id}::uuid`)))).toMatch(/final/);
    const other = await parked("backlog-3.csv");
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`UPDATE rta_file_imports SET status = 'cancelled' WHERE id = ${other.id}::uuid`)))).toMatch(/who, when and why/);
  });

  it.skipIf(!TEST_REDIS)("Redis: the parked (delayed) job is removed — DB and queue agree, no manual Redis deletion", async () => {
    const { Q } = await import("@/workers/queues");
    const p = await parked("backlog-redis.csv");
    const job = await Q.rtaImport().add("import", p.job, { delay: 10 * 60_000, attempts: 1 });
    expect(await job.getState()).toBe("delayed");
    asOperator(ops2p.a);
    const res = await post({ action: "cancel_import", tenantId: t, importId: p.id, reason: "not on the approved pilot file inventory" });
    expect((await res.json()).import).toMatchObject({ status: "cancelled", jobsRemoved: 1, queueChecked: true });
    expect(await Q.rtaImport().getJob(job.id!)).toBeUndefined();
    expect((await row(p.id)).status).toBe("cancelled");
  });
});
