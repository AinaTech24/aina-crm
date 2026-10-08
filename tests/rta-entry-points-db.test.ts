/**
 * Phase 3H — the API entry points that could write RTA-derived records outside
 * the validate-first pipeline, called through their real route handlers on a
 * real Postgres (only the session is mocked). A validate-first firm refuses the
 * second ways in; a paused firm refuses everything that moves RTA-derived
 * records; a legacy firm keeps them as before.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const TEST_DB = process.env.TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => h.session),
  getSession: vi.fn(async () => h.session),
}));
vi.mock("@/lib/auth/license", () => ({ assertActiveLicense: vi.fn(async () => {}), loadTenantLicense: vi.fn(async () => ({ maxInvestors: 100000 })) }));

const json = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe.skipIf(!TEST_DB)("RTA-derived write entry points (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let C: typeof import("@/lib/rta/posting/controls");
  const vfFirm = randomUUID(), legacyFirm = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const owner = randomUUID();
  const as = (tenantId: string) => { h.session = { userId: tenantId === vfFirm ? owner : randomUUID(), tenantId, branchId: null, roles: ["owner"], permissions: [] }; };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    C = await import("@/lib/rta/posting/controls");
    await withSystem(async (tx) => {
      for (const [id, n] of [[vfFirm, "V"], [legacyFirm, "L"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"Entry " + n}, ${"Entry " + n}, ${"ARN-EP" + n + id.slice(0, 6)})`);
      }
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${vfFirm}::uuid, ${`owner-${vfFirm.slice(0, 8)}@example.test`}, 'Entry Owner', ARRAY['owner']::text[], 'active')`);
    });
    await C.activateTenant({ tenantId: vfFirm, mode: "validate_first", postingEnabled: true, reason: "entry-point test: pilot firm", approvalRef: "CHG-EP", requestedBy: ops.a, approvedBy: ops.b });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const id of [vfFirm, legacyFirm]) {
      for (const table of ["rta_pipeline_activations", "transactions", "folios", "audit_log", "investor_merges"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${id}'`));
      await tryRun(sql`UPDATE investors SET merged_into_id = NULL, merged_by_id = NULL WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM users WHERE tenant_id = ${id}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${id}::uuid`);
    }
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
  });

  it("generic transaction import (parse + commit): refused for a validate-first firm, unchanged for a legacy firm", async () => {
    const parse = await import("@/app/api/transactions/import/parse/route");
    const commit = await import("@/app/api/transactions/import/commit/route");
    const form = () => { const f = new FormData(); f.set("file", new File(["pan,type,amount\nZZZPA1111A,sip,1000\n"], "t.csv", { type: "text/csv" })); return f; };
    as(vfFirm);
    const p1 = await parse.POST(new NextRequest("http://localhost/api/transactions/import/parse", { method: "POST", body: form() }));
    expect(p1.status).toBe(409);
    expect((await p1.json()).error).toMatch(/validate-first only/);
    const c1 = await commit.POST(json("/api/transactions/import/commit", { mapping: { pan: "pan", type: "type", amount: "amount" }, rows: [{ pan: "ZZZPA1111A", type: "sip", amount: "1000" }] }));
    expect(c1.status).toBe(409);
    expect((await withTenant(vfFirm, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${vfFirm}::uuid`)).rows[0] as any)).n).toBe(0);
    as(legacyFirm);
    const p2 = await parse.POST(new NextRequest("http://localhost/api/transactions/import/parse", { method: "POST", body: form() }));
    expect(p2.status).toBe(200);
  });

  it("reconciliation 'sync to CRM' (single and bulk): refused for a validate-first firm before anything is read", async () => {
    const one = await import("@/app/api/reconciliation/exceptions/[id]/sync/route");
    const bulk = await import("@/app/api/reconciliation/exceptions/bulk/route");
    as(vfFirm);
    const r1 = await one.POST(json("/api/reconciliation/exceptions/x/sync", {}), { params: Promise.resolve({ id: randomUUID() }) } as any);
    expect(r1.status).toBe(409);
    const r2 = await bulk.POST(json("/api/reconciliation/exceptions/bulk", { action: "sync", ids: [randomUUID()] }));
    expect(r2.status).toBe(409);
    as(legacyFirm);
    const r3 = await one.POST(json("/api/reconciliation/exceptions/x/sync", {}), { params: Promise.resolve({ id: randomUUID() }) } as any);
    expect(r3.status).not.toBe(409);
  });

  it("client merge and unmerge: refused while the firm is paused; allowed again after resume", async () => {
    const merge = await import("@/app/api/investors/merge/route");
    const unmerge = await import("@/app/api/investors/unmerge/route");
    const ids = { a: randomUUID(), b: randomUUID() };
    await withTenant(vfFirm, async (tx) => {
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${ids.a}::uuid, ${vfFirm}::uuid, 'ZZZPE5555E', 'Entry A'), (${ids.b}::uuid, ${vfFirm}::uuid, NULL, 'Entry A dup')`);
    });
    await C.activateTenant({ tenantId: vfFirm, mode: "paused", postingEnabled: false, reason: "entry-point test: firm paused", approvedBy: ops.a });
    as(vfFirm);
    const m1 = await merge.POST(json("/api/investors/merge", { survivorId: ids.a, loserId: ids.b, reason: "duplicate record of the same person" }));
    expect(m1.status).toBe(409);
    expect((await m1.json()).error).toMatch(/paused/);
    const u1 = await unmerge.POST(json("/api/investors/unmerge", { mergeId: randomUUID() }));
    expect(u1.status).toBe(409);
    await C.activateTenant({ tenantId: vfFirm, mode: "validate_first", postingEnabled: true, reason: "entry-point test: resumed", approvalRef: "CHG-EP2", requestedBy: ops.a, approvedBy: ops.b });
    const m2 = await merge.POST(json("/api/investors/merge", { survivorId: ids.a, loserId: ids.b, reason: "duplicate record of the same person" }));
    expect(m2.status).toBe(200);
  });

  it("the operator controls refuse a firm session", async () => {
    const ctl = await import("@/app/api/super-admin/rta-pipeline/route");
    as(vfFirm);
    const r = await ctl.POST(json("/api/super-admin/rta-pipeline", { action: "halt", scope: "emergency", reason: "a firm owner trying to stop everyone" }));
    expect([401, 403]).toContain(r.status);
  });
});
