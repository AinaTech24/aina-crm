/**
 * Phase 3G — the production-capable posting controls, against a real Postgres
 * (RLS on, non-superuser role), with RTA_POSTING_MODE=controlled.
 *
 * Proves: a firm with no activation is off; posting needs an activation with
 * two people; the process ceiling, a revoked or expired activation and either
 * kill switch REFUSE (never fall back to the existing importer); halting waits
 * for an in-flight posting and stops the next one; the controls are
 * append-only; posting refuses a superuser / BYPASSRLS role and a transaction
 * scoped to another firm; the drop folder no longer feeds a validate-first firm
 * to the existing importer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD211_HEADER, csvOf, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

const sip = (txn: string, folio = "96000001") => ({
  "Fund": "117", "Folio Number": folio, "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult,
});

/** The database's own message (Drizzle wraps it; the reason is on .cause). */
const dbError = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e: any) { return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`; } };

describe.skipIf(!TEST_DB)("posting controls — controlled mode (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let C: typeof import("@/lib/rta/posting/controls");
  let gate: typeof import("@/lib/rta/posting/gate");
  let cfg: typeof import("@/lib/rta/staging/config");
  let vf: typeof import("@/lib/rta/posting/validate-first");
  const t = randomUUID();
  const other = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>, tenant = t) => withTenant(tenant, async (tx) => (await tx.execute(s)).rows as T[]);
  const txCount = async () => (await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid`))[0].n as number;
  const importFile = async (name: string, buf: Buffer) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const enable = (extra: Partial<Parameters<typeof C.activateTenant>[0]> = {}) => C.activateTenant({
    tenantId: t, mode: "validate_first", postingEnabled: true, reason: "pilot activation for controls test", approvalRef: "CHG-TEST-1",
    requestedBy: ops.a, approvedBy: ops.b, ...extra,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.RTA_POSTING_MODE = "controlled";
    process.env.RTA_PIPELINE_MODE = "validate_first";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    C = await import("@/lib/rta/posting/controls");
    gate = await import("@/lib/rta/posting/gate");
    cfg = await import("@/lib/rta/staging/config");
    vf = await import("@/lib/rta/posting/validate-first");
    await C.setPostingHalt({ scope: "global", halted: false, reason: "development test database: posting released", changedBy: ops.a, approvedBy: ops.b });
    await withSystem(async (tx) => {
      for (const [id, n] of [[t, "C"], [other, "D"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"Controls " + n}, ${"Controls " + n}, ${"ARN-CT" + n + id.slice(0, 6)})`);
      }
    });
    // A client and folio on record, so a transaction can post once allowed.
    await withTenant(t, async (tx) => {
      const inv = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Controls Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, '117', 'AMC 117', '96000001', 'kfintech')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const id of [t, other]) {
      for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "rta_pipeline_activations"]) {
        await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${id}'`));
      }
      await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_economic_txns WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_batches WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM rta_posting_controls WHERE scope = ${id}`);
      await tryRun(sql`DELETE FROM folios WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${id}::uuid`);
    }
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
  });

  it("default: a firm with no activation is OFF (the existing importer, as today) and cannot post", async () => {
    expect(await cfg.resolvePipelineMode(t)).toEqual({ mode: "off" });
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t))).rejects.toThrow(/not activated for validate-first \(current mode: off\)/);
  });

  it("enabling posting needs two different people, a reason and a change reference — in code AND in the database", async () => {
    await expect(enable({ approvedBy: ops.a })).rejects.toThrow(/DIFFERENT approver/);
    await expect(enable({ requestedBy: null })).rejects.toThrow(/DIFFERENT approver/);
    await expect(enable({ approvalRef: "" })).rejects.toThrow(/change \/ approval reference/);
    await expect(enable({ reason: "short" })).rejects.toThrow(/reason/);
    await expect(enable({ mode: "shadow" })).rejects.toThrow(/only be enabled in validate_first/);
    // The table refuses it even when the library is bypassed.
    await expect(withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, requested_by, approved_by)
      VALUES (${t}::uuid, 'validate_first', true, 'one person trying alone', ${ops.a}::uuid, ${ops.a}::uuid)`))).rejects.toThrow();
    expect(await cfg.resolvePipelineMode(t)).toEqual({ mode: "off" });
  });

  it("activated with posting: validate-first runs and posts once; the audit log names the activation and the batch", async () => {
    const a = await enable();
    expect(a).toMatchObject({ mode: "validate_first", postingEnabled: true, approvedBy: ops.b, requestedBy: ops.a });
    expect(await cfg.resolvePipelineMode(t)).toEqual({ mode: "validate_first" });
    const r = await importFile("c1.csv", csvOf(MFSD201_HEADER, [sip("910001")]));
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
    const audit = await q(sql`SELECT action FROM audit_log WHERE tenant_id = ${t}::uuid ORDER BY at`);
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["rta.pipeline.activate", "rta.posting.batch"]));
  });

  it("the process ceiling below validate-first REFUSES an activated firm — it is never sent to the existing importer", async () => {
    for (const ceiling of ["off", "shadow", ""]) {
      const d = await cfg.resolvePipelineMode(t, { ...process.env, RTA_PIPELINE_MODE: ceiling });
      expect(d.mode).toBe("validate_first_refused");
      expect(d.refused).toMatch(/held, not sent to the existing importer/);
    }
    // The process kill switch refuses too.
    expect((await cfg.resolvePipelineMode(t, { ...process.env, RTA_POSTING_HALT: "1" })).mode).toBe("validate_first_refused");
  });

  it("the firm's kill switch: halting waits for an in-flight posting, then refuses the next; releasing needs a second person", async () => {
    // An in-flight posting holds the controls FOR SHARE until it commits.
    let released!: () => void;
    const hold = new Promise<void>((r) => { released = r; });
    const inflight = withTenant(t, async (tx) => { await gate.assertPostingAllowed(tx, t); await hold; return "committed"; });
    await new Promise((r) => setTimeout(r, 150));
    let halted = false;
    const halting = C.setPostingHalt({ scope: t, halted: true, reason: "incident: wrong file posted for this firm", changedBy: ops.a }).then(() => { halted = true; });
    await new Promise((r) => setTimeout(r, 300));
    expect(halted).toBe(false); // waiting for the in-flight batch
    released();
    expect(await inflight).toBe("committed");
    await halting;
    expect(halted).toBe(true);
    const before = await txCount();
    expect((await cfg.resolvePipelineMode(t)).mode).toBe("validate_first_refused");
    await expect(importFile("c2.csv", csvOf(MFSD201_HEADER, [sip("910002")]))).rejects.toThrow(/halted \(this firm\)/);
    expect(await txCount()).toBe(before);
    await expect(C.setPostingHalt({ scope: t, halted: false, reason: "incident closed after reconciliation", changedBy: ops.a })).rejects.toThrow(/second operator/);
    await expect(C.setPostingHalt({ scope: t, halted: false, reason: "incident closed after reconciliation", changedBy: ops.a, approvedBy: ops.a })).rejects.toThrow(/second operator/);
    await C.setPostingHalt({ scope: t, halted: false, reason: "incident closed after reconciliation", changedBy: ops.a, approvedBy: ops.b });
    expect((await cfg.resolvePipelineMode(t)).mode).toBe("validate_first");
    const ev = await withSystem(async (tx) => (await tx.execute(sql`SELECT posting_halted FROM rta_posting_control_events WHERE scope = ${t} ORDER BY at`)).rows as any[]);
    expect(ev.map((e) => e.posting_halted)).toEqual([true, false]);
    expect(await dbError(withSystem((tx) => tx.execute(sql`DELETE FROM rta_posting_control_events WHERE scope = ${t}`)))).toMatch(/append-only/);
  });

  it("revoked or expired: the firm is off again for new imports; activations are append-only", async () => {
    await C.revokeActivation({ tenantId: t, revokedBy: ops.a, reason: "pilot paused by operations" });
    expect(await cfg.resolvePipelineMode(t)).toEqual({ mode: "off" });
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t))).rejects.toThrow(/not activated/);
    const [row] = await q(sql`SELECT id FROM rta_pipeline_activations WHERE tenant_id = ${t}::uuid AND posting_enabled ORDER BY created_at DESC LIMIT 1`);
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`UPDATE rta_pipeline_activations SET mode = 'shadow' WHERE id = ${row.id}::uuid`)))).toMatch(/never edited/);
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`UPDATE rta_pipeline_activations SET revoke_reason = 'changed my mind' WHERE id = ${row.id}::uuid`)))).toMatch(/never edited/);
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`DELETE FROM rta_pipeline_activations WHERE id = ${row.id}::uuid`)))).toMatch(/never deleted/);
    // An activation that has expired is not current.
    await enable({ effectiveFrom: new Date(Date.now() - 2 * 864e5).toISOString(), expiresAt: new Date(Date.now() - 864e5).toISOString() }).catch(() => null);
    expect(await cfg.resolvePipelineMode(t)).toEqual({ mode: "off" });
  });

  it("posting refuses a superuser / BYPASSRLS connection and a transaction scoped to another firm", async () => {
    await enable();
    await expect(withTenant(other, (tx) => gate.assertPostingAllowed(tx, t))).rejects.toThrow(/not scoped to this firm/);
    const pg = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const su = new pg.default.Client({ connectionString: TEST_DB!.replace(/\/\/[^@]+@/, "//postgres:postgres@") });
    await su.connect();
    try {
      await su.query("BEGIN");
      await su.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
      await expect(gate.assertPostingAllowed(drizzle(su) as any, t)).rejects.toThrow(/bypasses row-level security/);
    } finally {
      await su.query("ROLLBACK").catch(() => {});
      await su.end();
    }
  });

  it("the drop folder never runs the existing importer for a validate-first firm", async () => {
    const { ingestRtaText } = await import("@/lib/rta/ingest");
    const before = await txCount();
    const r = await withTenant(t, (tx) => ingestRtaText(tx, { tenantId: t, source: "kfintech", kind: "daily_transaction_feed", fileName: "drop.csv", text: csvOf(MFSD201_HEADER, [sip("910099")]).toString("utf8") }));
    expect(r).toMatchObject({ status: "failed", error: expect.stringMatching(/drop folder does not run that path/) });
    expect(await txCount()).toBe(before);
    // A firm that is not activated keeps the drop folder (the existing importer) exactly as today.
    expect((await cfg.resolvePipelineMode(other)).mode).toBe("off");
  });

  it("an activation for one firm never changes another firm's mode", async () => {
    expect((await cfg.resolvePipelineMode(t)).mode).toBe("validate_first");
    expect((await cfg.resolvePipelineMode(other)).mode).toBe("off");
    const seen = await q(sql`SELECT count(*)::int AS n FROM rta_pipeline_activations`, other);
    expect(seen[0].n).toBe(0); // RLS: the other firm cannot see this firm's activation
    void MFSD211_HEADER;
  });
});
