/**
 * The upload worker's file handling and status machine (E3, E16, E17).
 *
 *   - openUpload: what BOTH import paths (feed and rich/master) do with the
 *     uploaded object — a workbook passes through, a real archive is unpacked
 *     with every saved password, multi-file archives are refused.
 *   - job timing: the reaper waits longer than a job may run.
 *   - DB-backed (TEST_DATABASE_URL): a retry clears the previous attempt's
 *     remark / counts / errors; a plain .xlsx reaches the parser as its cells;
 *     the rich path shows `parsing` and records a clean failure.
 *
 * Storage and the row processor are mocked; every file is SYNTHETIC and built
 * in memory (tests/rta-fixtures.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.ALLOW_SYSTEM_TX = "1";
  return {
    store: new Map<string, Uint8Array>(),
    processed: [] as string[],
  };
});

vi.mock("@/lib/storage/s3", () => ({
  getObjectBytes: vi.fn(async (key: string) => {
    if (key.startsWith("slow-")) await new Promise((r) => setTimeout(r, 300));
    const b = h.store.get(key);
    if (!b) throw new Error("The specified key does not exist.");
    return Buffer.from(b);
  }),
  deleteObject: vi.fn(async () => {}),
}));

vi.mock("@/lib/rta/process", () => ({
  processRtaFile: vi.fn(async (_tx: unknown, args: { text: string }) => {
    h.processed.push(args.text);
    return { rowsTotal: 1, rowsImported: 1, rowsSkipped: 0, rowsFailed: 0, errors: [], periodStart: "2024-10-02", periodEnd: "2024-10-02" };
  }),
}));

import { openUpload, markParsing, runRtaImportJob, runRichImportJob } from "@/workers/rta-import-worker";
import { rtaJobTiming, REAP_MARGIN_MIN } from "@/lib/rta/job-timing";
import { PASSWORD_PROTECTED_WORKBOOK } from "@/lib/rta/file-kind";
import { CSV_FEED, FAKE_FOLIO, SERIAL, makeEncryptedOoxmlLookalike, makeWorkbook, makeZip } from "./rta-fixtures";

const ROWS = [
  ["Folio", "TrDate", "Amount"],
  [FAKE_FOLIO, { date: SERIAL.oct2_2024 }, 1000],
];

describe("openUpload (shared by the feed and rich import paths)", () => {
  it("a plain .xlsx is passed through untouched — not unzipped", async () => {
    const xlsx = makeWorkbook(ROWS, "xlsx");
    const r = await openUpload(xlsx, "feed.xlsx", []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filename).toBe("feed.xlsx");
      expect(Buffer.compare(Buffer.from(r.data), xlsx)).toBe(0);
    }
  });

  it("a .xls passes through", async () => {
    const xls = makeWorkbook(ROWS, "biff8");
    const r = await openUpload(xls, "feed.xls", ["x"]);
    expect(r.ok && r.filename).toBe("feed.xls");
  });

  it("a zip with one CSV is unpacked; ignored entries become notes", async () => {
    const zip = Buffer.from(await makeZip([{ name: "feed.csv", data: CSV_FEED }, { name: "cover.pdf", data: "%PDF" }]));
    const r = await openUpload(zip, "mail.zip", []);
    expect(r).toMatchObject({ ok: true, filename: "feed.csv", notes: ["Ignored 1 non-data file(s) in the archive: cover.pdf."] });
  });

  it("a multi-file zip is FAILED (not 'not ours') with the entries named", async () => {
    const zip = Buffer.from(await makeZip([{ name: "a.csv", data: CSV_FEED }, { name: "b.csv", data: CSV_FEED }]));
    const r = await openUpload(zip, "mail.zip", ["p1", "p2"]);
    expect(r).toEqual({
      ok: false,
      rejected: false,
      message: "The archive holds 2 data files (a.csv, b.csv) — this importer reads one file per upload, so nothing was imported. Upload them separately.",
    });
  });

  it("an encrypted zip opens with the right one of several saved passwords", async () => {
    const zip = Buffer.from(await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Right#1" }));
    const r = await openUpload(zip, "mail.zip", ["Wrong#1", "Right#1"]);
    expect(r.ok && new TextDecoder().decode(r.data)).toBe(CSV_FEED);
  });

  it("an encrypted zip no saved password opens is rejected as not this firm's file", async () => {
    const zip = Buffer.from(await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Theirs#1" }));
    const r = await openUpload(zip, "mail.zip", ["Mine#1", "Mine#2"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejected).toBe(true);
      expect(r.message).toMatch(/none of the 2 saved passwords opened the archive/);
    }
  });

  it("an encrypted zip with no password at all is failed (nothing to try)", async () => {
    const zip = Buffer.from(await makeZip([{ name: "feed.csv", data: CSV_FEED }], { password: "Theirs#1" }));
    const r = await openUpload(zip, "mail.zip", []);
    expect(r).toMatchObject({ ok: false, rejected: false });
  });

  it("a PDF is failed with its reason", async () => {
    const r = await openUpload(Buffer.from("%PDF-1.4 x"), "statement.pdf", []);
    expect(r).toMatchObject({ ok: false, rejected: false, message: expect.stringMatching(/PDF/) });
  });
});

describe("job timing (E17)", () => {
  it("the reaper threshold always exceeds the job timeout", () => {
    for (const v of [undefined, "1", "60", "180", "600", "0", "-5", "abc"]) {
      const t = rtaJobTiming({ RTA_JOB_TIMEOUT_MIN: v });
      expect(t.jobTimeoutMin).toBeGreaterThan(0);
      expect(t.reapParsingAfterMin).toBeGreaterThanOrEqual(t.jobTimeoutMin + REAP_MARGIN_MIN);
    }
    expect(rtaJobTiming({})).toEqual({ jobTimeoutMin: 180, reapParsingAfterMin: 210 });
  });

  it("the worker derives both the job timeout and the reaper from that one setting", () => {
    const src = readFileSync(path.join(__dirname, "../src/workers/rta-import-worker.ts"), "utf8");
    expect(src).toMatch(/const TIMING = rtaJobTiming\(\);/);
    expect(src).toMatch(/JOB_TIMEOUT_MS = TIMING\.jobTimeoutMin \* 60_000/);
    expect(src).toMatch(/make_interval\(mins => \$\{TIMING\.reapParsingAfterMin\}::int\)/);
    expect(src).not.toMatch(/interval '60 minutes'/);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("worker status machine (DB-backed)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const ctx = { userId, roles: [] as string[] };

  async function insertRow(over: { status: string; remarks?: string | null; key: string; fileName: string; kind?: string }) {
    const id = randomUUID();
    await withSystem(async (tx) => {
      const { sql } = await import("drizzle-orm");
      await tx.execute(sql`
        INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key,
          status, remarks, rows_total, rows_imported, rows_skipped, rows_failed, errors, summary)
        VALUES (${id}::uuid, ${tenantId}::uuid, 'cams', ${over.kind ?? "daily_transaction_feed"}, '2024-01-01', '2024-01-01',
          ${over.fileName}, ${over.key}, ${over.status}, ${over.remarks ?? null}, 7, 3, 2, 2,
          '[{"row":1,"reason":"old"}]'::jsonb, '{"old":true}'::jsonb)`);
    });
    return id;
  }

  async function readRow(id: string) {
    return withSystem(async (tx) => {
      const { sql } = await import("drizzle-orm");
      const r = await tx.execute(sql`
        SELECT status, remarks, rows_total, rows_imported, rows_skipped, rows_failed, errors, summary
        FROM rta_file_imports WHERE id = ${id}::uuid`);
      return r.rows[0] as Record<string, any>;
    });
  }

  beforeAll(async () => {
    ({ withSystem } = await import("@/db/client"));
    const schema = await import("@/db/schema");
    await withSystem(async (tx) => {
      await tx.insert(schema.tenants).values({
        id: tenantId,
        legalName: "RTA Worker Test",
        displayName: "RTA Worker Test",
        arn: `ARN-RW-${tenantId.slice(0, 6)}`,
      } as any);
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
      /* best-effort cleanup */
    }
  });

  it("markParsing clears a failed / rejected attempt's remark, counts and errors", async () => {
    const id = await insertRow({ status: "rejected", remarks: "Not this firm's file — …", key: "k-a", fileName: "a.zip" });
    await markParsing(tenantId, id, ctx);
    expect(await readRow(id)).toMatchObject({
      status: "parsing",
      remarks: null,
      rows_total: null,
      rows_imported: null,
      rows_skipped: null,
      rows_failed: null,
      errors: null,
      summary: null,
    });
  });

  it("markParsing keeps a provenance note on a fresh row", async () => {
    const id = await insertRow({ status: "uploaded", remarks: "Auto-imported from forwarded email (synthetic)", key: "k-b", fileName: "b.csv" });
    await markParsing(tenantId, id, ctx);
    expect(await readRow(id)).toMatchObject({ status: "parsing", remarks: "Auto-imported from forwarded email (synthetic)", rows_total: null });
  });

  it("feed import of a plain .xlsx: the parser receives the CELLS (dates as ISO), and the stale rejection remark is gone", async () => {
    h.store.set("k-xlsx", makeWorkbook(ROWS, "xlsx"));
    const id = await insertRow({ status: "rejected", remarks: "Not this firm's file — …", key: "k-xlsx", fileName: "feed.xlsx" });
    h.processed.length = 0;
    await runRtaImportJob({ importId: id, tenantId, source: "cams", kind: "daily_transaction_feed", key: "k-xlsx", filename: "feed.xlsx", userId, roles: [] });
    expect(h.processed).toEqual([`Folio|TrDate|Amount\n${FAKE_FOLIO}|2024-10-02|1000`]);
    expect(await readRow(id)).toMatchObject({ status: "completed", remarks: null, rows_total: 1, rows_imported: 1 });
  });

  it("feed import of a zip: the ignored-files note is recorded on the row", async () => {
    h.store.set("k-zip1", await makeZip([{ name: "feed.csv", data: CSV_FEED }, { name: "cover.pdf", data: "%PDF" }]));
    const id = await insertRow({ status: "uploaded", key: "k-zip1", fileName: "mail.zip" });
    await runRtaImportJob({ importId: id, tenantId, source: "cams", kind: "daily_transaction_feed", key: "k-zip1", filename: "mail.zip", userId, roles: [] });
    expect(await readRow(id)).toMatchObject({ status: "completed", remarks: "Ignored 1 non-data file(s) in the archive: cover.pdf." });
  });

  it("feed import of a multi-file zip: failed with the entries named, old counts cleared", async () => {
    h.store.set("k-zip2", await makeZip([{ name: "a.csv", data: CSV_FEED }, { name: "b.dbf", data: makeWorkbook([["F"], ["1"]], "dbf") }]));
    const id = await insertRow({ status: "partial", remarks: null, key: "k-zip2", fileName: "mail.zip" });
    await runRtaImportJob({ importId: id, tenantId, source: "cams", kind: "daily_transaction_feed", key: "k-zip2", filename: "mail.zip", userId, roles: [] });
    expect(await readRow(id)).toMatchObject({
      status: "failed",
      remarks: expect.stringContaining("holds 2 data files (a.csv, b.dbf)"),
      rows_total: null,
      errors: null,
    });
  });

  it("rich import: shows parsing, then a password-protected workbook fails cleanly with counts cleared", async () => {
    h.store.set("slow-enc", makeEncryptedOoxmlLookalike());
    const id = await insertRow({ status: "failed", remarks: "old failure", key: "slow-enc", fileName: "master.xlsx", kind: "folio_master_dump" });
    let during: Promise<Record<string, any>> | null = null;
    const res = await runRichImportJob(
      { mode: "rich", importId: id, tenantId, key: "slow-enc", filename: "master.xlsx", rta: "", reportType: "", dryRun: true, assignToMe: false, userId, roles: [] },
      () => {
        during ??= readRow(id); // first progress tick: the file is still being read (storage is slowed)
      }
    );
    expect((await during!).status).toBe("parsing");
    expect((await during!).remarks).toBeNull();
    expect(res.ok).toBe(false);
    expect(res.error).toContain(PASSWORD_PROTECTED_WORKBOOK);
    expect(await readRow(id)).toMatchObject({ status: "failed", rows_total: null, errors: null, summary: null });
    expect((await readRow(id)).remarks).toContain("password-protected Excel workbook");
  });
});
