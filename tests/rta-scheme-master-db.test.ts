/**
 * Phase 3H — registrar scheme codes resolve to the ONE CRM Scheme Master (the
 * AMFI scheme code) by evidence only, on a real Postgres with the scheme gate
 * on. Synthetic AMFI rows are added to scheme_nav for the test and removed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD203_HEADER, R2_HEADER, R9_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";
import { decideScheme } from "@/lib/rta/scheme-resolution";
import { cleanupSchemeMap } from "./scheme-map-cleanup";

const TEST_DB = process.env.TEST_DATABASE_URL;
const AMFI = { a: "9H0001", b: "9H0002", c: "9H0003", d: "9H0004" };
const ISIN = { a: "INF9H0A01AA1", other: "INF9H0A01BB2", shared: "INF9H0A01DD4" };
const kfin = (txn: string, product: string, isin: string, folio = "93900001", desc = "Nine Equity Fund - Regular Growth") => ({
  "Fund": "190", "Folio Number": folio, "Product Code": product, "Fund Description": desc, "Transaction Head": "P",
  "Transaction Description": "Purchase", "Transaction Type": "NEW", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ISIN: isin,
});

const am = (code: string) => ({ code, column: "payout_growth" as const, amc: null, name: null, plan: null, option: null, currentNav: true });
describe("decideScheme (pure)", () => {
  it("one ISIN on one AMFI scheme resolves; a confirmation it contradicts is a conflict", () => {
    expect(decideScheme({ observedIsins: ["inf1"], amfiByIsin: { INF1: [am("100")] }, confirmed: null })).toMatchObject({ status: "resolved_isin", amfiSchemeCode: "100" });
    expect(decideScheme({ observedIsins: ["INF1"], amfiByIsin: { INF1: [am("100")] }, confirmed: { amfiSchemeCode: "200", existsInFeed: true } }).status).toBe("conflict");
  });
  it("two ISINs, or one ISIN on two schemes, is a conflict; no evidence is unresolved; a confirmation resolves it", () => {
    expect(decideScheme({ observedIsins: ["A", "B"], amfiByIsin: {}, confirmed: null }).status).toBe("conflict");
    expect(decideScheme({ observedIsins: ["A"], amfiByIsin: { A: [am("1"), am("2")] }, confirmed: null }).status).toBe("conflict");
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: null })).toMatchObject({ status: "unresolved", reason: expect.stringMatching(/printed no ISIN/) });
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: { amfiSchemeCode: "1", existsInFeed: true } })).toMatchObject({ status: "confirmed", amfiSchemeCode: "1" });
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: { amfiSchemeCode: "1", existsInFeed: false } }).status).toBe("conflict");
  });
});

describe.skipIf(!TEST_DB)("registrar scheme codes → the Scheme Master (DB)", () => {
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  let S: typeof import("@/lib/rta/scheme-resolution");
  let R: typeof import("@/lib/rta/posting/reprocess");
  const t = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const run = async (name: string, buf: Buffer, source = "kfintech", kind = "daily_transaction_feed") => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, ${source}, ${kind}, '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const txn = async (order: string) => (await q(sql`SELECT scheme_code, rta_scheme_code, scheme_name, amc_name FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = ${order}`))[0];
  const code = async (product: string) => (await q(sql`SELECT id, status, amfi_scheme_code, observed_isins FROM scheme_rta_codes WHERE tenant_id = ${t}::uuid AND rta_scheme_code = ${product}`))[0];
  const outcome = async (order: string) => (await q(sql`SELECT posting_outcome, posting_reason, scheme_status FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND registrar_txn_no = ${order} ORDER BY created_at DESC LIMIT 1`))[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    process.env.RTA_SCHEME_GATE = "on";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    vf = await import("@/lib/rta/posting/validate-first");
    S = await import("@/lib/rta/scheme-resolution");
    R = await import("@/lib/rta/posting/reprocess");
    const C = await import("@/lib/rta/posting/controls");
    H2p = await import("./helpers/two-person");
    ops2p = await H2p.createOperators("smst");
    Object.assign(ops, { a: ops2p.a.userId, b: ops2p.b.userId });
    await H2p.release(ops2p, "global");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Schemes', 'Schemes', ${"ARN-SC" + t.slice(0, 6)})`);
      const nav = (c: string, name: string, isin: string | null, reinvest: string | null) => tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, isin, isin_reinvest, scheme_name, amc_name, nav, nav_date)
        VALUES (${c}, ${isin}, ${reinvest}, ${name}, 'Nine Mutual Fund', 55, '2026-10-07') ON CONFLICT (scheme_code) DO NOTHING`);
      await nav(AMFI.a, "Nine Equity Fund - Regular Plan - Growth", ISIN.a, null);
      // Its NAME is exactly how the registrar describes the code below that prints no ISIN — and must never be used.
      await nav(AMFI.b, "Nine Lookalike Fund - Regular Growth", null, null);
      await nav(AMFI.c, "Nine Debt Fund - Regular Growth", ISIN.shared, null);
      await nav(AMFI.d, "Nine Debt Fund - Regular IDCW", null, ISIN.shared);
      const inv = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Scheme Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, '190', 'AMC 190', '93900001', 'kfintech')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, 'H', 'AMC H', '5590001/11', 'cams')`);
    });
  });

  afterAll(async () => {

    await H2p?.retireOperators(ops2p);
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "tasks", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "scheme_rta_codes"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`UPDATE rta_staging_batches SET rerun_of_batch_id = NULL, same_file_as_batch_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_staging_batches WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM folios WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM families WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await cleanupSchemeMap(withSystem as any, sql, Object.values(AMFI));
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${AMFI.a}, ${AMFI.b}, ${AMFI.c}, ${AMFI.d})`);
    delete process.env.RTA_SCHEME_GATE;
  });

  it("a KFintech code whose ISIN names one AMFI scheme posts under the CRM Scheme Master code; the registrar's code is kept", async () => {
    const r = await run("k1.csv", csvOf(MFSD201_HEADER, [kfin("939001", "190EQRG", ISIN.a)]));
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
    expect(await code("190EQRG")).toMatchObject({ status: "resolved_isin", amfi_scheme_code: AMFI.a, observed_isins: [ISIN.a] });
    expect(await txn("939001")).toEqual({ scheme_code: AMFI.a, rta_scheme_code: "190EQRG", scheme_name: "Nine Equity Fund - Regular Plan - Growth", amc_name: "Nine Mutual Fund" });
    expect((await outcome("939001")).scheme_status).toBe("resolved_isin");
  });

  it("no ISIN: held as an actionable exception — even though an AMFI scheme has exactly the registrar's name", async () => {
    const r = await run("k2.csv", csvOf(MFSD201_HEADER, [kfin("939002", "190LOOK", "", "93900001", "Nine Lookalike Fund - Regular Growth")]));
    expect(r.posting).toMatchObject({ counts: { quarantined: 1 } });
    expect(await code("190LOOK")).toMatchObject({ status: "unresolved", amfi_scheme_code: null });
    expect(await outcome("939002")).toMatchObject({ posting_outcome: "quarantined", posting_reason: expect.stringMatching(/^scheme_unresolved: .*printed no ISIN/), scheme_status: "unresolved" });
    expect(await txn("939002")).toBeUndefined();
    const list = await withTenant(t, (tx) => S.loadSchemeCodes(tx, t, { status: "unresolved" }));
    expect(list.rows.find((x) => x.rtaSchemeCode === "190LOOK")).toMatchObject({ heldTransactions: 1, observedName: "Nine Lookalike Fund - Regular Growth" });
  });

  it("a person confirms the scheme (audited); the held transaction posts once, under the canonical code", async () => {
    const c = await code("190LOOK");
    await expect(withTenant(t, (tx) => S.confirmSchemeCode(tx, t, c.id, { amfiSchemeCode: "9H9999", note: "a code that is not in the feed", by: ops.a }))).rejects.toThrow(/not in the AMFI feed/);
    await expect(withTenant(t, (tx) => S.confirmSchemeCode(tx, t, c.id, { amfiSchemeCode: AMFI.b, note: "short", by: ops.a }))).rejects.toThrow(/at least 10/);
    await withTenant(t, (tx) => S.confirmSchemeCode(tx, t, c.id, { amfiSchemeCode: AMFI.b, note: "AMC code list checked: same plan and option", by: ops.a }));
    const re = await R.reprocessHeldTransactions(t, { schemeKeys: [{ rta: "kfintech", amcCode: "190", schemeCode: "190LOOK" }], userId: ops.a });
    expect(re.promoted).toBe(1);
    expect(await txn("939002")).toMatchObject({ scheme_code: AMFI.b, rta_scheme_code: "190LOOK" });
    expect(await code("190LOOK")).toMatchObject({ status: "confirmed", amfi_scheme_code: AMFI.b });
    const audit = await q(sql`SELECT action FROM audit_log WHERE tenant_id = ${t}::uuid AND action = 'rta.scheme.confirm'`);
    expect(audit).toHaveLength(1);
    // Posted once: re-evaluating again changes nothing.
    expect((await R.reprocessHeldTransactions(t, { schemeKeys: [{ rta: "kfintech", amcCode: "190", schemeCode: "190LOOK" }] })).promoted).toBe(0);
  });

  it("evidence beats a choice: a confirmation the registrar's ISIN contradicts is refused", async () => {
    const c = await code("190EQRG");
    await expect(withTenant(t, (tx) => S.confirmSchemeCode(tx, t, c.id, { amfiSchemeCode: AMFI.b, note: "trying to move a resolved code", by: ops.a }))).rejects.toThrow(/registrar's ISIN is AMFI 9H0001/);
  });

  it("two ISINs for one code, or one ISIN on two AMFI schemes, is a conflict — held, and cannot be confirmed away", async () => {
    await run("k3.csv", csvOf(MFSD201_HEADER, [kfin("939003", "190TWO", ISIN.a), kfin("939004", "190TWO", ISIN.other)]));
    expect(await code("190TWO")).toMatchObject({ status: "conflict" });
    expect((await outcome("939003")).posting_reason).toMatch(/^scheme_conflict: .*2 different ISINs/);
    const c = await code("190TWO");
    await expect(withTenant(t, (tx) => S.confirmSchemeCode(tx, t, c.id, { amfiSchemeCode: AMFI.a, note: "pick one of the two anyway", by: ops.a }))).rejects.toThrow(/not confirmed/);
    await run("k4.csv", csvOf(MFSD201_HEADER, [kfin("939005", "190DEBT", ISIN.shared)]));
    expect(await code("190DEBT")).toMatchObject({ status: "conflict" });
    expect((await outcome("939005")).posting_reason).toMatch(/ISIN is on 2 AMFI schemes/);
  });

  it("a CAMS code (CAMS prints no ISIN) is held until a person links it; a code is keyed with its AMC", async () => {
    const r2 = xlsOf(R2_HEADER, [{ amc_code: "H", folio_no: "5590001/11", prodcode: "HFC", scheme: "Nine Equity Fund - Regular Plan - Growth", trxnno: "939101", traddate: serial("2026-05-02"),
      units: "20.0000", amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: P.adult, siptrxnno: "" }], ["traddate"]);
    const r = await run("c1.xls", r2, "cams");
    expect(r.posting).toMatchObject({ counts: { quarantined: 1 } });
    expect(await code("HFC")).toMatchObject({ status: "unresolved" });
    expect((await outcome("939101")).posting_reason).toMatch(/^scheme_unresolved: cams scheme H\/HFC/);
  });

  it("holdings legs: an ISIN-resolved leg carries the canonical code; a CAMS leg stays on its registrar code and is never priced by name", async () => {
    const h203 = csvOf(MFSD203_HEADER, [{ "Product Code": "190EQRG", Fund: "190", "Folio Number": "93900001", "Fund Description": "Nine Equity Fund - Regular Growth", Balance: "10.000",
      "Agent Code": "ARN-990009", "Investor Name": "Synthetic Person", AUM: "500.00", NAV: "50.0000", "Report Date": "18/05/2026", PAN: P.adult, SchemeISIN: ISIN.a }]);
    await run("h1.csv", h203, "kfintech", "folio_master_dump");
    const r9 = xlsOf(R9_HEADER, [{ foliochk: "5590001/11", product: "HFC", sch_name: "Nine Equity Fund - Regular Plan - Growth", amc_code: "H", rep_date: serial("2026-05-18"),
      clos_bal: "20.000", rupee_bal: "1000.00", pan_no: P.adult, inv_name: "Synthetic Person", tax_status: "Individual" }], ["rep_date"]);
    await run("h2.xls", r9, "cams", "folio_master_dump");
    const legs = await q(sql`SELECT f.folio_number, s FROM folios f, jsonb_array_elements(f.schemes) s WHERE f.tenant_id = ${t}::uuid ORDER BY 1`);
    const k = legs.find((l) => l.folio_number === "93900001")!.s;
    const c = legs.find((l) => l.folio_number === "5590001/11")!.s;
    expect(k).toMatchObject({ schemeCode: AMFI.a, rtaSchemeCode: "190EQRG", schemeStatus: "resolved_isin" });
    expect(c).toMatchObject({ schemeCode: "HFC", rtaSchemeCode: "HFC", schemeStatus: "unresolved", value: 1000 });
    // AMFI.a has EXACTLY the CAMS leg's name and NAV 55 × 20 units = 1,100 — it must not be used.
    const { revalueAllFolios } = await import("@/lib/finance/aum-persist");
    await withTenant(t, (tx) => revalueAllFolios(tx));
    const after = (await q(sql`SELECT s FROM folios f, jsonb_array_elements(f.schemes) s WHERE f.tenant_id = ${t}::uuid AND f.folio_number = '5590001/11'`))[0].s;
    expect(after.value).toBe(1000);
  });

  it("with the gate off (development default) an unresolved code posts on its registrar code, its status recorded", async () => {
    process.env.RTA_SCHEME_GATE = "off";
    try {
      const r = await run("k5.csv", csvOf(MFSD201_HEADER, [kfin("939006", "190NEW", "")]));
      expect(r.posting).toMatchObject({ counts: { posted: 1 } });
      expect(await txn("939006")).toMatchObject({ scheme_code: "190NEW", rta_scheme_code: "190NEW" });
      expect((await outcome("939006")).scheme_status).toBe("unresolved");
    } finally {
      process.env.RTA_SCHEME_GATE = "on";
    }
  });
});
