/**
 * Phase 3H — EMERGENCY shutdown drill, on a real Postgres.
 *
 * An emergency halt stops every RTA write for EVERY firm in the database, so
 * this cannot run beside the other DB suites (it would hold their imports).
 * It runs only when asked:
 *
 *   RTA_EMERGENCY_DRILL=1 TEST_DATABASE_URL=… npx vitest run tests/rta-emergency-drill-db.test.ts
 *
 * (npm run test:emergency; CI runs it as its own step after the main suite.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, csvOf, P } from "./rta-real-layouts";

const RUN = !!process.env.TEST_DATABASE_URL && process.env.RTA_EMERGENCY_DRILL === "1";

describe.skipIf(!RUN)("EMERGENCY shutdown (DB drill)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let C: typeof import("@/lib/rta/posting/controls");
  let cfg: typeof import("@/lib/rta/staging/config");
  let gate: typeof import("@/lib/rta/posting/gate");
  let guard: typeof import("@/lib/rta/write-guard");
  const pilot = randomUUID();
  const legacy = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.RTA_POSTING_MODE = "controlled";
    process.env.RTA_PIPELINE_MODE = "validate_first";
    process.env.RTA_POSTING_DATABASE = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    C = await import("@/lib/rta/posting/controls");
    cfg = await import("@/lib/rta/staging/config");
    gate = await import("@/lib/rta/posting/gate");
    guard = await import("@/lib/rta/write-guard");
    await C.setPostingHalt({ scope: "global", halted: false, reason: "development test database: posting released", changedBy: ops.a, approvedBy: ops.b });
    await withSystem(async (tx) => {
      for (const [id, n] of [[pilot, "P"], [legacy, "L"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"Emergency " + n}, ${"Emergency " + n}, ${"ARN-EM" + n + id.slice(0, 6)})`);
      }
    });
    await C.activateTenant({ tenantId: pilot, mode: "validate_first", postingEnabled: true, reason: "pilot for the emergency drill", approvalRef: "CHG-EM-1", requestedBy: ops.a, approvedBy: ops.b });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    // Never leave the database in an emergency.
    await C.setPostingHalt({ scope: "emergency", halted: false, reason: "drill teardown: all clear", changedBy: ops.a, approvedBy: ops.b }).catch(() => {});
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const id of [pilot, legacy]) {
      await tryRun(sql`DELETE FROM rta_pipeline_activations WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${id}::uuid`);
    }
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
  });

  it("every firm is held — the pilot AND a legacy firm, every path; a write in flight finishes first; two people release", async () => {
    expect((await cfg.resolvePipelineMode(legacy)).mode).toBe("off");
    expect((await cfg.resolvePipelineMode(pilot)).mode).toBe("validate_first");
    // A legacy write in flight holds the control rows FOR SHARE; the emergency halt waits for it.
    let released!: () => void;
    const hold = new Promise<void>((r) => { released = r; });
    const inflight = withTenant(legacy, async (tx) => { const d = await guard.rtaWriteDenial(tx, legacy, "derived"); await hold; return d; });
    await new Promise((r) => setTimeout(r, 150));
    let halted = false;
    const halting = C.setPostingHalt({ scope: "emergency", halted: true, reason: "drill: emergency stop of every RTA write", changedBy: ops.a }).then(() => { halted = true; });
    await new Promise((r) => setTimeout(r, 300));
    expect(halted).toBe(false);
    released();
    expect(await inflight).toBeNull(); // it started before the stop and completed
    await halting;
    for (const firm of [pilot, legacy]) {
      expect(await cfg.resolvePipelineMode(firm)).toMatchObject({ mode: "held", refused: expect.stringMatching(/EMERGENCY SHUTDOWN/) });
      expect(await withTenant(firm, (tx) => guard.rtaWriteDenial(tx, firm, "bypass"))).toMatchObject({ code: "stopped" });
      expect(await withTenant(firm, (tx) => guard.rtaWriteDenial(tx, firm, "derived"))).toMatchObject({ code: "stopped" });
    }
    await expect(withTenant(pilot, (tx) => gate.assertPostingAllowed(tx, pilot))).rejects.toThrow(/EMERGENCY SHUTDOWN/);
    // The drop folder keeps the legacy firm's file and records nothing.
    const { ingestRtaText } = await import("@/lib/rta/ingest");
    const r = await withTenant(legacy, (tx) => ingestRtaText(tx, { tenantId: legacy, source: "kfintech", kind: "daily_transaction_feed", fileName: "drop.csv",
      text: csvOf(MFSD201_HEADER, [{ "Fund": "117", "Folio Number": "1", "Product Code": "117EQGR", "Transaction Number": "1", PAN1: P.adult }]).toString("utf8") }));
    expect(r).toMatchObject({ status: "held", importId: null });
    await expect(C.setPostingHalt({ scope: "emergency", halted: false, reason: "drill over, all clear given", changedBy: ops.a })).rejects.toThrow(/second operator/);
    await C.setPostingHalt({ scope: "emergency", halted: false, reason: "drill over, all clear given", changedBy: ops.a, approvedBy: ops.b });
    expect((await cfg.resolvePipelineMode(legacy)).mode).toBe("off");
    expect((await cfg.resolvePipelineMode(pilot)).mode).toBe("validate_first");
  });
});
