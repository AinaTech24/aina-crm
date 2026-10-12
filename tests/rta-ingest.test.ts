/**
 * Drop-folder ingest (lib/rta/ingest.ts) gets the same file handling as the
 * upload worker: `ingestRtaFile` (bytes) detects / unpacks / decodes, and
 * `ingestRtaText` (what workers/feed-ingest.ts still calls) refuses a binary
 * file that was read as UTF-8 instead of parsing garbage. SYNTHETIC files;
 * the row processor is mocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const h = vi.hoisted(() => {
  process.env.ALLOW_SYSTEM_TX = "1";
  return { processed: [] as string[] };
});

vi.mock("@/lib/rta/process", () => ({
  processRtaFile: vi.fn(async (_tx: unknown, args: { text: string }) => {
    h.processed.push(args.text);
    return { rowsTotal: 1, rowsImported: 1, rowsSkipped: 0, rowsFailed: 0, errors: [], periodStart: "junk", periodEnd: "2024-10-02" };
  }),
}));

import { binaryTextReason, ingestRtaFile, ingestRtaText } from "@/lib/rta/ingest";
import { CSV_FEED, FAKE_FOLIO, SERIAL, makeWorkbook, makeZip } from "./rta-fixtures";

describe("binaryTextReason", () => {
  it("flags a zip / xlsx and NUL-bearing binaries read as UTF-8, passes real text", async () => {
    const asUtf8 = (b: Uint8Array) => Buffer.from(b).toString("utf8");
    expect(binaryTextReason(asUtf8(makeWorkbook([["a", "b", "c"]], "xlsx")))).toMatch(/zip archive or an \.xlsx/);
    expect(binaryTextReason(asUtf8(await makeZip([{ name: "a.csv", data: CSV_FEED }])))).toMatch(/zip archive/);
    expect(binaryTextReason(asUtf8(makeWorkbook([["a", "b", "c"]], "biff8")))).toMatch(/binary/);
    expect(binaryTextReason(Buffer.from(CSV_FEED, "utf16le").toString("utf8"))).toMatch(/binary/);
    expect(binaryTextReason(CSV_FEED)).toBeNull();
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("ingestRtaFile / ingestRtaText (DB-backed)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  const tenantId = randomUUID();
  const base = { tenantId, source: "cams" as const, kind: "daily_transaction_feed" as const, uploadedBy: null };

  beforeAll(async () => {
    ({ withSystem, withTenant } = await import("@/db/client"));
    const schema = await import("@/db/schema");
    await withSystem(async (tx) => {
      await tx.insert(schema.tenants).values({ id: tenantId, legalName: "RTA Ingest Test", displayName: "RTA Ingest Test", arn: `ARN-RI-${tenantId.slice(0, 6)}` } as any);
    });
  });
  afterAll(async () => {
    try {
      const { sql } = await import("drizzle-orm");
      await withSystem(async (tx) => {
        await tx.execute(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${tenantId}::uuid`);
        await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
      });
    } catch {
      /* best-effort */
    }
  });

  it("an .xlsx is read as a workbook (dates ISO) and a junk period date does not break the status write", async () => {
    h.processed.length = 0;
    const bytes = makeWorkbook([["Folio", "TrDate", "Amount"], [FAKE_FOLIO, { date: SERIAL.oct2_2024 }, 1000]], "xlsx");
    const r = await withTenant(tenantId, (tx) => ingestRtaFile(tx, { ...base, fileName: "cams__daily_transaction_feed__a.xlsx", bytes }));
    expect(r.status).toBe("completed");
    expect(h.processed).toEqual([`Folio|TrDate|Amount\n${FAKE_FOLIO}|2024-10-02|1000`]);
  });

  it("a zip with one CSV is unpacked", async () => {
    h.processed.length = 0;
    const bytes = await makeZip([{ name: "feed.csv", data: "Folio,Amount,Scheme\n9999999/98,5,S\n" }]);
    const r = await withTenant(tenantId, (tx) => ingestRtaFile(tx, { ...base, fileName: "cams__daily_transaction_feed__b.zip", bytes }));
    expect(r.status).toBe("completed");
    expect(h.processed).toEqual(["Folio|Amount|Scheme\n9999999/98|5|S\n"]);
  });

  it("an encrypted zip (no password in a drop folder) is a failed row with the reason", async () => {
    const bytes = await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Synth#1" });
    const r = await withTenant(tenantId, (tx) => ingestRtaFile(tx, { ...base, fileName: "cams__daily_transaction_feed__c.zip", bytes }));
    expect(r).toMatchObject({ status: "failed", error: expect.stringMatching(/encrypted entry/) });
    expect(r.importId).toBeTruthy();
  });

  it("ingestRtaText refuses an .xlsx that was read as UTF-8 text", async () => {
    h.processed.length = 0;
    const text = makeWorkbook([["a", "b", "c"]], "xlsx").toString("utf8");
    const r = await withTenant(tenantId, (tx) => ingestRtaText(tx, { ...base, fileName: "cams__daily_transaction_feed__d.xlsx", text }));
    expect(r.status).toBe("failed");
    expect(h.processed).toEqual([]);
  });
});
