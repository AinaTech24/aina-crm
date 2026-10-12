/**
 * Phase 3I — registrar codes → the EXISTING Scheme Master (the AMFI scheme
 * code) on a real Postgres with the scheme gate on: the fail-safe matrix, two
 * firms on one platform mapping, operator approval and audit, holdings that
 * stay unmapped, and one verified scheme identity across the eight modules.
 * Synthetic AMFI rows and registrar rows in the real layouts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD203_HEADER, MFSD243_HEADER, R2_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";
import { cleanupSchemeMap } from "./scheme-map-cleanup";
import { GLOBAL_AMFI_LOCK_TIMEOUT_MS, lockGlobalAmfi } from "./helpers/global-amfi-lock";

const TEST_DB = process.env.TEST_DATABASE_URL;
const A = { fcd: "9I0001", fcr: "9I0002", fci: "9I0003", old: "9I0004", val: "9I0005", gone: "9I0006", kfc: "9I0011", amb1: "9I0012", amb2: "9I0013" };
const ISIN = {
  fcd: "INF9I0A01AA1", fcr: "INF9I0A01BB2", fciPay: "INF9I0A01CC3", fciRe: "INF9I0A01DD4", old: "INF9I0A01EE5", val: "INF9I0A01FF6", gone: "INF9I0A01GG7",
  kfc: "INF9I1A01AA7", amb: "INF9I1A01BB8",
};
const kfin = (txn: string, product: string, isin: string, desc: string, v: Record<string, string> = {}) => ({
  "Fund": "191", "Folio Number": "94100001", "Product Code": product, "Fund Description": desc, "Transaction Head": "P",
  "Transaction Description": "Purchase", "Transaction Type": "NEW", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ISIN: isin, ...v,
});
const r2 = (txn: string, folio: string, pan: string) => ({
  amc_code: "IO", folio_no: folio, prodcode: "IOFC", scheme: "Iota Flexi Cap Fund - Regular Plan - Growth", trxnno: txn, traddate: serial("2026-05-02"),
  units: "20.0000", amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan, siptrxnno: "",
});

describe.skipIf(!TEST_DB)("Phase 3I — scheme mapping fail-safes (DB)", () => {
  // Global AMFI reference state: one such file at a time (tests/helpers/global-amfi-lock.ts).
  let unlockAmfi: (() => Promise<void>) | null = null;
  beforeAll(async () => { unlockAmfi = await lockGlobalAmfi(TEST_DB!); }, GLOBAL_AMFI_LOCK_TIMEOUT_MS);
  afterAll(async () => { await unlockAmfi?.(); });
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  let S: typeof import("@/lib/rta/scheme-resolution");
  let R: typeof import("@/lib/rta/posting/reprocess");
  const tA = randomUUID(), tB = randomUUID();
  const ops = { a: randomUUID(), b: randomUUID() };
  const user = randomUUID();
  const feedId = randomUUID();
  const q = async <T = any>(t: string, s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const run = async (t: string, name: string, buf: Buffer, source = "kfintech", kind = "daily_transaction_feed") => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, ${source}, ${kind}, '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const code = async (t: string, product: string) => (await q(t, sql`SELECT id, status, reason_code, amfi_scheme_code, evidence_source, review_state FROM scheme_rta_codes WHERE tenant_id = ${t}::uuid AND rta_scheme_code = ${product}`))[0];
  const txn = async (t: string, order: string) => (await q(t, sql`SELECT scheme_code, rta_scheme_code, status FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = ${order}`))[0];
  const outcome = async (t: string, order: string) => (await q(t, sql`SELECT posting_outcome, posting_reason FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND registrar_txn_no = ${order} ORDER BY created_at DESC LIMIT 1`))[0];
  const ledger = async (t: string, order: string) => (await q(t, sql`SELECT count(*)::int AS n FROM rta_posted_transactions p JOIN rta_staging_economic_txns e ON e.tenant_id = p.tenant_id AND e.identity_key = p.identity_key WHERE p.tenant_id = ${t}::uuid AND e.registrar_txn_no = ${order}`))[0].n as number;
  const sys = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(s)).rows as T[]);

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
    ops2p = await H2p.createOperators("sm3i");
    Object.assign(ops, { a: ops2p.a.userId, b: ops2p.b.userId });
    await H2p.release(ops2p, "global");
    await withSystem(async (tx) => {
      // The latest AMFI feed: yesterday. A scheme last listed long ago is inactive.
      await tx.execute(sql`INSERT INTO amfi_feed_imports (id, source, sha256, bytes, layout, feed_date, status, note)
        VALUES (${feedId}::uuid, 'file', 'synthetic-test-feed', 0, 'current8', CURRENT_DATE - 1, 'applied', 'Phase 3I test fixture — synthetic')`);
      const nav = (c: string, name: string, amc: string, plan: string, option: string, pg: string | null, re: string | null, navDate = sql`CURRENT_DATE - 1`, seen = sql`CURRENT_DATE - 1`) => tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, isin, isin_payout_growth, isin_reinvest, scheme_name, plan, option_name, amc_name, nav, nav_date, first_seen_feed, last_seen_feed)
        VALUES (${c}, ${pg ?? re}, ${pg}, ${re}, ${name}, ${plan}, ${option}, ${amc}, 55, ${navDate}, ${seen}, ${seen}) ON CONFLICT (scheme_code) DO NOTHING`);
      await nav(A.fcd, "Iota Flexi Cap Fund - Direct Plan - Growth", "Iota Mutual Fund", "Direct Plan", "Growth", ISIN.fcd, null);
      await nav(A.fcr, "Iota Flexi Cap Fund - Regular Plan - Growth", "Iota Mutual Fund", "Regular Plan", "Growth", ISIN.fcr, null);
      await nav(A.fci, "Iota Flexi Cap Fund - Regular Plan - IDCW", "Iota Mutual Fund", "Regular Plan", "IDCW", ISIN.fciPay, ISIN.fciRe);
      await nav(A.old, "Iota Old Fund - Regular Plan - Growth", "Iota Mutual Fund", "Regular Plan", "Growth", ISIN.old, null, sql`DATE '2025-03-31'`, sql`DATE '2025-03-31'`);
      await nav(A.val, "Iota Value Fund - Regular Plan - Growth", "Iota Mutual Fund", "Regular Plan", "Growth", ISIN.val, null);
      // Current NAV, but not in the latest file: absence from one file is not inactivity.
      await nav(A.gone, "Iota Focused Fund - Regular Plan - Growth", "Iota Mutual Fund", "Regular Plan", "Growth", ISIN.gone, null, sql`CURRENT_DATE - 2`, sql`CURRENT_DATE - 9`);
      // The SAME name at another AMC — never a candidate for an Iota code.
      await nav(A.kfc, "Iota Flexi Cap Fund - Regular Plan - Growth", "Kappa Mutual Fund", "Regular Plan", "Growth", ISIN.kfc, null);
      await nav(A.amb1, "Kappa Debt Fund - Regular Plan - Growth", "Kappa Mutual Fund", "Regular Plan", "Growth", ISIN.amb, null);
      await nav(A.amb2, "Kappa Debt Fund - Direct Plan - Growth", "Kappa Mutual Fund", "Direct Plan", "Growth", ISIN.amb, null);
      for (const [t, n, pan, folios] of [[tA, "A", P.adult, [["191", "94100001", "kfintech"], ["192", "94200001", "kfintech"], ["193", "94300001", "kfintech"], ["IO", "6610001/11", "cams"]]],
        [tB, "B", P.adult2, [["191", "94100002", "kfintech"], ["IO", "6610002/11", "cams"]]]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, ${"Map " + n}, ${"Map " + n}, ${"ARN-3I" + n + t.slice(0, 5)})`);
        const inv = randomUUID();
        await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${pan}, ${"Map client " + n})`);
        for (const [amc, folio, rta] of folios) {
          await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${inv}::uuid, ${amc}, ${"AMC " + amc}, ${folio}, ${rta})`);
        }
      }
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${user}::uuid, ${tA}::uuid, ${`map-${tA.slice(0, 8)}@example.test`}, 'Map Operator', ARRAY['owner']::text[], 'active')`);
    });
  });

  afterAll(async () => {

    await H2p?.retireOperators(ops2p);
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const t of [tA, tB]) {
      for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "tasks", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows", "scheme_rta_codes"]) {
        await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
      }
      await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`UPDATE rta_staging_batches SET rerun_of_batch_id = NULL, same_file_as_batch_id = NULL WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_batches WHERE tenant_id = ${t}::uuid`);
      for (const table of ["rta_file_imports", "folios", "families", "investors", "audit_log", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
      await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    }
    await cleanupSchemeMap(withSystem as any, sql, Object.values(A));
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${sql.join(Object.values(A).map((c) => sql`${c}`), sql`, `)})`);
    await tryRun(sql`DELETE FROM amfi_feed_imports WHERE id = ${feedId}::uuid`);
    delete process.env.RTA_SCHEME_GATE;
  });

  it("a KFintech ISIN on one AMFI scheme: verified, posted under the AMFI code, and recorded once for the platform — with no firm in it", async () => {
    const r = await run(tA, "k1.csv", csvOf(MFSD201_HEADER, [kfin("941001", "191FCDG", ISIN.fcd, "Iota Flexi Cap Fund - Direct Growth")]));
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
    expect(await code(tA, "191FCDG")).toMatchObject({ status: "resolved_isin", reason_code: "isin_verified", amfi_scheme_code: A.fcd, evidence_source: "registrar_isin" });
    expect(await txn(tA, "941001")).toMatchObject({ scheme_code: A.fcd, rta_scheme_code: "191FCDG" });
    const g = await sys(sql`SELECT basis, status, evidence_isin, isin_column FROM scheme_registrar_map WHERE rta = 'kfintech' AND rta_amc_code = '191' AND rta_scheme_code = '191FCDG'`);
    expect(g).toEqual([{ basis: "isin", status: "verified", evidence_isin: ISIN.fcd, isin_column: "payout_growth" }]);
    const cols = (await sys<{ c: string }>(sql`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'scheme_registrar_map'`)).map((x) => x.c);
    expect(cols).not.toContain("tenant_id");
  });

  it("a renamed scheme resolves by its ISIN whatever the registrar calls it; a scheme whose AMFI NAV is historical is labelled so and its old NAV is never current; one merely absent from the latest file is not", async () => {
    await run(tA, "k2.csv", csvOf(MFSD201_HEADER, [
      kfin("941002", "191REN", ISIN.val, "Iota Contra Fund - Regular Growth"),
      kfin("941003", "191OLD", ISIN.old, "Iota Old Fund - Regular Growth"),
      kfin("941004", "191GONE", ISIN.gone, "Iota Focused Fund - Regular Growth"),
    ]));
    expect(await code(tA, "191GONE")).toMatchObject({ status: "resolved_isin", reason_code: "isin_verified", amfi_scheme_code: A.gone });
    expect(await code(tA, "191REN")).toMatchObject({ status: "resolved_isin", reason_code: "isin_verified", amfi_scheme_code: A.val });
    expect(await code(tA, "191OLD")).toMatchObject({ status: "resolved_isin", reason_code: "isin_verified_historical", amfi_scheme_code: A.old });
    const { loadValuationRows } = await import("@/lib/finance/valuation");
    const [inv] = await q(tA, sql`SELECT id FROM investors WHERE tenant_id = ${tA}::uuid`);
    const rows = await withTenant(tA, (tx) => loadValuationRows(tx, [inv.id]));
    const nav = (c: string) => rows.transactions.find((x: any) => x.scheme_code === c)?.latest_nav;
    expect(Number(nav(A.fcd))).toBe(55); // yesterday's NAV is current
    expect(nav(A.old)).toBeNull(); // March 2025 is not
  });

  it("plan / option contradictions are quarantined before posting — not counted as posted", async () => {
    const r = await run(tA, "k3.csv", csvOf(MFSD201_HEADER, [
      kfin("941011", "191FCRG", ISIN.fcr, "Iota Flexi Cap Fund - Direct Growth"), // Direct words, Regular ISIN
      kfin("941012", "191FCGI", ISIN.fciPay, "Iota Flexi Cap Fund - Regular Growth"), // Growth words, IDCW ISIN
      kfin("941013", "191FCIR", ISIN.fciRe, "Iota Flexi Cap Fund - Regular IDCW Payout"), // payout words, reinvestment ISIN
    ]));
    expect(r.posting).toMatchObject({ counts: { quarantined: 3 } });
    for (const [p, o] of [["191FCRG", "941011"], ["191FCGI", "941012"], ["191FCIR", "941013"]]) {
      expect(await code(tA, p)).toMatchObject({ status: "conflict", reason_code: "plan_option_mismatch", amfi_scheme_code: null });
      expect((await outcome(tA, o)).posting_reason).toMatch(/^scheme_conflict: /);
      expect(await txn(tA, o)).toBeUndefined();
      expect(await ledger(tA, o)).toBe(0);
    }
  });

  it("an ISIN on two AMFI schemes is ambiguous; a registrar AMC whose codes point to two AMFI AMCs holds every code under it; neither reaches the platform map", async () => {
    await run(tA, "k4.csv", csvOf(MFSD201_HEADER, [kfin("942001", "192AMB", ISIN.amb, "Kappa Debt Fund - Growth", { Fund: "192", "Folio Number": "94200001" })]));
    expect(await code(tA, "192AMB")).toMatchObject({ status: "conflict", reason_code: "isin_ambiguous" });
    await run(tA, "k5.csv", csvOf(MFSD201_HEADER, [
      kfin("943001", "193A", ISIN.fcd, "Iota Flexi Cap Fund - Direct Growth", { Fund: "193", "Folio Number": "94300001" }),
      kfin("943002", "193B", ISIN.kfc, "Iota Flexi Cap Fund - Regular Growth", { Fund: "193", "Folio Number": "94300001" }),
    ]));
    expect(await code(tA, "193A")).toMatchObject({ status: "conflict", reason_code: "amc_mismatch" });
    expect(await code(tA, "193B")).toMatchObject({ status: "conflict", reason_code: "amc_mismatch" });
    expect(await sys(sql`SELECT 1 FROM scheme_registrar_map WHERE rta_amc_code IN ('192', '193')`)).toEqual([]);
    // The AMC identity is recorded from ISIN evidence only when it is unanimous.
    expect(await sys(sql`SELECT rta_amc_code, amfi_amc, role, basis, status FROM registrar_amc_identity WHERE rta = 'kfintech' AND rta_amc_code IN ('191', '193') AND status <> 'revoked'`))
      .toEqual([{ rta_amc_code: "191", amfi_amc: "Iota Mutual Fund", role: "primary", basis: "isin", status: "verified" }]);
  });

  it("no ISIN: held; candidates come from the registrar AMC's own schemes, never a same-named scheme at another AMC; reject, defer and approve are checked and audited", async () => {
    const r = await run(tA, "k6.csv", csvOf(MFSD201_HEADER, [kfin("941021", "191NOI", "", "Iota Flexi Cap Fund - Regular Growth")]));
    expect(r.posting).toMatchObject({ counts: { quarantined: 1 } });
    const c = await code(tA, "191NOI");
    expect(c).toMatchObject({ status: "unresolved", reason_code: "no_isin" });
    expect(await ledger(tA, "941021")).toBe(0);
    const cand = await withTenant(tA, (tx) => S.schemeCandidates(tx, tA, c.id));
    expect(cand).toMatchObject({ amcEstablished: true, registrarAmc: ["Iota Mutual Fund"] });
    const codes = cand.candidates.map((x) => x.amfiSchemeCode);
    expect(codes).toContain(A.fcr);
    expect(codes).not.toContain(A.kfc); // same name, other AMC
    expect(codes).not.toContain(A.fcd); // Direct — the registrar says Regular
    expect(codes).not.toContain(A.fci); // IDCW — the registrar says Growth
    expect(cand.candidates.find((x) => x.amfiSchemeCode === A.fcr)).toMatchObject({ basis: "name" });
    expect(cand.candidates.find((x) => x.amfiSchemeCode === A.old)?.warnings.join(" ")).toMatch(/historical/);

    const confirm = (amfi: string, src: "amc_scheme_list" = "amc_scheme_list") => withTenant(tA, (tx) => S.confirmSchemeCode(tx, tA, c.id, { amfiSchemeCode: amfi, note: "checked against the AMC's scheme list", by: user, evidenceSource: src }));
    await expect(confirm(A.kfc)).rejects.toThrow(/not confirmed: .*AMC/);
    await expect(confirm(A.fcd)).rejects.toThrow(/not confirmed: plan \/ option/);
    await withTenant(tA, (tx) => S.rejectSchemeCandidate(tx, tA, c.id, { amfiSchemeCode: A.old, note: "closed scheme — not this one", by: user }));
    await expect(confirm(A.old)).rejects.toThrow(/rejected for this code before/);
    expect((await withTenant(tA, (tx) => S.schemeCandidates(tx, tA, c.id))).candidates.map((x) => x.amfiSchemeCode)).not.toContain(A.old);
    await withTenant(tA, (tx) => S.deferSchemeCode(tx, tA, c.id, { defer: true, note: "waiting for the AMC's plan list", by: user }));
    expect((await withTenant(tA, (tx) => S.loadSchemeCodes(tx, tA))).rows.find((x) => x.rtaSchemeCode === "191NOI")).toMatchObject({ reviewState: "deferred", heldTransactions: 1 });

    const d = await confirm(A.fcr);
    expect(d).toMatchObject({ status: "confirmed", reasonCode: "firm_confirmed" });
    expect(await code(tA, "191NOI")).toMatchObject({ status: "confirmed", evidence_source: "amc_scheme_list", review_state: null });
    const audit = await q(tA, sql`SELECT action, after->>'evidenceSource' AS src FROM audit_log WHERE tenant_id = ${tA}::uuid AND entity_id = ${c.id}::uuid ORDER BY at`);
    expect(audit.map((a) => a.action)).toEqual(["rta.scheme.reject_candidate", "rta.scheme.defer", "rta.scheme.confirm"]);
    expect(audit[2].src).toBe("amc_scheme_list");
    expect((await R.reprocessHeldTransactions(tA, { schemeKeys: [{ rta: "kfintech", amcCode: "191", schemeCode: "191NOI" }], userId: user })).promoted).toBe(1);
    expect(await txn(tA, "941021")).toMatchObject({ scheme_code: A.fcr, rta_scheme_code: "191NOI" });
    // A firm's own confirmation stays the firm's: it is not a platform mapping.
    expect(await sys(sql`SELECT 1 FROM scheme_registrar_map WHERE rta_scheme_code = '191NOI'`)).toEqual([]);
  });

  it("two firms share one verified platform mapping; neither sees the other's codes", async () => {
    const r = await run(tB, "kb1.csv", csvOf(MFSD201_HEADER, [kfin("941101", "191FCDG", "", "Iota Flexi Cap Fund - Direct Growth", { "Folio Number": "94100002", PAN1: P.adult2 })]));
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
    expect(await code(tB, "191FCDG")).toMatchObject({ status: "resolved_isin", reason_code: "global_isin", amfi_scheme_code: A.fcd });
    expect(await txn(tB, "941101")).toMatchObject({ scheme_code: A.fcd, rta_scheme_code: "191FCDG" });
    expect(await q(tB, sql`SELECT 1 FROM scheme_rta_codes WHERE tenant_id = ${tA}::uuid`)).toEqual([]);
    expect(await q(tA, sql`SELECT 1 FROM scheme_rta_codes WHERE tenant_id = ${tB}::uuid`)).toEqual([]);
    const aCode = await code(tA, "191NOI");
    await expect(withTenant(tB, (tx) => S.schemeCandidates(tx, tB, aCode.id))).rejects.toThrow(/not found/);
    await expect(withTenant(tB, (tx) => S.confirmSchemeCode(tx, tB, aCode.id, { amfiSchemeCode: A.fcr, note: "another firm's code id", by: user, evidenceSource: "other_document" }))).rejects.toThrow(/not found/);
  });

  it("platform approval needs two operators; it maps a CAMS code for every firm; revocation re-holds new imports and repairs nothing", async () => {
    await run(tA, "c1.xls", xlsOf(R2_HEADER, [r2("944001", "6610001/11", P.adult)], ["traddate"]), "cams");
    expect(await code(tA, "IOFC")).toMatchObject({ status: "unresolved", reason_code: "no_isin" });
    const input = { rta: "cams" as const, amcCode: "IO", schemeCode: "IOFC", amfiSchemeCode: A.fcr, note: "AMC scheme list read by both operators" };
    // No scheme is approved under an AMC whose identity is not verified (CAMS prints no ISIN).
    await expect(withSystem((tx) => S.approvePlatformMapping(tx, { ...input, requestedBy: ops.a, approvedBy: ops.b }))).rejects.toThrow(/not verified yet/);
    await withSystem((tx) => S.approveAmcIdentity(tx, { rta: "cams", amcCode: "IO", amfiAmc: "Iota Mutual Fund", role: "primary", note: "CAMS AMC code list: IO is Iota", requestedBy: ops.a, approvedBy: ops.b }));
    await expect(withSystem((tx) => S.approvePlatformMapping(tx, { ...input, requestedBy: ops.a, approvedBy: ops.a }))).rejects.toThrow(/different operators/);
    await expect(sys(sql`INSERT INTO scheme_registrar_map (rta, rta_amc_code, rta_scheme_code, amfi_scheme_code, basis, status, evidence_note, requested_by, approved_by)
      VALUES ('cams', 'IO', 'IOFC', ${A.fcr}, 'platform_approval', 'approved', 'one person twice', ${ops.a}::uuid, ${ops.a}::uuid)`)).rejects.toThrow();
    const ok = await withSystem((tx) => S.approvePlatformMapping(tx, { ...input, requestedBy: ops.a, approvedBy: ops.b }));
    expect(ok.tenantIds).toContain(tA);
    expect(await code(tA, "IOFC")).toMatchObject({ status: "confirmed", reason_code: "platform_approved", amfi_scheme_code: A.fcr });
    expect((await R.reprocessHeldTransactions(tA, { schemeKeys: [{ rta: "cams", amcCode: "IO", schemeCode: "IOFC" }] })).promoted).toBe(1);
    expect(await txn(tA, "944001")).toMatchObject({ scheme_code: A.fcr, rta_scheme_code: "IOFC" });
    // The other firm posts the same code at once.
    const rb = await run(tB, "cb1.xls", xlsOf(R2_HEADER, [r2("944101", "6610002/11", P.adult2)], ["traddate"]), "cams");
    expect(rb.posting).toMatchObject({ counts: { posted: 1 } });
    // A firm cannot confirm its way around a platform mapping; an operator cannot approve over a verified one.
    const ac = await code(tA, "IOFC");
    await expect(withTenant(tA, (tx) => S.confirmSchemeCode(tx, tA, ac.id, { amfiSchemeCode: A.fcd, note: "a different scheme from the firm", by: user, evidenceSource: "other_document" }))).rejects.toThrow(/platform mapping/);
    await expect(withSystem((tx) => S.approvePlatformMapping(tx, { rta: "kfintech", amcCode: "191", schemeCode: "191FCDG", amfiSchemeCode: A.fcr, note: "trying to overwrite the ISIN", requestedBy: ops.a, approvedBy: ops.b }))).rejects.toThrow(/revoke it first/);
    // The history is append-only.
    const edit = await sys(sql`UPDATE scheme_registrar_map_events SET reason = 'edited' WHERE map_id = ${ok.id}::uuid`).then(() => null, (e) => e);
    expect(String(edit?.cause?.message ?? edit?.message)).toMatch(/append-only/);
    expect((await sys(sql`SELECT action, actor::text AS actor, second_actor::text AS second FROM scheme_registrar_map_events WHERE map_id = ${ok.id}::uuid`))[0]).toEqual({ action: "approve", actor: ops.b, second: ops.a });
    // Revoke (one operator): codes go back to unresolved; posted rows stay as they are; a new import is held.
    await withSystem((tx) => S.revokePlatformMapping(tx, { id: ok.id, by: ops.a, reason: "the AMC list was the wrong year" }));
    expect(await code(tA, "IOFC")).toMatchObject({ status: "unresolved" });
    expect(await code(tB, "IOFC")).toMatchObject({ status: "unresolved" });
    expect(await txn(tA, "944001")).toMatchObject({ scheme_code: A.fcr });
    const again = await run(tA, "c2.xls", xlsOf(R2_HEADER, [r2("944002", "6610001/11", P.adult)], ["traddate"]), "cams");
    expect(again.posting).toMatchObject({ counts: { quarantined: 1 } });
  });

  it("re-importing the same file changes nothing — no new rows, no new platform mappings, no new events", async () => {
    const before = await sys(sql`SELECT (SELECT count(*) FROM scheme_registrar_map)::int AS m, (SELECT count(*) FROM scheme_registrar_map_events)::int AS e`);
    const tx0 = (await q(tA, sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tA}::uuid`))[0].n;
    const r = await run(tA, "k1-again.csv", csvOf(MFSD201_HEADER, [kfin("941001", "191FCDG", ISIN.fcd, "Iota Flexi Cap Fund - Direct Growth")]));
    expect((r.posting as { counts?: Record<string, number> } | undefined)?.counts?.posted ?? 0).toBe(0);
    expect((await q(tA, sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tA}::uuid`))[0].n).toBe(tx0);
    expect(await sys(sql`SELECT (SELECT count(*) FROM scheme_registrar_map)::int AS m, (SELECT count(*) FROM scheme_registrar_map_events)::int AS e`)).toEqual(before);
  });

  it("holdings: an unmapped leg keeps the registrar's units, value and date, labelled unresolved, and is never priced — even beside a same-named AMFI scheme; a confirmation relabels it", async () => {
    const h = csvOf(MFSD203_HEADER, [
      { "Product Code": "191FCDG", Fund: "191", "Folio Number": "94100001", "Fund Description": "Iota Flexi Cap Fund - Direct Growth", Balance: "10.000", "Agent Code": "ARN-990009",
        "Investor Name": "Synthetic Person", AUM: "600.00", NAV: "60.0000", "Report Date": "18/05/2026", PAN: P.adult, SchemeISIN: ISIN.fcd },
      { "Product Code": "191NOH", Fund: "191", "Folio Number": "94100001", "Fund Description": "Iota Flexi Cap Fund - Regular Growth", Balance: "10.000", "Agent Code": "ARN-990009",
        "Investor Name": "Synthetic Person", AUM: "600.00", NAV: "60.0000", "Report Date": "18/05/2026", PAN: P.adult, SchemeISIN: "" },
    ]);
    await run(tA, "h1.csv", h, "kfintech", "folio_master_dump");
    const leg = async (rtaCode: string) => (await q(tA, sql`SELECT s FROM folios f, jsonb_array_elements(f.schemes) s WHERE f.tenant_id = ${tA}::uuid AND f.folio_number = '94100001' AND s->>'rtaSchemeCode' = ${rtaCode}`))[0]?.s;
    expect(await leg("191NOH")).toMatchObject({ schemeCode: "191NOH", schemeStatus: "unresolved", value: 600, sourceValue: 600, sourceAsOf: "2026-05-18" });
    expect(await leg("191FCDG")).toMatchObject({ schemeCode: A.fcd, schemeStatus: "resolved_isin", sourceValue: 600 });
    const { revalueAllFolios } = await import("@/lib/finance/aum-persist");
    await withTenant(tA, (tx) => revalueAllFolios(tx));
    expect((await leg("191NOH")).value).toBe(600); // never 10 × 55 by name
    expect((await leg("191FCDG")).value).toBe(550); // the resolved leg takes the current NAV, by code
    expect((await leg("191FCDG")).sourceValue).toBe(600); // the registrar's figure is kept beside it
    // A person confirms 191NOH: the leg follows, without waiting for the next statement.
    const c = await code(tA, "191NOH");
    await withTenant(tA, (tx) => S.confirmSchemeCode(tx, tA, c.id, { amfiSchemeCode: A.fcr, note: "checked against the AMC's scheme list", by: user, evidenceSource: "amc_scheme_list" }));
    expect(await leg("191NOH")).toMatchObject({ schemeCode: A.fcr, schemeStatus: "confirmed", rtaSchemeCode: "191NOH" });
  });

  it("one verified scheme identity across the eight modules", async () => {
    // SIP Master / Active SIP Book: a live registration on the verified code.
    await run(tA, "mfsd243.csv", csvOf(MFSD243_HEADER, [{
      Folio: "94100001", "Fund Code": "191", "Product Code": "191FCDG", RegistrationDate: "01/10/2026", "Start Date": "10/09/2026", "End Date": "10/09/2036",
      "No Of Installments": "120", Amount: "1000", Frequency: "Monthly", Trtype: "SIP", Status: "Live SIP", TerminateDate: "", RegSlno: "941901",
    }]));
    // Transaction Rejection + SIP Rejection: a refused instalment of that registration.
    await run(tA, "k7.csv", csvOf(MFSD201_HEADER, [kfin("941031", "191FCDG", "", "Iota Flexi Cap Fund - Direct Growth", {
      "Transaction Type": "SIND", "Transaction Description": "Pre rejection", Units: "0.000", Amount: "1000.00", Price: "0", Remarks: "Required amount not available", sipregslno: "941901", "Transaction Date": "10/10/2026" })]));
    const one = async (s: ReturnType<typeof sql>) => (await q(tA, s))[0];
    const modules = {
      transactions: await one(sql`SELECT scheme_code, rta_scheme_code FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = '941001'`),
      transactionRejection: await one(sql`SELECT scheme_code, rta_scheme_code FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = '941031' AND status = 'rejected'`),
      sipRejection: await one(sql`SELECT scheme_code, rta_scheme_code FROM sip_rejections WHERE tenant_id = ${tA}::uuid ORDER BY created_at DESC LIMIT 1`),
      sipMaster: await one(sql`SELECT amfi_scheme_code AS scheme_code, scheme_code AS rta_scheme_code FROM rta_sip_registrations WHERE tenant_id = ${tA}::uuid AND registration_id = '941901'`),
      activeSipBook: await one(sql`SELECT scheme_code, rta_scheme_code FROM sips WHERE tenant_id = ${tA}::uuid AND rta_scheme_code = '191FCDG'`),
      clientMaster: await one(sql`SELECT s->>'schemeCode' AS scheme_code, s->>'rtaSchemeCode' AS rta_scheme_code FROM folios f, jsonb_array_elements(f.schemes) s WHERE f.tenant_id = ${tA}::uuid AND s->>'rtaSchemeCode' = '191FCDG'`),
    };
    for (const [name, row] of Object.entries(modules)) expect({ name, ...row }).toEqual({ name, scheme_code: A.fcd, rta_scheme_code: "191FCDG" });
    // Accurate AUM + Client Portfolio: valued by code at the current NAV, one row per scheme.
    const { loadValuationRows, computeInvestorValuation } = await import("@/lib/finance/valuation");
    const [inv] = await q(tA, sql`SELECT id FROM investors WHERE tenant_id = ${tA}::uuid`);
    const rows = await withTenant(tA, (tx) => loadValuationRows(tx, [inv.id]));
    const snap = rows.snapshots.find((x: any) => x.scheme?.rtaSchemeCode === "191FCDG");
    expect(Number(snap?.latest_nav)).toBe(55);
    const val = computeInvestorValuation(rows.transactions as any, rows.snapshots as any);
    expect(val.holdings.filter((h) => h.schemeCode === A.fcd)).toHaveLength(1);
    const folioAum = (await q(tA, sql`SELECT aum::float8 AS aum FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '94100001'`))[0].aum;
    expect(folioAum).toBeGreaterThan(0);
  });
});
