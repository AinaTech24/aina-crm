/**
 * A completed import keeps its source file for 14 days so the whole file can be downloaded from the
 * RTA File Imports page; the nightly sweep then removes it and clears the row's file_key.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

vi.mock("@/workers/queues", () => ({
  RTA_BACKGROUND_PRIORITY: 100,
  Q: { rtaImport: () => ({ add: async () => {} }) },
}));

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("kept source files of completed imports", () => {
  const tenant = randomUUID();
  const ids = { old: randomUUID(), fresh: randomUUID(), sharedA: randomUUID(), sharedB: randomUUID() };
  const keyOf = (n: string) => `tenants/${tenant}/rta/${n}`;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const onDisk = (n: string) => existsSync(`node-local/uploads/${keyOf(n)}`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    const { putObject } = await import("@/lib/storage/s3");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Kp', 'Kp', ${"ARN-KP-" + tenant.slice(0, 6)})`);
    for (const n of ["old.csv", "fresh.csv", "shared.csv"]) await putObject(keyOf(n), Buffer.from("a|b\n1|2\n"), "text/csv");
    const ins = (id: string, n: string, ago: string) => q(sql`
      INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status, parsed_at)
      VALUES (${id}::uuid, ${tenant}::uuid, 'cams', 'daily_transaction_feed', current_date, current_date, ${n}, ${keyOf(n)}, 'completed', now() - ${ago}::interval)`);
    await ins(ids.old, "old.csv", "30 days");
    await ins(ids.fresh, "fresh.csv", "1 day");
    // one object shared by an old and a fresh completed row: kept until BOTH are old
    await ins(ids.sharedA, "shared.csv", "30 days");
    await ins(ids.sharedB, "shared.csv", "1 day");
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
    const { rmSync } = await import("node:fs");
    rmSync(`node-local/uploads/tenants/${tenant}`, { recursive: true, force: true });
  });

  it("removes an old completed file and blanks its key; keeps a fresh one and a shared one", async () => {
    const { sweepKeptCompletedFiles } = await import("@/workers/rta-import-worker");
    await sweepKeptCompletedFiles();
    const key = async (id: string) => ((await q(sql`SELECT file_key FROM rta_file_imports WHERE id = ${id}::uuid`)).rows as any[])[0].file_key;
    expect(onDisk("old.csv")).toBe(false);
    expect(await key(ids.old)).toBe("");
    expect(onDisk("fresh.csv")).toBe(true);
    expect(await key(ids.fresh)).not.toBeNull();
    expect(onDisk("shared.csv")).toBe(true);
    expect(await key(ids.sharedA)).not.toBeNull();
  });
});
