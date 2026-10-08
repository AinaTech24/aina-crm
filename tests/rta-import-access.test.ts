/**
 * RTA import APIs — authorization, PAN masking on read, re-import refusals and
 * the retired synchronous endpoint (E6 / RTA import phase 2).
 *
 * Route handlers are called directly with the session and the tenant
 * transaction mocked (pattern: tests/mobile-ux-api.test.ts). The SQL each
 * handler sends is routed to canned rows by its text. All data is synthetic:
 * "ABCPE1234F" is a made-up PAN-shaped token.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  execute: vi.fn(),
  add: vi.fn(),
  getJob: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/db/client", () => ({
  withTenant: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ execute: mocks.execute }),
  withSystem: async (fn: (tx: unknown) => unknown) => fn({ execute: mocks.execute }),
}));
vi.mock("@/workers/queues", () => ({ Q: { rtaImport: () => ({ add: mocks.add, getJob: mocks.getJob }) } }));
vi.mock("@/lib/rta/mailback-config", () => ({
  getMailbackPasswords: vi.fn(async () => ({})),
  passwordsToTry: vi.fn(() => ["synthetic-pw"]),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, clientMetaFromHeaders: () => ({}) }));
vi.mock("@/lib/auth/license", () => ({ assertActiveLicense: vi.fn(async () => {}), loadTenantLicense: vi.fn() }));
vi.mock("@/lib/storage/s3", () => ({ presignedPutUrl: vi.fn(async () => "https://s3.test/put") }));
vi.mock("@/lib/observability/capture", () => ({ captureError: vi.fn() }));

import { GET as listImports } from "@/app/api/rta-imports/route";
import { GET as getImport, DELETE as deleteImport } from "@/app/api/rta-imports/[id]/route";
import { POST as reimport } from "@/app/api/rta-imports/[id]/reimport/route";
import { POST as bulk } from "@/app/api/rta-imports/bulk/route";
import { POST as upload } from "@/app/api/rta-imports/upload/route";
import { POST as uploadUrl } from "@/app/api/rta-imports/upload-url/route";
import { POST as legacyImport } from "@/app/api/rta/import/route";
import { POST as legacyImportUrl } from "@/app/api/rta/import-url/route";
import { POST as legacyImportAsync } from "@/app/api/rta/import-async/route";
import { GET as legacyImportStatus } from "@/app/api/rta/import-status/route";
import { errorsToCsv } from "@/lib/rta/errors-csv";
import { maskImportErrors, maskImportText } from "@/lib/rta/import-access";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";
const IMPORT_ID = "33333333-3333-4333-8333-333333333333";
const PAN = "ABCPE1234F"; // synthetic

const owner = { tenantId: TENANT, userId: USER, roles: ["owner"], permissions: [] };
const opsUser = { tenantId: TENANT, userId: USER, roles: ["ops"], permissions: [] };
const rm = { tenantId: TENANT, userId: USER, roles: ["rm"], permissions: [] };
const marketing = { tenantId: TENANT, userId: USER, roles: ["marketing"], permissions: [] };
/** Customised to their own book: import capability, but only assigned clients. */
const customOwnBook = {
  tenantId: TENANT, userId: USER, roles: ["back_office"],
  permissions: ["transactions.execute", "investor.view.assigned"],
};

const sqlOf = (q: any) => new PgDialect().sqlToQuery(q).sql;

/** Canned DB: `wall` = tenants.restrict_user_data_scope; `row` = the import row. */
function db(opts: { wall?: boolean; row?: Record<string, any> | null; resetMatches?: boolean } = {}) {
  const row =
    opts.row === undefined
      ? {
          id: IMPORT_ID, source: "cams", kind: "daily_transaction_feed", status: "partial",
          file_name: "synthetic_WBR2.csv", file_key: `tenants/${TENANT}/rta/1-synthetic_WBR2.csv`,
          errors: [{ row: 7, reason: `PAN ${PAN} not in client master` }],
          remarks: `Skipped rows for ${PAN.toLowerCase()} and ${PAN}`,
        }
      : opts.row;
  mocks.execute.mockImplementation(async (q: any) => {
    const text = sqlOf(q);
    if (text.includes("restrict_user_data_scope")) return { rows: [{ on: !!opts.wall }] };
    if (text.startsWith("\n          UPDATE rta_file_imports\n          SET status = 'uploaded'") || text.includes("SET status = 'uploaded'")) {
      return { rows: opts.resetMatches === false ? [] : [{ id: IMPORT_ID }] };
    }
    if (text.includes("DISTINCT ON (kind)")) return { rows: [] };
    if (text.includes("FROM rta_file_imports")) return { rows: row ? [row] : [] };
    return { rows: [] };
  });
}

