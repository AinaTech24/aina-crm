/**
 * Phase 3G — dependency-aware re-evaluation of held transactions, on a real
 * Postgres (RLS on, non-superuser role). Transactions arrive BEFORE their
 * masters; the masters' arrival promotes exactly what is unambiguous — once —
 * and leaves the rest held, visible, with one manual-resolution task per
 * folio. Synthetic rows on the verified layouts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD203_HEADER, MFSD211_HEADER, R2_HEADER, R9_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const HUF_PAN = "ABCHA1234K"; // synthetic, H = HUF in the PAN's holder-type letter

const kfin = (txn: string, folio: string, extra: Record<string, string> = {}) => ({
  "Fund": "117", "Folio Number": folio, "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ...extra,
});
const r2 = (v: Record<string, string | number>) => ({
  amc_code: "H", folio_no: "5560001/11", prodcode: "HFC", trxnno: "960001", traddate: serial("2026-05-02"), units: "20.0000",
  amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: P.adult2, siptrxnno: "", ...v,
});
const r9 = (v: Record<string, string | number>) => ({ product: "HFC", amc_code: "H", rep_date: serial("2026-05-18"), clos_bal: "20.000", rupee_bal: "1000.00", inv_name: "Synthetic Minor", ...v });

describe.skipIf(!TEST_DB)("re-evaluation of held transactions (DB)", () => {
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  let rp: typeof import("@/lib/rta/posting/reprocess");
  const t = randomUUID();
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const run = async (name: string, buf: Buffer) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const econ = async (no: string) => (await q(sql`SELECT id::text, batch_id::text, posting_outcome, posting_reason, posting_history, match_rule FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND registrar_txn_no = ${no} ORDER BY created_at DESC LIMIT 1`))[0];
  const txn = async (no: string) => q(sql`SELECT t.investor_id::text AS inv, i.is_minor, i.pan, t.status FROM transactions t JOIN investors i ON i.id = t.investor_id WHERE t.tenant_id = ${t}::uuid AND t.order_id = ${no}`);
  const tasks = () => q(sql`SELECT meta->>'rtaHold' AS k, status FROM tasks WHERE tenant_id = ${t}::uuid AND meta ? 'rtaHold' ORDER BY created_at`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    vf = await import("@/lib/rta/posting/validate-first");
    rp = await import("@/lib/rta/posting/reprocess");
    H2p = await import("./helpers/two-person");
    ops2p = await H2p.createOperators("rp");
    await H2p.release(ops2p, "global");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Reprocess', 'Reprocess', ${"ARN-RP" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO users (tenant_id, email, name, roles, status) VALUES (${t}::uuid, ${"owner-" + t.slice(0, 8) + "@example.test"}, 'Reprocess Owner', ARRAY['owner']::text[], 'active')`);
      // The guardian is already a client (as in the real files).
      await tx.execute(sql`INSERT INTO investors (tenant_id, pan, name) VALUES (${t}::uuid, ${P.guardian}, 'Synthetic Guardian')`);
    });
  });

  afterAll(async () => {

    await H2p?.retireOperators(ops2p);
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "sips", "transactions", "tasks", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows"]) {
      await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    }
    await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`UPDATE rta_staging_batches SET rerun_of_batch_id = NULL, same_file_as_batch_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_staging_batches WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${t}::uuid`);
    for (const table of ["folios", "families"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`UPDATE investors SET guardian_investor_id = NULL, family_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM users WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("transactions first: an adult, a CAMS minor (guardian's PAN on the row) and an HUF with an individual PAN are all held; only the HUF is a task", async () => {
    const k = await run("txns.csv", csvOf(MFSD201_HEADER, [kfin("950001", "95000001"), kfin("950002", "95000001", { "Transaction Date": "15/5/2026" })]));
    expect(k.posting).toMatchObject({ counts: { quarantined: 2 } });
    const c = await run("r2.xls", xlsOf(R2_HEADER, [
      r2({ trxnno: "960001", folio_no: "5560001/11", pan: P.guardian, tax_status: "On Behalf Of Minor" }),
      r2({ trxnno: "960002", folio_no: "5560002/11", pan: P.adult2, tax_status: "HUF" }),
    ], ["traddate"]));
    expect(c.posting).toMatchObject({ counts: { quarantined: 2 } });
    expect(await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid`)).toEqual([{ n: 0 }]);
    // "Master not imported yet" is waiting, not ambiguity — only the HUF row (an individual PAN on an HUF) gets a task.
    expect((await tasks()).map((x) => x.k)).toEqual(["cams|H|5560002/11"]);
  });

  it("the masters arrive: the adult's and the minor's transactions are promoted to the RIGHT owner, once; the HUF stays held with a task", async () => {
    const m = await run("m211.csv", csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: "95000001", "Product Code": "117EQGR", "PAN Number": P.adult, "Report Date": "18/5/2026", "Investor Name": "Synthetic Adult", "Tax Status": "Individual" }]));
    expect(m.reevaluation).toMatchObject({ examined: 2, promoted: 2 });
    expect((await txn("950001"))[0]).toMatchObject({ pan: P.adult, status: "processed" });
    const cm = await run("r9.xls", xlsOf(R9_HEADER, [
      r9({ foliochk: "5560001/11", pan_no: "", guard_pan: P.guardian, tax_status: "On Behalf Of Minor" }),
      r9({ foliochk: "5560002/11", pan_no: P.adult2, tax_status: "HUF", inv_name: "Synthetic HUF" }),
    ], ["rep_date"]));
    expect(cm.reevaluation).toMatchObject({ promoted: 1 });
    const minor = await txn("960001");
    expect(minor).toHaveLength(1);
    expect(minor[0].is_minor).toBe(true); // the minor — never the guardian
    expect(minor[0].pan).not.toBe(P.guardian);
    expect(await txn("960002")).toEqual([]); // the HUF never goes to the Karta's individual PAN
    expect((await econ("960002")).posting_reason).toMatch(/^huf_owner_pan_unverified/);
    expect((await tasks()).map((x) => x.status)).toEqual(["open"]);
  });

  it("the original batch, rows and every earlier outcome are kept; re-evaluating again or re-importing adds nothing", async () => {
    const e = await econ("950001");
    expect(e.posting_outcome).toBe("posted");
    // The first entry is the original batch's hold; the last is the promotion; nothing in between is lost.
    expect(e.posting_history[0]).toMatchObject({ outcome: "quarantined", via: "batch" });
    expect(e.posting_history.at(-1)).toMatchObject({ outcome: "posted", via: "reevaluation" });
    expect(e.posting_history.at(-1)).toMatchObject({ previousOutcome: "quarantined", previousReason: expect.stringMatching(/^owner_not_on_record/) });
    const before = await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid`);
    const again = await rp.reprocessHeldTransactions(t, {});
    expect(again.promoted).toBe(0);
    const re = await run("txns-again.csv", csvOf(MFSD201_HEADER, [kfin("950001", "95000001"), kfin("950002", "95000001", { "Transaction Date": "15/5/2026" })]));
    expect(re.posting).toMatchObject({ counts: { already_posted: 2 } });
    expect(await q(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid`)).toEqual(before);
    expect((await tasks()).filter((x) => x.status === "open")).toHaveLength(1); // still one task, not one per run
  });

  it("the placeholder case (the nine): a KFintech minor's transactions on a folio a holdings file put on a PAN-less placeholder stay held with a task — never filed under the stand-in", async () => {
    // Holdings first (MFSD203 leaves a minor's PAN blank) → a placeholder owns the folio.
    await run("h203.csv", csvOf(MFSD203_HEADER, [{ "Product Code": "117EQGR", Fund: "117", "Folio Number": "95000077", "Fund Description": "Example Equity Fund - Growth", Balance: "10.000", "Agent Code": "ARN-990002", "Investor Name": "Synthetic Child", AUM: "500.00", NAV: "50.0000", "Report Date": "08/10/2026", PAN: "" }]));
    const [ph] = await q(sql`SELECT i.rta_nopan_key IS NOT NULL AS placeholder FROM folios f JOIN investors i ON i.id = f.investor_id WHERE f.tenant_id = ${t}::uuid AND f.folio_number = '95000077'`);
    expect(ph).toEqual({ placeholder: true });
    // The minor's instalment (status MINOR, guardian's PAN in its own column).
    const r = await run("minor.csv", csvOf(MFSD201_HEADER, [kfin("950077", "95000077", { PAN1: "", Status: "MINOR", GuardPanNo: P.guardian } as any)]));
    expect(r.posting).toMatchObject({ counts: { quarantined: 1 } });
    expect((await econ("950077")).posting_reason).toMatch(/placeholder_owner/);
    // Its master arrives — the importer will not move a folio off a placeholder by itself.
    const m = await run("m211-minor.csv", csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: "95000077", "Product Code": "117EQGR", "PAN Number": "", GuardPanNo: P.guardian, StatusDesc: "MINOR", "Report Date": "18/5/2026", "Investor Name": "Synthetic Child", "Tax Status": "Minor" } as any]));
    expect(m.reevaluation?.promoted ?? 0).toBe(0);
    expect(await txn("950077")).toEqual([]);
    expect((await econ("950077")).posting_outcome).toBe("quarantined");
    expect((await tasks()).filter((x) => x.status === "open").map((x) => x.k)).toEqual(expect.arrayContaining(["kfintech|117|95000077"]));
  });

  it("independence: a folio with a transaction still held for figures promotes none of its others", async () => {
    // Two lots of one redemption, each carrying STT → held for figures (group_stt_multiple); a SIP on the same folio waits.
    const lot = (id: string) => kfin("950101", "95000101", { "Transaction Head": "R", "Transaction Description": "Redemption", "Transaction Type": "RED", "Transaction ID": id, "Purchase Transaction No": `P${id}`, "Purchase Date": "2/1/2025", "Purchase Units": "10.000", "Purchase Amount": "400.00", Units: "10.000", Price: "49.5000", "Load Amount": "5.00", Amount: "495.00", STT: "0.01" });
    await run("fig.csv", csvOf(MFSD201_HEADER, [lot("L1"), lot("L2"), kfin("950102", "95000101")]));
    const m = await run("m211-fig.csv", csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: "95000101", "Product Code": "117EQGR", "PAN Number": P.adult, "Report Date": "18/5/2026", "Investor Name": "Synthetic Adult", "Tax Status": "Individual" }]));
    expect(m.reevaluation?.promoted ?? 0).toBe(0);
    expect((await econ("950102")).posting_outcome).toBe("held_dependent");
    expect(await txn("950102")).toEqual([]);
  });

  it("a master for ANOTHER folio introduces the client: a held purchase follows by the owner's own PAN, and a refused instruction on that newly opened folio settles in a second pass", async () => {
    const X = "AAAPQ5555Q"; // synthetic individual PAN with no client yet
    const refusedRow = (txn: string) => kfin(txn, "95000201", { PAN1: X, "Transaction Type": "SIND", "Transaction Description": "Pre rejection", Units: "0.000", Amount: "2000.00", Price: "0", Remarks: "Required amount not available" });
    const r = await run("x-txns.csv", csvOf(MFSD201_HEADER, [kfin("950201", "95000201", { PAN1: X }), refusedRow("950202")]));
    expect(r.posting).toMatchObject({ counts: { quarantined: 2 } });
    const m = await run("x-master.csv", csvOf(MFSD211_HEADER, [{ Fund: "117", Folio: "95000202", "Product Code": "117EQGR", "PAN Number": X, "Report Date": "18/5/2026", "Investor Name": "Synthetic X", "Tax Status": "Individual" }]));
    expect(m.reevaluation).toMatchObject({ promoted: 1, rejectedRecorded: 1 });
    expect((await txn("950201"))[0]).toMatchObject({ pan: X, status: "processed" });
    expect((await txn("950202"))[0]).toMatchObject({ pan: X, status: "rejected" });
  });

  it("a task closes when nothing on its folio is held any more", async () => {
    // Settle the HUF: the firm records the HUF client (H-type PAN) and the folio under it, then the registrar re-sends the row with the HUF PAN.
    await withTenant(t, async (tx) => {
      const huf = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, investor_category) VALUES (${huf}::uuid, ${t}::uuid, ${HUF_PAN}, 'Synthetic HUF', 'huf')`);
      await tx.execute(sql`UPDATE folios SET investor_id = ${huf}::uuid WHERE tenant_id = ${t}::uuid AND folio_number = '5560002/11'`).catch(() => null);
      const f = (await tx.execute(sql`SELECT 1 FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '5560002/11'`)).rows.length;
      if (!f) await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${t}::uuid, ${huf}::uuid, 'H', 'AMC H', '5560002/11', 'cams')`);
    });
    const r = await run("r2-huf.xls", xlsOf(R2_HEADER, [r2({ trxnno: "960002", folio_no: "5560002/11", pan: HUF_PAN, tax_status: "HUF" })], ["traddate"]));
    expect(r.posting).toMatchObject({ counts: { posted: 1 } });
    expect((await tasks()).find((x) => x.k === "cams|H|5560002/11")?.status).toBe("completed");
  });
});
