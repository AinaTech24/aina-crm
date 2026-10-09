/**
 * Final pilot corrections — a KFintech-only activation posts nothing from a
 * CAMS file (migration 0242). Against a real Postgres with
 * RTA_POSTING_MODE=controlled.
 *
 * Proves: posting cannot be enabled without naming the registrars; a CAMS
 * master (R9) or transaction (R2) file sent to the firm is refused whole —
 * nothing staged, no client, folio or transaction written — while a KFintech
 * file posts; the posting gate refuses a CAMS record inside the transaction
 * too; the scope cannot be edited afterwards and accepts only known registrars.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, R2_HEADER, R9_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";
import { cleanupSchemeMap } from "./scheme-map-cleanup";

const TEST_DB = process.env.TEST_DATABASE_URL;
const RS_ISIN = "INF9R0A01AA1";
const RS_AMFI = "9R0001";

const kfin = (txn: string) => ({
  "Fund": "118", "Folio Number": "97000001", "Product Code": "118EQGR", "Fund Description": "Scope Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ISIN: RS_ISIN,
});

const dbError = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e: any) { return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`; } };

describe.skipIf(!TEST_DB)("activation registrar scope — KFintech-only pilot (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let C: typeof import("@/lib/rta/posting/controls");
  let gate: typeof import("@/lib/rta/posting/gate");
  let vf: typeof import("@/lib/rta/posting/validate-first");
  const t = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const one = async (s: ReturnType<typeof import("drizzle-orm").sql>) => (await q(s))[0];
  const importFile = async (name: string, buf: Buffer, rta: "cams" | "kfintech", kind: string) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, ${rta}, ${kind}, '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const counts = () => one(sql`SELECT
      (SELECT count(*) FROM investors WHERE tenant_id = ${t}::uuid)::int investors,
      (SELECT count(*) FROM folios WHERE tenant_id = ${t}::uuid)::int folios,
      (SELECT count(*) FROM folios WHERE tenant_id = ${t}::uuid AND rta = 'cams')::int cams_folios,
      (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid)::int transactions,
      (SELECT count(*) FROM rta_staging_batches WHERE tenant_id = ${t}::uuid AND rta = 'cams')::int cams_batches,
      (SELECT count(*) FROM rta_staging_rows r JOIN rta_staging_batches b ON b.id = r.batch_id WHERE r.tenant_id = ${t}::uuid AND b.rta = 'cams')::int cams_rows`);

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
    C = await import("@/lib/rta/posting/controls");
    gate = await import("@/lib/rta/posting/gate");
    vf = await import("@/lib/rta/posting/validate-first");
    await C.setPostingHalt({ scope: "global", halted: false, reason: "development test database: posting released", changedBy: ops.a, approvedBy: ops.b });
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO scheme_nav (scheme_code, isin, scheme_name, amc_name, nav, nav_date) VALUES (${RS_AMFI}, ${RS_ISIN}, 'Scope Equity Fund - Regular Growth', 'Scope Mutual Fund', 50, '2026-10-07') ON CONFLICT (scheme_code) DO NOTHING`);
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Scope pilot', 'Scope pilot', ${"ARN-RS" + t.slice(0, 6)})`);
    });
    await withTenant(t, async (tx) => {
      const inv = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Scope Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, '118', 'AMC 118', '97000001', 'kfintech')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "rta_pipeline_activations", "scheme_rta_codes"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
    for (const table of ["rta_staging_economic_txns", "rta_staging_batches", "rta_file_imports", "folios", "investors", "audit_log"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
    await cleanupSchemeMap(withSystem as any, sql, [RS_AMFI]);
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code = ${RS_AMFI}`);
  });

  it("posting cannot be enabled without naming the registrars, nor with an unknown one", async () => {
    const base = { tenantId: t, mode: "validate_first" as const, postingEnabled: true, reason: "KFintech-only pilot, registrar scope test", approvalRef: "CHG-RS", requestedBy: ops.a, approvedBy: ops.b };
    await expect(C.activateTenant(base)).rejects.toThrow(/needs the registrars it covers/);
    await expect(C.activateTenant({ ...base, registrars: [] })).rejects.toThrow(/needs the registrars it covers/);
    await expect(C.activateTenant({ ...base, registrars: ["nse" as any] })).rejects.toThrow(/registrars must be among/);
    // The table refuses an unknown registrar even when the library is bypassed.
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, approval_ref, requested_by, approved_by, registrars)
      VALUES (${t}::uuid, 'validate_first', true, 'an unknown registrar in the scope', 'X', ${ops.a}::uuid, ${ops.b}::uuid, ARRAY['nse'])`)))).toMatch(/registrars_ck/);
    const a = await C.activateTenant({ ...base, registrars: ["kfintech"] });
    expect(a).toMatchObject({ mode: "validate_first", postingEnabled: true, registrars: ["kfintech"] });
  });

  it("a KFintech transaction file posts", async () => {
    const r = await importFile("k1.csv", csvOf(MFSD201_HEADER, [kfin("970001")]), "kfintech", "daily_transaction_feed");
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
  });

  it("a CAMS master (R9) and a CAMS transaction file (R2) are refused whole: nothing staged, no client, folio or transaction", async () => {
    const before = await counts();
    const r9 = xlsOf(R9_HEADER, [{ foliochk: "5590009/11", product: "HFC", sch_name: "Nine Equity Fund - Regular Plan - Growth", amc_code: "H", rep_date: serial("2026-05-18"),
      clos_bal: "20.000", rupee_bal: "1000.00", pan_no: P.adult2, inv_name: "Synthetic Person", tax_status: "Individual" }], ["rep_date"]);
    await expect(importFile("c9.xls", r9, "cams", "folio_master_dump")).rejects.toThrow(/covers kfintech only; a cams record is refused — nothing is posted/);
    const r2 = xlsOf(R2_HEADER, [{ amc_code: "H", folio_no: "5590009/11", prodcode: "HFC", scheme: "Nine Equity Fund - Regular Plan - Growth", trxnno: "939109", traddate: serial("2026-05-02"),
      units: "20.0000", amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: P.adult, siptrxnno: "" }], ["traddate"]);
    await expect(importFile("c2.xls", r2, "cams", "daily_transaction_feed")).rejects.toThrow(/a cams record is refused/);
    const after = await counts();
    expect(after).toEqual(before);
    expect(after).toMatchObject({ cams_folios: 0, cams_batches: 0, cams_rows: 0 });
  });

  it("inside the posting transaction the gate refuses a CAMS record too (defence in depth)", async () => {
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t, process.env, { rta: "cams" }))).rejects.toThrow(/covers kfintech only/);
    await expect(withTenant(t, (tx) => gate.assertPostingAllowed(tx, t, process.env, { rta: "kfintech" }))).resolves.toEqual({ registrars: ["kfintech"] });
  });

  it("the scope cannot be widened by editing the activation; a wider scope is a new two-person activation", async () => {
    expect(await dbError(withTenant(t, (tx) => tx.execute(sql`UPDATE rta_pipeline_activations SET registrars = ARRAY['cams', 'kfintech'] WHERE tenant_id = ${t}::uuid`))))
      .toMatch(/revoked once and otherwise never edited/);
    const audit = await one(sql`SELECT after FROM audit_log WHERE tenant_id = ${t}::uuid AND action = 'rta.pipeline.activate' ORDER BY at DESC LIMIT 1`);
    expect(audit.after.registrars).toEqual(["kfintech"]);
  });
});
