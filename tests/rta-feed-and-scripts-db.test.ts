/**
 * Phase 3H — the remaining RTA entry points, tested: the drop folder and SFTP
 * ingest (no default folder, firm-id folders only, no simulation by default,
 * a held firm's file left in place) and the operator-script guard.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MFSD201_HEADER, csvOf, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const feedFile = () => csvOf(MFSD201_HEADER, [{ "Fund": "117", "Folio Number": "94100001", "Product Code": "117EQGR", "Transaction Head": "P", "Transaction Type": "SIN",
  "Transaction Status": "Y", "Transaction Date": "15/4/2026", Units: "20.000", Amount: "1000.00", "Transaction Number": "941001", PAN1: P.adult }]);

describe.skipIf(!TEST_DB)("drop folder, SFTP and operator scripts (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let C: typeof import("@/lib/rta/posting/controls");
  let feed: typeof import("@/workers/feed-ingest");
  const firm = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const imports = async () => (await withTenant(firm, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM rta_file_imports WHERE tenant_id = ${firm}::uuid`)).rows[0] as any)).n as number;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    C = await import("@/lib/rta/posting/controls");
    feed = await import("@/workers/feed-ingest");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${firm}::uuid, 'Feed', 'Feed', ${"ARN-FD" + firm.slice(0, 6)})`));
  });

  afterAll(async () => {
    for (const k of ["RTA_FEED_DIR", "RTA_FEED_SOURCE", "RTA_FEED_SFTP_SIMULATE", "RTA_FEED_SFTP_TENANT_ID"]) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    await tryRun(sql`DELETE FROM rta_pipeline_activations WHERE tenant_id = ${firm}::uuid`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const t of ["transactions", "rta_file_imports", "audit_log"]) await tryRun(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${firm}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${firm}::uuid`);
  });

  it("no RTA_FEED_DIR: the drop-folder job does nothing — no default ./feed-inbox is created or scanned", async () => {
    delete process.env.RTA_FEED_DIR;
    const cwd = mkdtempSync(join(tmpdir(), "feed-cwd-"));
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      const r = await feed.runFeedIngest();
      expect(r).toMatchObject({ enabled: false, filesFound: 0 });
      expect(existsSync(join(cwd, "feed-inbox"))).toBe(false);
    } finally { process.chdir(prev); }
  });

  it("only firm-id folders are read; a paused firm's file stays in its inbox and nothing is recorded", async () => {
    const root = mkdtempSync(join(tmpdir(), "feed-root-"));
    process.env.RTA_FEED_DIR = root;
    process.env.RTA_FEED_SOURCE = "local_dir";
    mkdirSync(join(root, "default", "incoming"), { recursive: true });
    writeFileSync(join(root, "default", "incoming", "kfintech__daily_transaction_feed__2026-10-08.csv"), feedFile());
    mkdirSync(join(root, firm, "incoming"), { recursive: true });
    const name = "kfintech__daily_transaction_feed__2026-10-08.csv";
    writeFileSync(join(root, firm, "incoming", name), feedFile());
    await C.activateTenant({ tenantId: firm, mode: "paused", postingEnabled: false, reason: "feed test: firm paused", approvedBy: ops.a });
    const r = await feed.runFeedIngest();
    expect(r.filesIngested).toBe(0);
    expect(readdirSync(join(root, "default", "incoming"))).toHaveLength(1); // a non-firm folder is never read
    expect(readdirSync(join(root, firm, "incoming"))).toEqual([name]); // held: left for the next tick
    expect(existsSync(join(root, firm, "failed"))).toBe(false);
    expect(await imports()).toBe(0);
  });

  it("SFTP without the client library writes no simulated feed unless asked, never in production, never for a hard-coded firm", async () => {
    const root = mkdtempSync(join(tmpdir(), "feed-sftp-"));
    process.env.RTA_FEED_DIR = root;
    process.env.RTA_FEED_SOURCE = "sftp";
    delete process.env.RTA_FEED_SFTP_SIMULATE;
    process.env.RTA_FEED_SFTP_TENANT_ID = firm;
    await feed.runFeedIngest();
    expect(readdirSync(root)).toEqual([]); // no mock file, no folder
    process.env.RTA_FEED_SFTP_SIMULATE = "1";
    (process.env as Record<string, string>).NODE_ENV = "production";
    try { await feed.runFeedIngest(); } finally { (process.env as Record<string, string>).NODE_ENV = "test"; }
    expect(readdirSync(root)).toEqual([]);
    expect(existsSync(join(root, "3a825fcd-bfb9-4786-9a25-e5f88eb22111"))).toBe(false); // the old hard-coded demo firm
    process.env.RTA_FEED_SOURCE = "local_dir";
  });

  it("operator scripts: the guard refuses a paused or validate-first firm and lists governed firms for all-firm scripts", async () => {
    const G = await import("../scripts/lib/rta-script-guard");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(G.refuseIfRtaWritesStopped(firm, "test-script")).rejects.toThrow("exit 1"); // paused (previous case)
      expect(err.mock.calls.flat().join(" ")).toMatch(/paused/);
      await C.activateTenant({ tenantId: firm, mode: "validate_first", postingEnabled: false, reason: "feed test: pilot", requestedBy: ops.a, approvedBy: ops.b });
      await expect(G.refuseIfRtaWritesStopped(firm, "test-script")).rejects.toThrow("exit 1"); // validate-first: pipeline only
      expect(err.mock.calls.flat().join(" ")).toMatch(/validate-first only/);
      const gov = await G.rtaGovernedTenants();
      expect(gov.skip.has(firm)).toBe(true);
      await C.activateTenant({ tenantId: firm, mode: "off", postingEnabled: false, reason: "feed test: back to legacy", requestedBy: ops.a, approvedBy: ops.b });
      await expect(G.refuseIfRtaWritesStopped(firm, "test-script")).resolves.toBeUndefined(); // explicitly legacy: allowed
    } finally { exit.mockRestore(); err.mockRestore(); }
  });

  it("backfill-demo-nav refuses without the named demo firm, and in production", () => {
    const run = (args: string[], env: Record<string, string>) => spawnSync(process.execPath, ["--import", "tsx", "scripts/backfill-demo-nav.ts", ...args],
      { env: { ...process.env, DATABASE_URL: TEST_DB!, ...env }, encoding: "utf8", timeout: 60_000 });
    const a = run([], { DEMO_TENANT_ID: "" });
    expect(a.status).toBe(1);
    expect(a.stderr).toMatch(/must name the demo firm/);
    const b = run(["--tenant", firm], { DEMO_TENANT_ID: firm, NODE_ENV: "production" });
    expect(b.status).toBe(1);
    expect(b.stderr).toMatch(/in production/);
  });
});
