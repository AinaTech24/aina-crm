/**
 * An encrypted CAMS workbook through the real worker: refused with a password message when no
 * saved password fits, opened (and no longer called a "layout" problem) when one does, and a
 * rescan re-queues the locked file once the password is saved — but never a file that is just
 * an unrecognised layout.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";

const added: Array<{ name: string; data: any }> = [];
vi.mock("@/workers/queues", () => ({
  RTA_BACKGROUND_PRIORITY: 100,
  Q: { rtaImport: () => ({ add: async (name: string, data: any) => { added.push({ name, data }); } }) },
}));

const TEST_DB = process.env.TEST_DATABASE_URL;

function workbook(): Buffer {
  const rows = [["Alpha", "Beta", "Gamma"], ...Array.from({ length: 8 }, (_, i) => [`r${i}`, i, "x"])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe.skipIf(!TEST_DB)("encrypted Excel through the import worker", () => {
  const tenant = randomUUID();
  const user = randomUUID();
  const ids = { locked: randomUUID(), plainBad: randomUUID() };
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const row = async (id: string) => ((await q(sql`SELECT status, remarks FROM rta_file_imports WHERE id = ${id}::uuid`)).rows as any[])[0];
  const keyOf = (n: string) => `tenants/${tenant}/rta/${n}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    const { putObject } = await import("@/lib/storage/s3");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Xl', 'Xl', ${"ARN-XL-" + tenant.slice(0, 6)})`);
    await putObject(keyOf("WebTrxns.xls"), Buffer.from(officeCrypto.encrypt(workbook(), { password: "Secret@12" })), "application/vnd.ms-excel");
    // Not locked, just a layout nobody reads — must not be re-queued for ever.
    await putObject(keyOf("odd.xls"), Buffer.from("x|y\n".repeat(60)), "application/vnd.ms-excel");
    for (const [id, name] of [[ids.locked, "WebTrxns.xls"], [ids.plainBad, "odd.xls"]]) {
      await q(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status, remarks)
                  VALUES (${id}::uuid, ${tenant}::uuid, 'cams', 'daily_transaction_feed', current_date, current_date, ${name}, ${keyOf(name)}, 'failed',
                          'The file has 49 data lines but none could be read — its layout is not one this importer recognises, so nothing was imported. First line: x')`);
    }
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["rta_file_imports", "tenant_integrations"]) await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
    const { rmSync } = await import("node:fs");
    rmSync(`node-local/uploads/tenants/${tenant}`, { recursive: true, force: true });
  });

  const job = (passwords: string[]) => ({
    importId: ids.locked, tenantId: tenant, source: "cams" as const, kind: "daily_transaction_feed" as any,
    key: keyOf("WebTrxns.xls"), filename: "WebTrxns.xls", passwords, userId: user, roles: ["owner"],
  });

  it("with no fitting saved password the row is rejected and says it is a password", async () => {
    const { runRtaImportJob } = await import("@/workers/rta-import-worker");
    await runRtaImportJob(job(["wrong-one"]));
    const r = await row(ids.locked);
    expect(r.status).toBe("rejected");
    expect(r.remarks).toMatch(/password-protected/);
    expect(r.remarks).not.toMatch(/layout/);
  });

  it("a rescan re-queues the locked workbook only once its password is saved, never the plain layout failure", async () => {
    const cfg = await import("@/lib/rta/mailback-config");
    const { runRejectedRescanJob, enqueueRescansForAllFirms } = await import("@/workers/rta-import-worker");
    await withSystem(async (tx) => { await cfg.saveMailbackPasswords(tx, tenant, { camsPasswords: [{ password: "nope" }] }); });
    added.length = 0;
    let r = await runRejectedRescanJob({ mode: "rescan", tenantId: tenant, source: "cams" });
    expect(r.requeued).toBe(0);
    // still locked: the misleading "layout not recognised" wording is replaced by the true reason
    const still = await row(ids.locked);
    expect(still.status).toBe("rejected");
    expect(still.remarks).toMatch(/password-protected/);

    await withSystem(async (tx) => { await cfg.appendMailbackPassword(tx, tenant, "cams", { label: "Later", password: "Secret@12" }); });
    expect((await enqueueRescansForAllFirms()).firms).toBeGreaterThanOrEqual(1);
    r = await runRejectedRescanJob({ mode: "rescan", tenantId: tenant, source: "cams" });
    expect(r.requeued).toBe(1);
    expect((await row(ids.locked)).status).toBe("uploaded");
    expect((await row(ids.plainBad)).status).toBe("failed");
  });

  it("with the saved password the workbook opens: it is no longer a password refusal", async () => {
    const { runRtaImportJob } = await import("@/workers/rta-import-worker");
    await runRtaImportJob(job(["x", "Secret@12"]));
    const r = await row(ids.locked);
    expect(r.remarks ?? "").not.toMatch(/password/i);
    expect(r.status).not.toBe("rejected");
  });
});
