/**
 * Final pilot patch — REPORT-TYPE scope (migration 0243), through every way a
 * file can reach the importer, against a real Postgres (RLS on, app role) in
 * RTA_POSTING_MODE=controlled.
 *
 * The pilot firm is activated (two people) for KFintech MFSD211 + MFSD201
 * only. Proves, for upload, re-run, registrar mail, the queued worker job
 * (feed and rich), its retry, the staging entry and the posting transaction:
 *   • MFSD211 and MFSD201 are accepted;
 *   • MFSD203, MFSD243, MFSD230 and CAMS files are refused — even from
 *     authenticated registrar mail, even when mislabelled as an allowed kind
 *     (the worker identifies the report from the CONTENT);
 *   • a refused file keeps its audit record (an import row marked `blocked`,
 *     the file kept), and nothing is staged or posted;
 *   • a retry of a blocked job stays blocked.
 * Object storage and the queue are in-memory; everything else is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { MFSD201_HEADER, MFSD203_HEADER, MFSD211_HEADER, MFSD230_HEADER, MFSD243_HEADER, R2_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";
import { cleanupSchemeMap } from "./scheme-map-cleanup";

const TEST_DB = process.env.TEST_DATABASE_URL;
const ISIN = "INF9W0A01AA1";
const AMFI = "9W0001";

const h = vi.hoisted(() => ({
  store: new Map<string, Uint8Array>(),
  jobs: [] as Array<{ name: string; data: any }>,
  session: null as any,
  tenant: "",
  aliasId: "",
}));
vi.mock("@/lib/storage/s3", () => ({
  getObjectBytes: vi.fn(async (key: string) => {
    const b = h.store.get(key);
    if (!b) throw new Error("The specified key does not exist.");
    return Buffer.from(b);
  }),
  putObject: vi.fn(async (key: string, body: Uint8Array) => { h.store.set(key, body); }),
  deleteObject: vi.fn(async (key: string) => { h.store.delete(key); }),
}));
vi.mock("@/workers/queues", async (orig) => {
  const real = await orig<typeof import("@/workers/queues")>();
  const q = () => ({ name: "rta.import", add: vi.fn(async (name: string, data: any) => { h.jobs.push({ name, data }); return { id: `job-${h.jobs.length}` }; }) });
  return { ...real, Q: { ...real.Q, rtaImport: q, rtaImportProducer: q }, addWithin: vi.fn(async (_q: unknown, name: string, data: any) => { h.jobs.push({ name, data }); return { id: `job-${h.jobs.length}` }; }) };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => h.session) }));
vi.mock("@/lib/auth/license", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/license")>()), assertActiveLicense: vi.fn(async () => {}) }));
vi.mock("@/lib/rta/import-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/rta/import-access")>()),
  requireRtaImportAccess: vi.fn(async () => {}),
  assertRtaImportAccess: vi.fn(async () => {}),
}));
vi.mock("@/workers/scheduler-state", () => ({ recordRun: vi.fn(async () => {}) }));
vi.mock("@/lib/rta/inbox-config", () => ({ loadRtaInboxConfig: vi.fn() }));
vi.mock("@/lib/rta/mailback-download", () => ({ extractRtaDownloadLinks: () => [], fetchRtaDownload: vi.fn() }));
vi.mock("@/lib/rta/mailback-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/rta/mailback-config")>()),
  resolveTenantByAddresses: vi.fn(async () => ({ id: h.aliasId, tenantId: h.tenant, address: "rta-scope@in.crm.example.test" })),
  resolveTenantBySenders: vi.fn(async () => ({ row: null, ambiguous: false })),
  stampReceived: vi.fn(async () => {}),
  recordForwardingConfirmation: vi.fn(async () => {}),
  getMailbackPasswords: vi.fn(async () => ({})),
  passwordsToTry: () => [],
}));

const kfin = (txn: string) => ({
  "Fund": "119", "Folio Number": "98000001", "Product Code": "119EQGR", "Fund Description": "Scope Two Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ISIN,
});
const FILES = {
  mfsd211: () => csvOf(MFSD211_HEADER, [{ Fund: "119", Folio: "98000002", "Product Code": "119EQGR", "PAN Number": P.adult2, "Report Date": "18/5/2026", "Investor Name": "Synthetic Person", "Tax Status": "Individual" }]),
  mfsd201: (txn: string) => csvOf(MFSD201_HEADER, [kfin(txn)]),
  mfsd203: () => csvOf(MFSD203_HEADER, [{ "Product Code": "119EQGR", Fund: "119", "Folio Number": "98000001", "Fund Description": "Scope Two Equity Fund - Growth", Balance: "10.000", AUM: "500.00", NAV: "50.0000", "Report Date": "08/10/2026", PAN: P.adult }]),
  mfsd243: () => csvOf(MFSD243_HEADER, [{ Folio: "98000001", "Investor Name": "Synthetic Person", RegistrationDate: "01/04/2026", Amount: "1000", Scheme: "EQ", "Fund Code": "119", "Product Code": "119EQGR", PAN: P.adult, RegSlno: "1" }]),
  mfsd230: () => csvOf(MFSD230_HEADER, [{ Prodcode: "119EQGR", Fund: "119", Acno: "98000001", SchCode: "EQ", InvName: "Synthetic Person", AMOUNT: "1000", STARTDATE: "01/04/2026", IHNO: "1" }]),
  camsR2: () => xlsOf(R2_HEADER, [{ amc_code: "H", folio_no: "5590009/11", prodcode: "HFC", scheme: "Nine Equity Fund", trxnno: "939110", traddate: serial("2026-05-02"),
    units: "20.0000", amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: P.adult, siptrxnno: "" }], ["traddate"]),
};

describe.skipIf(!TEST_DB)("report-type scope — KFintech MFSD211 + MFSD201 pilot, every entry point (DB)", () => {
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let gate: typeof import("@/lib/rta/posting/gate");
  let vf: typeof import("@/lib/rta/posting/validate-first");
  let worker: typeof import("@/workers/rta-import-worker");
  const t = randomUUID();
  const owner = randomUUID();
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const one = async (s: ReturnType<typeof import("drizzle-orm").sql>) => (await q(s))[0];
  const counts = () => one(sql`SELECT
      (SELECT count(*) FROM rta_staging_batches WHERE tenant_id = ${t}::uuid)::int batches,
      (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid)::int transactions,
      (SELECT count(*) FROM folios WHERE tenant_id = ${t}::uuid)::int folios,
      (SELECT count(*) FROM rta_sip_registrations WHERE tenant_id = ${t}::uuid)::int registrations`);
  const importRow = (id: string) => one(sql`SELECT status, remarks, file_key FROM rta_file_imports WHERE id = ${id}::uuid`);
  /** Stored file + import row, as the upload route / mail poller leave them. */
  const stored = async (name: string, buf: Buffer, kind: string, source = "kfintech") => {
    const id = randomUUID(), key = `tenants/${t}/rta/${id}-${name}`;
    h.store.set(key, buf);
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, ${source}, ${kind}, '2026-10-08', '2026-10-08', ${name}, ${key}, 'uploaded')`));
    return { id, key };
  };
  const direct = async (name: string, buf: Buffer, kind: string, source = "kfintech") => {
    const f = await stored(name, buf, kind, source);
    return vf.validateFirstImport({ tenantId: t, importId: f.id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };

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
    gate = await import("@/lib/rta/posting/gate");
    vf = await import("@/lib/rta/posting/validate-first");
    worker = await import("@/workers/rta-import-worker");
    H2p = await import("./helpers/two-person");
    ops2p = await H2p.createOperators("scope");
    await H2p.release(ops2p, "global");
    h.tenant = t;
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO scheme_nav (scheme_code, isin, scheme_name, amc_name, nav, nav_date) VALUES (${AMFI}, ${ISIN}, 'Scope Two Equity Fund - Regular Growth', 'Scope Two Mutual Fund', 50, '2026-10-07') ON CONFLICT (scheme_code) DO NOTHING`);
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Report scope pilot', 'Report scope pilot', ${"ARN-RT" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${t}::uuid, ${`owner-${t.slice(0, 8)}@example.test`}, 'Scope Owner', ARRAY['owner']::text[], 'active')`);
      const a = await tx.execute(sql`INSERT INTO rta_forward_addresses (tenant_id, address, token, is_active, verified_at)
        VALUES (${t}::uuid, ${`rta-scope${t.slice(0, 8)}@in.crm.example.test`}, ${`scope${t.slice(0, 8)}`}, true, now()) RETURNING id::text AS id`);
      h.aliasId = (a.rows[0] as any).id;
    });
    await withTenant(t, async (tx) => {
      const inv = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Scope Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, '119', 'AMC 119', '98000001', 'kfintech')`);
    });
    await H2p.activate(ops2p, { tenantId: t, mode: "validate_first", postingEnabled: true, registrars: ["kfintech"], reportCodes: ["MFSD211", "MFSD201"], changeRef: "CHG-SCOPE", reason: "KFintech transaction pilot: MFSD211 + MFSD201 only" });
    h.session = { userId: owner, tenantId: t, roles: ["owner"], permissions: [], branchId: null, sid: "s" };
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await H2p?.retireOperators(ops2p);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_request_guard`);
    for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "rta_pipeline_activations", "scheme_rta_codes"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
    for (const table of ["rta_staging_economic_txns", "rta_staging_batches", "rta_inbound_messages", "rta_file_imports", "rta_forward_addresses", "folios", "investors", "audit_log", "users"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_request_guard`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
    await cleanupSchemeMap(withSystem as any, sql, [AMFI]);
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code = ${AMFI}`);
  });

  it("intake filter (pure): kinds and file names that cannot be an allowed report", async () => {
    const { intakeRefusalFor, reportCodesNamedIn } = await import("@/lib/rta/posting/intake-scope");
    const pilot = { registrars: ["kfintech"] as any, reportCodes: ["MFSD211", "MFSD201"] };
    expect(reportCodesNamedIn("12345_MFSD203_20261008.zip")).toEqual(["MFSD203"]);
    expect(reportCodesNamedIn("WBR49 report.xls")).toEqual(["WBR49"]);
    expect(reportCodesNamedIn("R2_ARN.xls")).toEqual(["R2"]);
    expect(reportCodesNamedIn("statement-2026.csv")).toEqual([]);
    expect(intakeRefusalFor(pilot, { source: "kfintech", kind: "daily_transaction_feed", fileName: "MFSD201_x.csv" })).toBeNull();
    expect(intakeRefusalFor(pilot, { source: "kfintech", kind: "folio_master_dump", fileName: "MFSD211_x.zip" })).toBeNull();
    expect(intakeRefusalFor(pilot, { source: "kfintech", kind: "cas_holdings", fileName: "holdings.csv" })).toMatch(/cas holdings" file cannot be one of them/);
    expect(intakeRefusalFor(pilot, { source: "kfintech", kind: "folio_master_dump", fileName: "MFSD203_x.zip" })).toMatch(/a MFSD203 file is refused/);
    expect(intakeRefusalFor(pilot, { source: "kfintech", kind: "monthly_sip_book", fileName: "MFSD243.csv" })).toMatch(/refused/);
    expect(intakeRefusalFor(pilot, { source: "cams", kind: "daily_transaction_feed", fileName: "R2.xls" })).toMatch(/a cams file is refused/);
    expect(intakeRefusalFor(null, { source: "cams", kind: "monthly_sip_book", fileName: "WBR49.xls" })).toBeNull(); // legacy firm: unaffected
    expect(intakeRefusalFor({ registrars: null, reportCodes: null }, { source: "cams", kind: "monthly_sip_book", fileName: "WBR49.xls" })).toBeNull();
  });

  it("staging entry (content): MFSD211 and MFSD201 run; MFSD203 / MFSD243 / MFSD230 / CAMS R2 are refused before anything is staged", async () => {
    const m = await direct("allowed-211.csv", FILES.mfsd211(), "folio_master_dump");
    expect(m.recordKind).toBe("master");
    const r = await direct("allowed-201.csv", FILES.mfsd201("990001"), "daily_transaction_feed");
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
    const before = await counts();
    for (const [name, buf, code] of [["h.csv", FILES.mfsd203(), "MFSD203"], ["s243.csv", FILES.mfsd243(), "MFSD243"], ["s230.csv", FILES.mfsd230(), "MFSD230"]] as const) {
      // Labelled as an ALLOWED kind on purpose: the content decides.
      await expect(direct(name, buf, "daily_transaction_feed")).rejects.toThrow(new RegExp(`report types MFSD201 \\+ MFSD211 only; a ${code} file is refused`));
    }
    await expect(direct("c.xls", FILES.camsR2(), "daily_transaction_feed", "cams")).rejects.toThrow(/covers kfintech only; a cams record is refused/);
    expect(await counts()).toEqual(before);
  });

  it("inside the posting transaction the gate refuses a report type outside the activation", async () => {
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t, process.env, { rta: "kfintech", reportCode: "MFSD203" }))).rejects.toThrow(/a MFSD203 file is refused/);
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t, process.env, { rta: "kfintech", reportCode: "MFSD243" }))).rejects.toThrow(/a MFSD243 file is refused/);
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t, process.env, { rta: "kfintech", reportCode: "MFSD201" }))).resolves.toEqual({ registrars: ["kfintech"], reportCodes: ["MFSD201", "MFSD211"] });
  });

  it("queued worker job (feed and rich), and its retry: a mislabelled MFSD203 / MFSD243 is BLOCKED, file kept, nothing staged", async () => {
    const before = await counts();
    const a = await stored("renamed-201.csv", FILES.mfsd203(), "daily_transaction_feed");
    const job = { importId: a.id, tenantId: t, source: "kfintech" as const, kind: "daily_transaction_feed" as const, key: a.key, filename: "renamed-201.csv", userId: owner, roles: ["owner"] };
    await worker.runRtaImportJob(job);
    expect(await importRow(a.id)).toMatchObject({ status: "blocked", remarks: expect.stringMatching(/^Blocked — .*a MFSD203 file is refused — nothing is staged or posted/) });
    expect(h.store.has(a.key)).toBe(true);
    await worker.runRtaImportJob(job); // a retry / resumed job: still blocked, still nothing
    expect((await importRow(a.id)).status).toBe("blocked");
    const b = await stored("sip.csv", FILES.mfsd243(), "folio_master_dump");
    await worker.runRichImportJob({ mode: "rich", importId: b.id, tenantId: t, key: b.key, filename: "sip.csv", rta: "kfintech", reportType: "", dryRun: false, assignToMe: false, userId: owner, roles: ["owner"] } as any);
    expect((await importRow(b.id)).status).toBe("blocked");
    expect(await counts()).toEqual(before);
    // An allowed file through the same job posts.
    const c = await stored("ok-201.csv", FILES.mfsd201("990002"), "daily_transaction_feed");
    await worker.runRtaImportJob({ ...job, importId: c.id, key: c.key, filename: "ok-201.csv" });
    expect((await importRow(c.id)).status).toBe("completed");
    expect((await counts()).transactions).toBe(before.transactions + 1);
  });

  it("upload acceptance: an MFSD211 / MFSD201 upload is queued; MFSD203 / MFSD243 / MFSD230 / CAMS are recorded BLOCKED and never queued", async () => {
    const route = await import("@/app/api/rta-imports/upload/route");
    const up = (body: Record<string, string>) => route.POST(new NextRequest("http://localhost/api/rta-imports/upload", { method: "POST", body: JSON.stringify({ ...body, key: `tenants/${t}/rta/${randomUUID()}-${body.filename}` }) }));
    h.jobs.length = 0;
    expect((await up({ source: "kfintech", kind: "daily_transaction_feed", filename: "12345_MFSD201_20261008.zip" })).status).toBe(200);
    expect((await up({ source: "kfintech", kind: "folio_master_dump", filename: "12345_MFSD211_20261008.zip" })).status).toBe(200);
    expect(h.jobs).toHaveLength(2);
    for (const body of [
      { source: "kfintech", kind: "folio_master_dump", filename: "12345_MFSD203_20261008.zip" },
      { source: "kfintech", kind: "cas_holdings", filename: "holdings.zip" },
      { source: "kfintech", kind: "monthly_sip_book", filename: "12345_MFSD243.zip" },
      { source: "kfintech", kind: "daily_transaction_feed", filename: "12345_MFSD230.zip" },
      { source: "cams", kind: "daily_transaction_feed", filename: "R2_ARN.xls" },
    ]) {
      const res = await up(body);
      expect(res.status).toBe(422);
      const j = await res.json();
      expect(j).toMatchObject({ status: "blocked", error: expect.stringMatching(/^Blocked — /) });
      expect(await importRow(j.importId)).toMatchObject({ status: "blocked", remarks: expect.stringMatching(/^Blocked at upload — /) });
    }
    expect(h.jobs).toHaveLength(2); // nothing more was queued
    const audit = await q(sql`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${t}::uuid AND action = 'rta_import.blocked'`);
    expect(audit[0].n).toBe(5);
  });

  it("re-run (retry) of a blocked import is refused and it stays blocked; nothing is queued", async () => {
    const route = await import("@/app/api/rta-imports/[id]/reimport/route");
    const [blocked] = await q(sql`SELECT id::text AS id FROM rta_file_imports WHERE tenant_id = ${t}::uuid AND file_name = '12345_MFSD203_20261008.zip'`);
    h.jobs.length = 0;
    const res = await route.POST(new NextRequest(`http://localhost/api/rta-imports/${blocked.id}/reimport`, { method: "POST" }), { params: Promise.resolve({ id: blocked.id }) });
    expect(res.status).toBe(422);
    expect((await importRow(blocked.id)).status).toBe("blocked");
    expect(h.jobs).toHaveLength(0);
  });

  it("authenticated KFintech mail: MFSD201 is queued; MFSD203 / MFSD243 / MFSD230 are stored and recorded BLOCKED, never queued", async () => {
    const { handleRtaInboundMessage } = await import("@/workers/rta-inbox-poller");
    const KFIN_DKIM = "amazonses.com; spf=pass; dkim=pass header.i=@kfintech.com; dmarc=pass header.from=kfintech.com;";
    const mail = (filename: string, content: Buffer) => ({
      uid: 1, messageId: `<scope-${randomUUID()}@example.test>`, from: "distributorcare@kfintech.com", subject: "KFintech mailback", text: "",
      recipients: [`rta-scope${t.slice(0, 8)}@in.crm.example.test`], senderCandidates: [], authResults: [KFIN_DKIM], transport: "ses" as const,
      attachments: [{ filename, contentType: "text/csv", content, size: content.length }],
    });
    h.jobs.length = 0;
    await handleRtaInboundMessage(mail("12345_MFSD201_20261008.csv", FILES.mfsd201("990003")) as any);
    expect(h.jobs).toHaveLength(1);
    for (const [name, buf] of [["12345_MFSD203_20261008.csv", FILES.mfsd203()], ["12345_MFSD243_20261008.csv", FILES.mfsd243()], ["12345_MFSD230_20261008.csv", FILES.mfsd230()]] as const) {
      await handleRtaInboundMessage(mail(name, buf) as any);
      const [row] = await q(sql`SELECT id::text AS id, status, remarks, file_key FROM rta_file_imports WHERE tenant_id = ${t}::uuid AND file_name = ${name}`);
      expect(row).toMatchObject({ status: "blocked", remarks: expect.stringMatching(/^Blocked at mail ingestion/) });
      expect(h.store.has(row.file_key)).toBe(true); // the file is kept with its audit record
    }
    expect(h.jobs).toHaveLength(1);
    const logged = await withSystem(async (tx) => (await tx.execute(sql`SELECT outcome FROM rta_inbound_messages WHERE tenant_id = ${t}::uuid ORDER BY created_at`)).rows as any[]);
    expect(logged.map((r) => r.outcome)).toEqual(["imported", "blocked", "blocked", "blocked"]);
  });
});
