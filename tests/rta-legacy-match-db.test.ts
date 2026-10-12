/**
 * Final pilot patch, P1 — a validate-first transaction is linked to a CRM row
 * already holding its registrar number ONLY when every fact agrees, scheme
 * identity included (lib/rta/posting/legacy-match.ts). Pure cases, then the
 * real posting path against Postgres in RTA_POSTING_MODE=controlled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, csvOf, P } from "./rta-real-layouts";
import { cleanupSchemeMap } from "./scheme-map-cleanup";
import { legacyMatch, type LegacyRow, type IncomingTxn, type SchemeEvidence } from "@/lib/rta/posting/legacy-match";

const TEST_DB = process.env.TEST_DATABASE_URL;
const ISIN = "INF9L0A01AA1";
const AMFI = "9L0001";
const ORPHAN_AMFI = "9L0002"; // an AMFI scheme the registrar code is NOT mapped to

describe("legacyMatch (pure)", () => {
  const inv = "11111111-1111-4111-8111-111111111111";
  const row = (x: Partial<LegacyRow> = {}): LegacyRow => ({
    id: "t1", investorId: inv, folioRta: "kfintech", amcCode: "120", folioNumber: "F1", schemeCode: "120EQGP", rtaSchemeCode: null,
    date: "2026-04-15", type: "sip", direction: "inflow", amount: 1000, units: 20, status: "processed", ...x,
  });
  const inc: IncomingTxn = { rta: "kfintech", investorId: inv, amcCode: "120", folioNumber: "F1", schemeCode: "120EQGP", date: "2026-04-15", type: "sip", direction: "inflow", amount: 1000, units: 20, rejected: false };
  const ev = (x: Partial<SchemeEvidence> = {}): SchemeEvidence => ({ registrarCodes: new Set(["120EQGP"]), amfiCodes: new Set(["9X0001"]), amcCodes: new Set(["120"]), status: "resolved_isin", ...x });

  it("links only when every fact agrees", () => {
    expect(legacyMatch([row()], inc, ev())).toEqual({ match: true, id: "t1" });
    expect(legacyMatch([row({ schemeCode: "9X0001" })], inc, ev())).toEqual({ match: true, id: "t1" }); // the approved AMFI code
    expect(legacyMatch([row({ amcCode: null })], inc, ev())).toEqual({ match: true, id: "t1" }); // blank AMC, scheme still proven
  });

  it("names every differing fact, and holds as identity_conflict", () => {
    const cases: Array<[Partial<LegacyRow>, string]> = [
      [{ schemeCode: "120OTGP" }, "scheme"], [{ amcCode: "121" }, "AMC"], [{ folioNumber: "F2" }, "folio"], [{ investorId: "22222222-2222-4222-8222-222222222222" }, "client"],
      [{ folioRta: "cams" }, "registrar"], [{ date: "2026-04-16" }, "date"], [{ type: "lumpsum" }, "transaction type"], [{ direction: "outflow" }, "direction"],
      [{ status: "rejected" }, "status"], [{ amount: 1000.02 }, "amount"], [{ units: 20.001 }, "units"], [{ schemeCode: null }, "scheme (not recorded on the CRM row)"],
      [{ rtaSchemeCode: "120OTGP" }, "scheme"],
    ];
    for (const [x, what] of cases) {
      const d = legacyMatch([row(x)], inc, ev());
      expect(d.match).toBe(false);
      if (!d.match) { expect(d.differs).toContain(what); expect(d.reason).toMatch(/^identity_conflict: /); }
    }
    const two = legacyMatch([row(), row({ id: "t2" })], inc, ev());
    expect(two.match).toBe(false);
  });

  it("an unresolved or conflicting mapping can never verify an AMFI code; the registrar's own code still can", () => {
    const unresolved = ev({ amfiCodes: new Set(), status: "unresolved" });
    const d = legacyMatch([row({ schemeCode: "9X0001" })], inc, unresolved);
    expect(d.match).toBe(false);
    if (!d.match) expect(d.differs[0]).toMatch(/mapping is unresolved/);
    expect(legacyMatch([row({ schemeCode: "9X0001" })], inc, ev({ amfiCodes: new Set(), status: "conflict" })).match).toBe(false);
    expect(legacyMatch([row()], inc, unresolved)).toEqual({ match: true, id: "t1" });
  });

  it("historical identifiers and verified AMC successors count only when the evidence carries them", () => {
    expect(legacyMatch([row({ schemeCode: "120OLDGP" })], inc, ev()).match).toBe(false);
    expect(legacyMatch([row({ schemeCode: "120OLDGP" })], inc, ev({ registrarCodes: new Set(["120EQGP", "120OLDGP"]) })).match).toBe(true);
    expect(legacyMatch([row({ amcCode: "099" })], inc, ev()).match).toBe(false);
    expect(legacyMatch([row({ amcCode: "099" })], inc, ev({ amcCodes: new Set(["120", "099"]) })).match).toBe(true);
  });
});

describe.skipIf(!TEST_DB)("legacy matching through validate-first posting (DB)", () => {
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  const t = randomUUID();
  const inv = randomUUID();
  const other = randomUUID();
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const kfin = (txn: string, x: Record<string, string> = {}) => ({
    "Fund": "120", "Folio Number": "99000001", "Product Code": "120EQGP", "Fund Description": "Legacy Equity Fund - Growth", "Transaction Head": "P",
    "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
    "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ISIN, ...x,
  });
  /** A row as the existing importer writes it (no source feed; KFintech product code in scheme_code). */
  const legacy = async (txn: string, x: Partial<Record<"scheme_code" | "type" | "investor_id" | "amc_code", string>> = {}) => {
    const id = randomUUID();
    await withTenant(t, async (tx) => {
      const f = (await tx.execute(sql`SELECT id FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '99000001'`)).rows[0] as any;
      await tx.execute(sql`INSERT INTO transactions (id, tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name, type, direction, amount, units, nav, order_id, order_date, status)
        VALUES (${id}::uuid, ${t}::uuid, ${x.investor_id ?? inv}::uuid, ${f.id}::uuid, '99000001', ${x.amc_code ?? "120"}, 'AMC 120', ${x.scheme_code ?? "120EQGP"}, 'Legacy Equity Fund - Growth',
                ${x.type ?? "sip"}, 'inflow', 1000, 20, 50, ${txn}, '2026-04-15', 'processed')`);
    });
    return id;
  };
  const snapshot = (id: string) => q(sql`SELECT scheme_code, type, amount::text, units::text, status, investor_id::text, updated_at::text FROM transactions WHERE id = ${id}::uuid`);
  const run = async (name: string, rows: Record<string, string>[]) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf: csvOf(MFSD201_HEADER, rows), asOf: "2026-10-08" });
  };
  const outcome = async (txn: string) => (await q(sql`SELECT posting_outcome, posting_reason FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND registrar_txn_no = ${txn} ORDER BY created_at DESC LIMIT 1`))[0];
  const byNumber = async (txn: string) => (await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = ${txn}`))[0].n as number;

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
    vf = await import("@/lib/rta/posting/validate-first");
    H2p = await import("./helpers/two-person");
    ops2p = await H2p.createOperators("lm");
    await H2p.release(ops2p, "global");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO scheme_nav (scheme_code, isin, scheme_name, amc_name, nav, nav_date) VALUES
        (${AMFI}, ${ISIN}, 'Legacy Equity Fund - Regular Growth', 'Legacy Mutual Fund', 50, '2026-10-07'),
        (${ORPHAN_AMFI}, 'INF9L0A01AB9', 'Legacy Debt Fund - Regular Growth', 'Legacy Mutual Fund', 20, '2026-10-07') ON CONFLICT (scheme_code) DO NOTHING`);
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Legacy match', 'Legacy match', ${"ARN-LM" + t.slice(0, 6)})`);
    });
    await withTenant(t, async (tx) => {
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Legacy Adult'), (${other}::uuid, ${t}::uuid, ${P.adult2}, 'Another Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, '120', 'AMC 120', '99000001', 'kfintech')`);
    });
    await H2p.activate(ops2p, { tenantId: t, mode: "validate_first", postingEnabled: true, registrars: ["kfintech"], reportCodes: ["MFSD211", "MFSD201"], reason: "legacy matching test, KFintech pilot" });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await H2p?.retireOperators(ops2p);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations DISABLE TRIGGER rta_pipeline_activations_append_only`);
    for (const table of ["rta_posted_transactions", "sip_rejections", "transactions", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "rta_pipeline_activations", "scheme_rta_codes"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
    for (const table of ["rta_staging_economic_txns", "rta_staging_batches", "rta_file_imports", "folios", "investors", "audit_log"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await tryRun(sql`ALTER TABLE rta_pipeline_activations ENABLE TRIGGER rta_pipeline_activations_append_only`);
    await cleanupSchemeMap(withSystem as any, sql, [AMFI, ORPHAN_AMFI]);
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${AMFI}, ${ORPHAN_AMFI})`);
  });

  it("the same facts and the registrar's own scheme code: linked, not duplicated", async () => {
    const id = await legacy("880001");
    const r = await run("same.csv", [kfin("880001")]);
    expect(r.posting).toMatchObject({ counts: { matched_existing: 1 } });
    const [link] = await q(sql`SELECT transaction_id::text AS id, kind FROM rta_posted_transactions WHERE tenant_id = ${t}::uuid AND identity_key LIKE '%:880001'`);
    expect(link).toEqual({ id, kind: "matched_existing" });
    expect(await byNumber("880001")).toBe(1);
  });

  it("SAME order number, DIFFERENT scheme: held as identity_conflict naming the scheme; the legacy row is untouched; nothing new written", async () => {
    const id = await legacy("880002", { scheme_code: "120DBGP" });
    const before = await snapshot(id);
    const r = await run("other-scheme.csv", [kfin("880002")]);
    expect(r.posting).toMatchObject({ counts: { quarantined: 1 } });
    expect(await outcome("880002")).toMatchObject({ posting_outcome: "quarantined", posting_reason: expect.stringMatching(/^identity_conflict: .*differs in: scheme\)/) });
    expect(await snapshot(id)).toEqual(before);
    expect(await byNumber("880002")).toBe(1);
    expect(await q(sql`SELECT 1 FROM rta_posted_transactions WHERE tenant_id = ${t}::uuid AND identity_key LIKE '%:880002'`)).toHaveLength(0);
  });

  it("the CRM row carries the approved AMFI code: linked; an AMFI code the mapping does not name: held", async () => {
    await legacy("880003", { scheme_code: AMFI });
    expect((await run("amfi.csv", [kfin("880003")])).posting).toMatchObject({ counts: { matched_existing: 1 } });
    await legacy("880004", { scheme_code: ORPHAN_AMFI });
    expect((await run("orphan.csv", [kfin("880004")])).posting).toMatchObject({ counts: { quarantined: 1 } });
    expect((await outcome("880004")).posting_reason).toMatch(/differs in: scheme\)/);
  });

  it("an unresolved mapping cannot verify an AMFI code on the CRM row (held), though the registrar's own code still matches", async () => {
    // A scheme whose ISIN is not in the AMFI feed: the registrar code stays unresolved.
    const unmapped = { "Product Code": "120ZZGP", ISIN: "INF9L0A01ZZ9" };
    await legacy("880005", { scheme_code: AMFI });
    expect((await run("unresolved-amfi.csv", [kfin("880005", unmapped)])).posting).toMatchObject({ counts: { quarantined: 1 } });
    expect((await outcome("880005")).posting_reason).toMatch(/scheme \(the registrar → AMFI mapping is unresolved/);
    await legacy("880006", { scheme_code: "120ZZGP" });
    expect((await run("unresolved-own.csv", [kfin("880006", unmapped)])).posting).toMatchObject({ counts: { matched_existing: 1 } });
  });

  it("a different client or transaction type is held too", async () => {
    await legacy("880007", { investor_id: other });
    expect((await run("client.csv", [kfin("880007")])).posting).toMatchObject({ counts: { quarantined: 1 } });
    expect((await outcome("880007")).posting_reason).toMatch(/differs in: client\)/);
    await legacy("880008", { type: "lumpsum" });
    expect((await run("type.csv", [kfin("880008")])).posting).toMatchObject({ counts: { quarantined: 1 } });
    expect((await outcome("880008")).posting_reason).toMatch(/differs in: transaction type\)/);
  });

  it("a historical registrar code that an approved mapping ties to the same AMFI scheme: linked", async () => {
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO scheme_rta_codes (tenant_id, rta, rta_amc_code, rta_scheme_code, observed_isins, source_reports, amfi_scheme_code, status, status_reason, confirmed_by, confirmed_at, confirm_note)
      VALUES (${t}::uuid, 'kfintech', '120', '120OLDGP', ARRAY[${ISIN}], ARRAY['MFSD211'], ${AMFI}, 'resolved_isin', 'test: older product code of the same plan', NULL, NULL, NULL)`));
    await legacy("880009", { scheme_code: "120OLDGP" });
    expect((await run("historical.csv", [kfin("880009")])).posting).toMatchObject({ counts: { matched_existing: 1 } });
  });
});
