/**
 * Phase 3F — validate-first through the WORKER jobs that upload and mail both
 * enqueue (the inbox poller and the upload route queue the same job shapes),
 * with object storage mocked. Proves: the existing importer never runs in
 * validate_first mode; the import row reports what was COMMITTED; a refused
 * gate fails the import closed with nothing written anywhere.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD211_HEADER, csvOf, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

const h = vi.hoisted(() => ({ store: new Map<string, Uint8Array>(), legacyCalls: 0 }));
vi.mock("@/lib/storage/s3", () => ({
  getObjectBytes: vi.fn(async (key: string) => {
    const b = h.store.get(key);
    if (!b) throw new Error("The specified key does not exist.");
    return Buffer.from(b);
  }),
  deleteObject: vi.fn(async () => {}),
}));
// The existing feed processor must never run in validate_first mode: count any call.
vi.mock("@/lib/rta/process", async (orig) => {
  const real = await orig<typeof import("@/lib/rta/process")>();
  return { ...real, processRtaFile: vi.fn(async (...a: Parameters<typeof real.processRtaFile>) => { h.legacyCalls++; return real.processRtaFile(...a); }) };
});

const sip = (txn: string) => ({
  "Fund": "117", "Folio Number": "93000001", "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult,
});

describe.skipIf(!TEST_DB)("validate-first through the worker jobs (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let worker: typeof import("@/workers/rta-import-worker");
  const t = randomUUID();
  const userId = randomUUID();
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const upload = async (name: string, buf: Buffer, kind: string, source: "kfintech" | "cams") => {
    const id = randomUUID(), key = `uploads/${id}/${name}`;
    h.store.set(key, buf);
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, ${source}, ${kind}, '2026-10-08', '2026-10-08', ${name}, ${key}, 'uploaded')`));
    return { id, key };
  };
  const row = async (id: string) => (await q(sql`SELECT status, rows_imported, rows_skipped, remarks FROM rta_file_imports WHERE id = ${id}::uuid`))[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    worker = await import("@/workers/rta-import-worker");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'VF Worker', 'VF Worker', ${"ARN-VW" + t.slice(0, 6)})`));
  });

  afterAll(async () => {
    delete process.env.RTA_PIPELINE_MODE; delete process.env.RTA_POSTING_MODE; delete process.env.RTA_POSTING_DATABASE;
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "rta_staging_economic_txns", "rta_staging_batches", "rta_file_imports", "folios", "families"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("gate refused: RTA_PIPELINE_MODE=validate_first without the posting gate fails the import closed — nothing staged, nothing written, no fallback", async () => {
    process.env.RTA_PIPELINE_MODE = "validate_first";
    delete process.env.RTA_POSTING_MODE;
    const u = await upload("refused.csv", csvOf(MFSD201_HEADER, [sip("800001")]), "daily_transaction_feed", "kfintech");
    await worker.runRtaImportJob({ importId: u.id, tenantId: t, source: "kfintech", kind: "daily_transaction_feed", key: u.key, filename: "refused.csv", userId, roles: ["owner"] });
    expect((await row(u.id)).status).toBe("failed");
    expect((await row(u.id)).remarks).toMatch(/posting gate refused/);
    const [c] = await q(sql`SELECT (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid)::int AS tx, (SELECT count(*) FROM rta_staging_batches WHERE tenant_id = ${t}::uuid)::int AS batches`);
    expect(c).toEqual({ tx: 0, batches: 0 });
    expect(h.legacyCalls).toBe(0);
  });

  it("master (rich job) then transactions (feed job): staged first, committed through the gate, the import row reports what was committed", async () => {
    process.env.RTA_PIPELINE_MODE = "validate_first";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    const m = await upload("MFSD211.csv", csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: "93000001", "Product Code": "117EQGR", "PAN Number": P.adult, "Report Date": "18/5/2026", "Investor Name": "Synthetic Person", "Tax Status": "Individual" }]), "folio_master_dump", "kfintech");
    const mr = await worker.runRichImportJob({ mode: "rich", tenantId: t, key: m.key, filename: "MFSD211.csv", rta: "kfintech", reportType: "", dryRun: false, assignToMe: false, userId, roles: ["owner"], importId: m.id });
    expect(mr).toMatchObject({ ok: true, validateFirst: true });
    expect((await row(m.id))).toMatchObject({ status: "completed", rows_imported: 1 });
    const f = await upload("MFSD201.csv", csvOf(MFSD201_HEADER, [sip("800101"), sip("800102"), { ...sip("800103"), "Transaction Type": "XYZ" }]), "daily_transaction_feed", "kfintech");
    await worker.runRtaImportJob({ importId: f.id, tenantId: t, source: "kfintech", kind: "daily_transaction_feed", key: f.key, filename: "MFSD201.csv", userId, roles: ["owner"] });
    expect(await row(f.id)).toMatchObject({ status: "partial", rows_imported: 2, rows_skipped: 1 });
    const txns = await q(sql`SELECT order_id, source_feed FROM transactions WHERE tenant_id = ${t}::uuid ORDER BY order_id`);
    expect(txns).toEqual([{ order_id: "800101", source_feed: "rta_validate_first" }, { order_id: "800102", source_feed: "rta_validate_first" }]);
    expect(h.legacyCalls).toBe(0);
    // A worker retry of the same job neither duplicates nor changes the outcome.
    await worker.runRtaImportJob({ importId: f.id, tenantId: t, source: "kfintech", kind: "daily_transaction_feed", key: f.key, filename: "MFSD201.csv", userId, roles: ["owner"] });
    expect((await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid`))[0].n).toBe(2);
  });
});