const noSession = () => Object.assign(new Error("not authenticated"), { status: 401 });
const params = (id = IMPORT_ID) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new NextRequest(`https://crm.test${url}`);
const post = (url: string, body?: unknown) =>
  new NextRequest(`https://crm.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(owner);
  mocks.add.mockResolvedValue({ id: "job-1" });
  db();
});

// ── Authorization on every import API ───────────────────────────────────────

type Call = [string, () => Promise<Response>];
const calls: Call[] = [
  ["GET /api/rta-imports", () => listImports(get("/api/rta-imports"))],
  ["GET /api/rta-imports/[id]", () => getImport(get(`/api/rta-imports/${IMPORT_ID}`), params())],
  ["DELETE /api/rta-imports/[id]", () => deleteImport(new NextRequest(`https://crm.test/api/rta-imports/${IMPORT_ID}`, { method: "DELETE" }), params())],
  ["POST /api/rta-imports/[id]/reimport", () => reimport(post(`/api/rta-imports/${IMPORT_ID}/reimport`), params())],
  ["POST /api/rta-imports/bulk", () => bulk(post("/api/rta-imports/bulk", { ids: [IMPORT_ID], action: "trash" }))],
  ["POST /api/rta-imports/upload", () => upload(post("/api/rta-imports/upload", {
    source: "cams", kind: "daily_transaction_feed", key: `tenants/${TENANT}/rta/1-x.csv`, filename: "x.csv",
  }))],
  ["POST /api/rta-imports/upload-url", () => uploadUrl(post("/api/rta-imports/upload-url", { filename: "x.csv" }))],
  ["POST /api/rta/import-url", () => legacyImportUrl(post("/api/rta/import-url", { filename: "x.csv" }))],
  ["POST /api/rta/import-async", () => legacyImportAsync(post("/api/rta/import-async", { key: `tenants/${TENANT}/rta/1-x.csv`, filename: "x.csv" }))],
  ["GET /api/rta/import-status", () => legacyImportStatus(get("/api/rta/import-status?jobId=1"))],
  ["POST /api/rta/import", () => legacyImport()],
];

describe.each(calls)("%s", (_name, call) => {
  it("answers 401 JSON with no session", async () => {
    mocks.session.mockRejectedValue(noSession());
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBeTruthy();
  });

  it("answers 403 JSON without the import capability", async () => {
    mocks.session.mockResolvedValue(marketing);
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
  });

  it("answers 403 JSON to an RM walled to their own clients", async () => {
    mocks.session.mockResolvedValue(rm);
    db({ wall: true });
    const res = await call();
    // The retired endpoint refuses on capability only, then always 410s.
    if (_name === "POST /api/rta/import") return expect(res.status).toBe(410);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/own clients/);
  });

  it("answers 403 JSON to staff customised to their own book", async () => {
    mocks.session.mockResolvedValue(customOwnBook);
    db({ wall: false }); // the firm switch is off — the custom allow-list still narrows
    const res = await call();
    if (_name === "POST /api/rta/import") return expect(res.status).toBe(410);
    expect(res.status).toBe(403);
  });
});

