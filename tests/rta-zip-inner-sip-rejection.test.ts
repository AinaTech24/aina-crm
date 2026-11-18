/**
 * A ZIP named after one report can carry a SIP rejection / bounce report. The file inside says what
 * it is, so it is read as a rejection report (its rows reach the SIP Rejections page).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

vi.mock("@/workers/queues", () => ({
  RTA_BACKGROUND_PRIORITY: 100,
  Q: { rtaImport: () => ({ add: async () => {} }) },
}));

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("a rejection report inside a ZIP named after another report", () => {
  const tenant = randomUUID();
  const importId = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    const { putObject } = await import("@/lib/storage/s3");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Zr', 'Zr', ${"ARN-ZR-" + tenant.slice(0, 6)})`);
    const text = readFileSync("public/sample-rta/cams_sip_rejection_report.txt", "utf8");
    const w = new ZipWriter(new BlobWriter("application/zip"), { password: "Secret#1", useWebWorkers: false });
    await w.add("SIP_REJECTION_REPORT_17NOV.txt", new TextReader(text));
    const zip = new Uint8Array(await (await w.close()).arrayBuffer());
    const key = `tenants/${tenant}/rta/zr.zip`;
    await putObject(key, Buffer.from(zip), "application/zip");
    await q(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
                VALUES (${importId}::uuid, ${tenant}::uuid, 'cams', 'daily_transaction_feed', current_date, current_date, 'WBR2_ZR.zip', ${key}, 'uploaded')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
    const { rmSync } = await import("node:fs");
    rmSync(`node-local/uploads/tenants/${tenant}`, { recursive: true, force: true });
  });

  it("is read as a SIP rejection report", async () => {
    const { runRtaImportJob } = await import("@/workers/rta-import-worker");
    await runRtaImportJob({
      importId, tenantId: tenant, source: "cams", kind: "daily_transaction_feed" as any,
      key: `tenants/${tenant}/rta/zr.zip`, filename: "WBR2_ZR.zip", passwords: ["Secret#1"],
      userId: randomUUID(), roles: ["owner"],
    });
    const row = ((await q(sql`SELECT kind, status, remarks FROM rta_file_imports WHERE id = ${importId}::uuid`)).rows as any[])[0];
    expect(row.kind).toBe("sip_rejection_report");
    expect(row.status).not.toBe("rejected");
  });
});
