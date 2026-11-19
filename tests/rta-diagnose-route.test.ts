/**
 * The page-side "why won't this open" check: reads the stored file and the firm's saved
 * passwords, and names who supplied a match without ever returning a password.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const TEST_DB = process.env.TEST_DATABASE_URL;
const tenant = randomUUID();
const userId = randomUUID();

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ tenantId: tenant, userId, roles: ["owner"], permissions: [], branchId: null }),
}));
vi.mock("@/lib/auth/rbac", () => ({ require: () => undefined, can: () => true }));

async function aes(password: string): Promise<Uint8Array> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { password, useWebWorkers: false });
  await w.add("WBR2.txt", new TextReader("a|b\n1|2\n"));
  return new Uint8Array(await (await w.close()).arrayBuffer());
}

describe.skipIf(!TEST_DB)("POST /api/rta-imports/[id]/diagnose", () => {
  const ids = { locked: randomUUID(), notzip: randomUUID() };
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const call = async (id: string, password?: string) => {
    const { POST } = await import("@/app/api/rta-imports/[id]/diagnose/route");
    const res = await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ password }) }) as never, { params: Promise.resolve({ id }) });
    return { status: res.status, json: await res.json() };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    const { putObject } = await import("@/lib/storage/s3");
    const cfg = await import("@/lib/rta/mailback-config");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Dg', 'Dg', ${"ARN-DG-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles) VALUES (${userId}::uuid, ${tenant}::uuid, ${"dg-" + tenant.slice(0, 6) + "@x.in"}, 'Dg', ARRAY['owner']::text[])`).catch(() => {});
    await withSystem(async (tx) => { await cfg.saveMailbackPasswords(tx, tenant, { camsPasswords: [{ password: "Saved#1" }] }); });
    const put = async (id: string, name: string, bytes: Uint8Array) => {
      const key = `tenants/${tenant}/rta/${name}`;
      await putObject(key, Buffer.from(bytes), "application/zip");
      await q(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
                  VALUES (${id}::uuid, ${tenant}::uuid, 'cams', 'daily_transaction_feed', current_date, current_date, ${name}, ${key}, 'rejected')`);
    };
    await put(ids.locked, "locked.zip", await aes("Real#Pass9"));
    await put(ids.notzip, "notzip.zip", new TextEncoder().encode("Invalid request"));
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["audit_log", "rta_file_imports", "tenant_integrations", "users"]) await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
    const { rmSync } = await import("node:fs");
    rmSync(`node-local/uploads/tenants/${tenant}`, { recursive: true, force: true });
  });

  it("says no tested password fits an AES file locked with another one", async () => {
    const r = await call(ids.locked, "Typed#Wrong");
    expect(r.status).toBe(200);
    expect(r.json.entries[0].kind).toMatch(/^AES-256/);
    expect(r.json.entries[0].matches).toEqual([]);
    expect(r.json.verdict).toMatch(/another password/);
    expect(r.json.savedTried).toBe(1);
  });

  it("names the typed password when it is the right one, and never returns a password", async () => {
    const r = await call(ids.locked, "Real#Pass9");
    expect(r.json.entries[0].matches).toEqual([{ who: "the password you typed now", form: "as typed, UTF-8" }]);
    const text = JSON.stringify(r.json);
    expect(text).not.toContain("Real#Pass9");
    expect(text).not.toContain("Saved#1");
  });

  it("tests several guesses separated by | and names the right one by position", async () => {
    const r = await call(ids.locked, "ARN-1| Wrong#2 |Real#Pass9|ARN-1");
    expect(r.json.typedCount).toBe(3);
    expect(r.json.entries[0].matches).toEqual([{ who: "typed password #3", form: "as typed, UTF-8" }]);
    expect(JSON.stringify(r.json)).not.toContain("Real#Pass9");
  });

  it("says plainly when the stored bytes are not a ZIP", async () => {
    const r = await call(ids.notzip);
    expect(r.json.startsWithPK).toBe(false);
    expect(r.json.verdict).toMatch(/Not a ZIP/);
  });

  it("404s an unknown import", async () => {
    expect((await call(randomUUID())).status).toBe(404);
  });
});