describe("who may read imports", () => {
  it("lets an RM at a shared-book firm (wall off, not customised) read the list", async () => {
    mocks.session.mockResolvedValue(rm);
    db({ wall: false });
    expect((await listImports(get("/api/rta-imports"))).status).toBe(200);
  });

  it("lets ops read imports even with the wall on (firm-wide client viewer)", async () => {
    mocks.session.mockResolvedValue(opsUser);
    db({ wall: true });
    expect((await getImport(get(`/api/rta-imports/${IMPORT_ID}`), params())).status).toBe(200);
  });

  it("does not run a single query for a caller without the capability on upload", async () => {
    mocks.session.mockResolvedValue(marketing);
    await upload(post("/api/rta-imports/upload", {}));
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("a non-UUID id is a 404, not a 500", async () => {
    expect((await getImport(get("/api/rta-imports/not-a-uuid"), params("not-a-uuid"))).status).toBe(404);
  });
});

// ── PAN masking on read ─────────────────────────────────────────────────────

describe("PANs never leave the server in full", () => {
  it("masks errors and remarks in the list", async () => {
    const res = await listImports(get("/api/rta-imports"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/ABCPE1234F/i);
    expect(text).toContain("ABC••••4F");
  });

  it("caps the list's errors in SQL and only lists live rows", async () => {
    await listImports(get("/api/rta-imports"));
    const list = mocks.execute.mock.calls.map(([q]) => new PgDialect().sqlToQuery(q)).find((q) => q.sql.includes("errors_count"))!;
    expect(list.sql).toContain("deleted_at IS NULL");
    expect(list.params).toContain("$[0 to 99]");
  });

  it("masks errors and remarks in the detail", async () => {
    const res = await getImport(get(`/api/rta-imports/${IMPORT_ID}`), params());
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/ABCPE1234F/i);
    expect(body.errors[0]).toEqual({ row: 7, reason: "PAN ABC••••4F not in client master" });
  });

  it("masks the errors CSV download", () => {
    const csv = errorsToCsv([{ row: 3, reason: `Folio 123 / PAN ${PAN} unknown` }, { row: 4, reason: "=HYPERLINK(1)" }]);
    expect(csv).not.toContain(PAN);
    expect(csv).toContain("ABC••••4F");
    // A formula-leading cell is neutralised.
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
  });

  it("helpers are null-safe and leave non-PAN text alone", () => {
    expect(maskImportText(null)).toBeNull();
    expect(maskImportText("folio 1234567890 failed")).toBe("folio 1234567890 failed");
    expect(maskImportErrors(null)).toEqual([]);
    expect(maskImportErrors([{ row: 1, reason: `x ${PAN}` }])[0].reason).toBe("x ABC••••4F");
  });

  it("masks a failed legacy job's reason and hides another firm's job", async () => {
    mocks.getJob.mockResolvedValueOnce({ data: { tenantId: TENANT }, getState: async () => "failed", failedReason: `bad row for ${PAN}` });
    const mine = await (await legacyImportStatus(get("/api/rta/import-status?jobId=1"))).json();
    expect(mine.error).toBe("bad row for ABC••••4F");

    mocks.getJob.mockResolvedValueOnce({ data: { tenantId: OTHER_TENANT }, getState: async () => "completed", returnvalue: { secret: true } });
    const theirs = await (await legacyImportStatus(get("/api/rta/import-status?jobId=2"))).json();
    expect(theirs).toEqual({ state: "unknown" });
  });
});

// ── Re-import ───────────────────────────────────────────────────────────────

describe("re-import", () => {
  it.each(["uploaded", "parsing"])("refuses a row that is %s with 409", async (status) => {
    db({ row: { id: IMPORT_ID, source: "cams", kind: "daily_transaction_feed", file_name: "f.csv", file_key: "tenants/x/rta/f.csv", status } });
    const res = await reimport(post(`/api/rta-imports/${IMPORT_ID}/reimport`), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still being processed/);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("refuses a drop-folder row (feed: key) with an explicit message", async () => {
    db({ row: { id: IMPORT_ID, source: "cams", kind: "daily_transaction_feed", file_name: "f.csv", file_key: "feed:abcdef123456", status: "failed" } });
    const res = await reimport(post(`/api/rta-imports/${IMPORT_ID}/reimport`), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/drop folder/);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("409s when a concurrent request already claimed the row", async () => {
    db({ resetMatches: false });
    const res = await reimport(post(`/api/rta-imports/${IMPORT_ID}/reimport`), params());
    expect(res.status).toBe(409);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("resets the row to uploaded (counts, errors, remarks cleared) and queues one job", async () => {
    const res = await reimport(post(`/api/rta-imports/${IMPORT_ID}/reimport`), params());
    expect(res.status).toBe(200);
    const reset = mocks.execute.mock.calls.map(([q]) => sqlOf(q)).find((t) => t.includes("SET status = 'uploaded'"))!;
    expect(reset).toMatch(/rows_total = NULL, rows_imported = NULL, rows_skipped = NULL, rows_failed = NULL/);
    expect(reset).toMatch(/errors = NULL, summary = NULL/);
    expect(reset).toMatch(/remarks = CASE WHEN remarks ILIKE 'Auto-imported%' THEN remarks ELSE NULL END/);
    expect(reset).toMatch(/status NOT IN \('uploaded', 'parsing'\)/);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});

// ── The retired synchronous importer ────────────────────────────────────────

describe("POST /api/rta/import", () => {
  it("is gone (410) with a pointer to the RTA Imports page", async () => {
    const res = await legacyImport();
    expect(res.status).toBe(410);
    expect((await res.json()).use).toBe("/dashboard/rta-imports");
  });
});
