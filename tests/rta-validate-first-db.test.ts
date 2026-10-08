/**
 * Phase 3F — validate-first import and DEVELOPMENT posting, end to end on a
 * real Postgres (RLS on, non-superuser role): file → stage → validate →
 * resolve owners → classify → reconcile → gated atomic commit → database.
 * Synthetic people and money on the verified MFSD201 / MFSD211 / R2 layouts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD203_HEADER, MFSD211_HEADER, MFSD243_HEADER, R2_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

const kfin = (v: Record<string, string>) => ({
  "Fund": "117", "Folio Number": "92000001", "Product Code": "117EQGR", "Scheme Code": "EQ", "Fund Description": "Example Equity Fund - Growth",
  "Transaction Head": "P", "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y",
  "Transaction Date": "15/4/2026", "Process Date": "15/4/2026", "Nav Date": "15/4/2026", "Nav": "50.0000", "Price": "50.0000", "PAN1": P.adult, ...v,
});
const sip = (txn: string, extra: Record<string, string> = {}) => kfin({ "Transaction Number": txn, Units: "20.000", Amount: "1000.00", ...extra });
const lot = (txn: string, lotId: string, units: string, extra: Record<string, string> = {}) => {
  const u = Number(units), gross = u * 50, load = Math.round(gross * 0.01 * 100) / 100;
  return kfin({
    "Transaction Number": txn, "Transaction Head": "R", "Transaction Description": "Redemption", "Transaction Type": "RED", "Load Percentage": "1",
    "Transaction ID": lotId, "Purchase Transaction No": `P${lotId}`, "Purchase Date": "2/1/2025", "Purchase Units": units, "Purchase Amount": (u * 40).toFixed(2),
    Units: units, Price: "49.5000", "Load Amount": load.toFixed(2), Amount: (gross - load).toFixed(2), STT: "0.01", ...extra,
  });
};
const refused = (txn: string, type: string, extra: Record<string, string> = {}) =>
  kfin({ "Transaction Number": txn, "Transaction Type": type, "Transaction Description": "Pre rejection", Units: "0.000", Amount: "2000.00", Price: "0", Remarks: "Primary KYC Invalid ref 123", ...extra });
const mfsd201 = (rows: Record<string, string>[]) => csvOf(MFSD201_HEADER, rows);
const m211 = (rows: Record<string, string>[]) => csvOf(MFSD211_HEADER, rows.map((r) => ({ Fund: "117", "Product Code": "117EQGR", "Report Date": "18/5/2026", "Investor Name": "Synthetic Person", "Tax Status": "Individual", ...r })));
const r2 = (v: Record<string, string | number>) => ({
  amc_code: "H", folio_no: "5550001/11", prodcode: "HFC", trxnno: "900001", traddate: serial("2026-05-02"), units: "20.0000",
  amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase", trxntype: "P1", trxnstat: "Y", pan: P.adult2, siptrxnno: "", ...v,
});
const camsR2 = (rows: Record<string, string | number>[]) => xlsOf(R2_HEADER, rows, ["traddate"]);

describe.skipIf(!TEST_DB)("validate-first import + development posting (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  let gate: typeof import("@/lib/rta/posting/gate");
  let post: typeof import("@/lib/rta/posting/post");

  const tE = randomUUID(); // an empty firm
  const tH = randomUUID(); // a firm with existing history
  const tX = randomUUID(); // a second firm, for concurrency / isolation
  const inv = { adult: randomUUID(), minor: randomUUID(), guardian: randomUUID(), h: randomUUID(), x: randomUUID() };
  const q = async <T = any>(t: string, s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  /** An upload: the rta_file_imports row the upload route creates, then the import. */
  const newImport = async (t: string, name: string) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return id;
  };
  const run = async (t: string, buf: Buffer, name: string, importId?: string | null, extra: Record<string, unknown> = {}) =>
    vf.validateFirstImport({ tenantId: t, importId: importId === undefined ? await newImport(t, name) : importId, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08", ...extra });
  const txns = (t: string) => q(t, sql`SELECT order_id, status, type, direction, amount::text AS amount, units::text AS units, investor_id::text AS inv, raw_feed_row->>'lotCount' AS lots FROM transactions WHERE tenant_id = ${t}::uuid ORDER BY order_id`);
  const counts = (t: string) => q(t, sql`SELECT (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid)::int AS tx, (SELECT count(*) FROM rta_posted_transactions WHERE tenant_id = ${t}::uuid)::int AS ledger, (SELECT count(*) FROM sip_rejections WHERE tenant_id = ${t}::uuid)::int AS rej`).then((r) => r[0]);
  const ENV = { ...process.env };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.RTA_POSTING_MODE = "development";
    process.env.RTA_POSTING_DATABASE = new URL(TEST_DB!).pathname.slice(1);
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    vf = await import("@/lib/rta/posting/validate-first");
    gate = await import("@/lib/rta/posting/gate");
    post = await import("@/lib/rta/posting/post");
    // Migration 0236 installs posting HALTED; a development database releases it (two people).
    await (await import("@/lib/rta/posting/controls")).setPostingHalt({ scope: "global", halted: false, reason: "development test database: posting released", changedBy: randomUUID(), approvedBy: randomUUID() });
    await withSystem(async (tx) => {
      for (const [id, n] of [[tE, "E"], [tH, "H"], [tX, "X"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"VF " + n}, ${"VF " + n}, ${"ARN-VF" + n + id.slice(0, 6)})`);
      }
      // Firm H: a client with a folio and an existing CRM transaction.
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv.h}::uuid, ${tH}::uuid, ${P.adult}, 'Hist Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${tH}::uuid, ${inv.h}::uuid, '117', 'AMC 117', '92000001', 'kfintech')`);
      await tx.execute(sql`INSERT INTO transactions (tenant_id, investor_id, folio_number, amc_code, scheme_code, type, direction, amount, units, order_id, order_date, status)
        VALUES (${tH}::uuid, ${inv.h}::uuid, '92000001', '117', '117EQGR', 'sip', 'inflow', 1000, 20, '700001', '2026-04-15', 'processed'),
               (${tH}::uuid, ${inv.h}::uuid, '92000001', '117', '117EQGR', 'sip', 'inflow', 999, 20, '700002', '2026-04-15', 'processed')`);
      // Firm H: a minor (guardian's PAN on CAMS rows) and an HUF case on CAMS.
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv.guardian}::uuid, ${tH}::uuid, ${P.guardian}, 'Hist Guardian')`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, is_minor, investor_category, guardian_investor_id) VALUES (${inv.minor}::uuid, ${tH}::uuid, ${"MINOR:" + P.guardian + ":KID"}, 'Hist Minor', true, 'minor', ${inv.guardian}::uuid)`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${tH}::uuid, ${inv.minor}::uuid, 'H', 'AMC H', '5550009/11', 'cams')`);
      // Firm X: the same PAN / folio / numbers as firm H.
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv.x}::uuid, ${tX}::uuid, ${P.adult}, 'X Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES (${tX}::uuid, ${inv.x}::uuid, '117', 'AMC 117', '92000001', 'kfintech')`);
    });
  });

  afterAll(async () => {
    Object.assign(process.env, { RTA_POSTING_MODE: ENV.RTA_POSTING_MODE ?? "", RTA_POSTING_DATABASE: ENV.RTA_POSTING_DATABASE ?? "" });
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const t of [tE, tH, tX]) {
      for (const table of ["rta_posted_transactions", "rta_sip_registrations", "folio_holders", "sip_rejections", "events_outbox", "sips", "transactions", "rta_staging_lots", "rta_staging_checks", "rta_staging_rows"]) {
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
      await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    }
  });

  it("the gate fails closed: each missing condition refuses, and nothing is staged or posted", async () => {
    const before = await counts(tE);
    for (const [k, v] of [["RTA_POSTING_MODE", "production"], ["RTA_POSTING_MODE", ""], ["NODE_ENV", "production"], ["RTA_POSTING_DATABASE", ""], ["DATABASE_URL", "postgres://u:p@db.example.com:5432/mfd"], ["APP_ENV", "production"]] as const) {
      const env = process.env as Record<string, string | undefined>;
      const saved = env[k];
      env[k] = v;
      await expect(run(tE, mfsd201([sip("100001")]), "gate.csv")).rejects.toThrow(/RTA posting is disabled/);
      env[k] = saved;
      if (saved === undefined) delete env[k];
    }
    // The environment passes but the CONNECTED database is not the named one: refused inside the posting transaction.
    const saved = process.env.RTA_POSTING_DATABASE;
    const staged = await (await import("@/lib/rta/staging")).shadowImport({ tenantId: tE, fileName: "gate2.csv", fileRef: "t", buf: mfsd201([sip("100002")]), mode: "validate_first" } as any);
    process.env.RTA_POSTING_DATABASE = "some_other_database";
    await expect(post.postTransactionBatch(tE, staged.batchId)).rejects.toThrow(/connected database is not RTA_POSTING_DATABASE/);
    process.env.RTA_POSTING_DATABASE = saved;
    expect(await counts(tE)).toEqual(before);
    expect(gate.postingGateEnv({ ...process.env, RTA_POSTING_MODE: "development" }).allowed).toBe(true);
  });

  it("empty firm, transactions BEFORE the master: everything held (no client created); the master's arrival promotes them once; a re-import adds nothing", async () => {
    const file = mfsd201([sip("200001", { "Folio Number": "92100001" }), sip("200002", { "Folio Number": "92100001", "Transaction Date": "15/5/2026" })]);
    const first = await run(tE, file, "early.csv");
    expect(first.posting).toMatchObject({ state: "partially_posted", counts: { quarantined: 2 } });
    expect(await txns(tE)).toEqual([]);
    const master = await run(tE, m211([{ Folio: "92100001", "PAN Number": P.adult }]), "m211.csv");
    expect(master.posting).toMatchObject({ state: "posted" });
    // Phase 3G: the master's arrival re-evaluates what was held for its folio — no re-import needed.
    expect(master.reevaluation).toMatchObject({ examined: 2, promoted: 2 });
    const again = await run(tE, file, "early-again.csv");
    expect(again.posting).toMatchObject({ counts: { already_posted: 2 } });
    expect((await txns(tE)).map((t) => [t.order_id, t.status, Number(t.amount)])).toEqual([["200001", "processed", 1000], ["200002", "processed", 1000]]);
  });

  it("existing history: an identical CRM transaction is matched (not duplicated); a different one under the same number is quarantined, never overwritten", async () => {
    const r = await run(tH, mfsd201([sip("700001"), sip("700002"), sip("700003")]), "hist.csv");
    expect(r.posting).toMatchObject({ counts: { matched_existing: 1, quarantined: 1, posted: 1 } });
    const t = await txns(tH);
    expect(t.filter((x) => x.order_id === "700002").map((x) => Number(x.amount))).toEqual([999]); // unchanged
    expect(t.filter((x) => x.order_id.startsWith("7000"))).toHaveLength(3);
    const reason = await q(tH, sql`SELECT posting_reason FROM rta_staging_economic_txns WHERE tenant_id = ${tH}::uuid AND registrar_txn_no = '700002' ORDER BY created_at DESC LIMIT 1`);
    expect(reason[0].posting_reason).toMatch(/different transaction under this registrar number/);
  });

  it("a multi-lot redemption is ONE economic transaction; its lots are kept; refused instructions are rejected records; a correction is held", async () => {
    const r = await run(tH, mfsd201([
      lot("710001", "L1", "10.000"), lot("710001", "L2", "5.500", { STT: "" }), lot("710001", "L3", "2.250", { STT: "" }),
      refused("710002", "SIND"),
      refused("710003", "STPAD", { "Switch_Ref. No.": "SW1" }), refused("710004", "STPOD", { "Transaction Head": "R", "Switch_Ref. No.": "SW1" }),
      sip("710005", { "Transaction Date": "10/1/2025" }), sip("710005", { "Transaction Date": "10/1/2025", "Transaction Type": "SINR", "Transaction Head": "R", Units: "-20.000", Amount: "-1000.00" }),
      sip("710005", { "Transaction Date": "10/1/2025", "Folio Number": "92000077" }),
    ]), "mixed.csv");
    expect(r.posting).toMatchObject({ counts: { posted: 1, rejected_recorded: 3, correction_held: 1 } });
    const red = (await txns(tH)).find((t) => t.order_id === "710001")!;
    expect(red).toMatchObject({ type: "redemption", direction: "outflow", lots: "3" });
    expect(Number(red.units)).toBeCloseTo(17.75, 6);
    const lots = await q(tH, sql`SELECT count(*)::int AS n FROM rta_staging_lots l JOIN rta_posted_transactions p ON p.economic_txn_id = l.economic_txn_id WHERE p.tenant_id = ${tH}::uuid AND p.identity_key LIKE '%:710001'`);
    expect(lots[0].n).toBe(3);
    const rej = (await txns(tH)).filter((t) => ["710002", "710003", "710004"].includes(t.order_id));
    expect(rej.every((t) => t.status === "rejected" && Number(t.units) === 0)).toBe(true);
    const rejRows = await q(tH, sql`SELECT reason_category FROM sip_rejections WHERE tenant_id = ${tH}::uuid`);
    expect(rejRows).toHaveLength(1);
    expect(rejRows[0].reason_category).toBeTruthy(); // categorised like the legacy path
    expect((await txns(tH)).some((t) => t.order_id === "710005")).toBe(false);
    // Rejected never counts as business.
    const [biz] = await q(tH, sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tH}::uuid AND status IN ('processed','successful') AND order_id IN ('710002','710003','710004')`);
    expect(biz.n).toBe(0);
  });

  it("partial commit only where independence is proven: an unknown code in folio A does not stop folio B; an owner exception holds its folio", async () => {
    const r = await run(tH, mfsd201([
      sip("720001", { "Transaction Type": "XYZ" }),                 // unsupported, folio 92000001
      sip("720002"),                                                  // same folio: still independent of an unsupported code
      sip("720003", { "Folio Number": "92000001", "PAN1": P.adult2, "Transaction Date": "16/4/2026" }), // owner conflict on folio 92000001
    ]), "partial.csv");
    expect(r.posting).toMatchObject({ counts: { unsupported: 1, quarantined: 1, held_dependent: 1 } });
    const none = await run(tH, mfsd201([sip("720011", { "Transaction Type": "XYZ" }), sip("720012", { "Folio Number": "92000001" })]), "strict.csv", undefined, { partial: "none" });
    expect(none.posting).toMatchObject({ state: "blocked", counts: { unsupported: 1, blocked: 1 } });
    expect((await txns(tH)).some((t) => t.order_id === "720012")).toBe(false);
  });

  it("a crash after partial progress commits nothing; resuming the same import posts each transaction exactly once", async () => {
    const importId = await newImport(tH, "crash.csv");
    const file = mfsd201([sip("730001"), sip("730002"), sip("730003")]);
    const before = await counts(tH);
    await expect(run(tH, file, "crash.csv", importId, { failAfterWrites: 2 })).rejects.toThrow(/injected crash/);
    expect(await counts(tH)).toEqual(before);
    const resumed = await run(tH, file, "crash.csv", importId);
    expect(resumed).toMatchObject({ resumed: true, posting: { counts: { posted: 3 } } });
    const replay = await run(tH, file, "crash.csv", importId);
    expect(replay.posting).toMatchObject({ replayed: true });
    expect((await txns(tH)).filter((t) => t.order_id.startsWith("73000"))).toHaveLength(3);
  });

  it("same-file re-import, overlapping files and concurrent imports never duplicate", async () => {
    const a = mfsd201([sip("740001"), sip("740002")]);
    const b = mfsd201([sip("740002"), sip("740003")]); // overlaps a
    const [r1, r2, r3] = await Promise.all([run(tH, a, "a1.csv"), run(tH, a, "a2.csv"), run(tH, b, "b.csv")]);
    const all = [r1, r2, r3].map((r) => (r.posting as any).counts);
    const posted = all.reduce((s, c) => s + (c.posted ?? 0), 0);
    expect(posted).toBe(3);
    expect((await txns(tH)).filter((t) => t.order_id.startsWith("74000")).map((t) => t.order_id)).toEqual(["740001", "740002", "740003"]);
    const [ledger] = await q(tH, sql`SELECT count(*)::int AS n FROM rta_posted_transactions WHERE tenant_id = ${tH}::uuid AND identity_key LIKE '%:74000_'`);
    expect(ledger.n).toBe(3);
  });

  it("two firms import the same numbers concurrently: each gets its own records, neither sees the other's", async () => {
    const f = mfsd201([sip("750001"), sip("750002")]);
    await Promise.all([run(tH, f, "h.csv"), run(tX, f, "x.csv")]);
    const h = (await txns(tH)).filter((t) => t.order_id.startsWith("75000"));
    const x = (await txns(tX)).filter((t) => t.order_id.startsWith("75000"));
    expect(h.map((t) => t.inv)).toEqual([inv.h, inv.h]);
    expect(x.map((t) => t.inv)).toEqual([inv.x, inv.x]);
    expect((await q(tX, sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tH}::uuid`))[0].n).toBe(0);
  });

  it("CAMS: a minor's row with the guardian's PAN posts to the minor; an HUF row with an individual PAN and no folio on record is held", async () => {
    const r = await run(tH, camsR2([
      r2({ trxnno: "760001", folio_no: "5550009/11", pan: P.guardian, tax_status: "On Behalf Of Minor" }),
      r2({ trxnno: "760002", folio_no: "5559999/11", pan: P.adult2, tax_status: "HUF" }),
    ]), "r2.xls");
    expect(r.posting).toMatchObject({ counts: { posted: 1, quarantined: 1 } });
    const t = (await txns(tH)).filter((x) => x.order_id.startsWith("76000"));
    expect(t).toEqual([expect.objectContaining({ order_id: "760001", inv: inv.minor })]);
    expect(t.some((x) => x.inv === inv.guardian)).toBe(false);
  });

  it("every posted transaction carries its lineage back to the staged rows", async () => {
    const rows = await q(tH, sql`
      SELECT t.raw_feed_row->>'identityKey' AS key, p.identity_key AS ledger_key, e.id::text = t.raw_feed_row->>'economicTxnId' AS econ_ok,
             (SELECT count(*) FROM rta_staging_rows r WHERE r.economic_txn_id = e.id AND r.disposition = 'posted')::int AS rows_posted
        FROM transactions t JOIN rta_posted_transactions p ON p.transaction_id = t.id JOIN rta_staging_economic_txns e ON e.id = p.economic_txn_id
       WHERE t.tenant_id = ${tH}::uuid AND p.kind = 'posted_new'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.key === r.ledger_key && r.econ_ok && r.rows_posted >= 1)).toBe(true);
  });
  it("manual resolution: an ownership hold is posted once to the chosen client with an audit row; guardians, Kartas, other clients' folios and non-ownership holds are refused", async () => {
    const res = await import("@/lib/rta/posting/resolve");
    const actor = randomUUID();
    const econ = async (t: string, no: string) => (await q(t, sql`SELECT id::text AS id, posting_outcome, posting_reason FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND registrar_txn_no = ${no} ORDER BY created_at DESC LIMIT 1`))[0];
    const resolve = (t: string, no: string, investorId: string) => econ(t, no).then((e) => res.resolveHeldTransaction(t, e.id, { investorId, note: "verified against the client's application form", userId: actor }));

    // 1. A folio not on record: held, then resolved to the client a person chose.
    // The row names a PAN the firm has no client for: nothing is created.
    await run(tE, mfsd201([sip("770001", { "Folio Number": "92200001", PAN1: P.adult2 }), refused("770002", "SIND", { "Folio Number": "92200099" })]), "unresolved.csv");
    expect(await econ(tE, "770001")).toMatchObject({ posting_outcome: "quarantined", posting_reason: expect.stringMatching(/^owner_not_on_record/) });
    // A client holding a different PAN is refused; the person records the right client first.
    const [other] = await q(tE, sql`SELECT id::text AS id FROM investors WHERE tenant_id = ${tE}::uuid AND pan = ${P.adult}`);
    await expect(resolve(tE, "770001", other.id)).rejects.toThrow(/different PAN/);
    const client = { id: randomUUID() };
    await withTenant(tE, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${client.id}::uuid, ${tE}::uuid, ${P.adult2}, 'Second Adult')`));
    const before = await counts(tE);
    const { transactionId } = await resolve(tE, "770001", client.id);
    expect(await counts(tE)).toEqual({ ...before, tx: before.tx + 1, ledger: before.ledger + 1 });
    const [t] = await q(tE, sql`SELECT t.investor_id::text AS inv, t.status, t.raw_feed_row->>'resolvedBy' AS by, f.investor_id::text AS folio_owner
      FROM transactions t JOIN folios f ON f.id = t.folio_id WHERE t.id = ${transactionId}::uuid`);
    expect(t).toEqual({ inv: client.id, status: "processed", by: actor, folio_owner: client.id });
    const audit = await q(tE, sql`SELECT actor_user_id::text AS actor, reason, after->>'transactionId' AS txn FROM audit_log WHERE tenant_id = ${tE}::uuid AND action = 'rta.identity.resolve'`);
    expect(audit).toEqual([{ actor, reason: "verified against the client's application form", txn: transactionId }]);
    expect(await econ(tE, "770001")).toMatchObject({ posting_outcome: "posted", posting_reason: expect.stringMatching(/^manually resolved/) });
    // Never twice: resolving again, or re-importing the file, adds nothing.
    await expect(resolve(tE, "770001", client.id)).rejects.toThrow(/already posted/);
    const again = await run(tE, mfsd201([sip("770001", { "Folio Number": "92200001", PAN1: P.adult2 })]), "unresolved-again.csv");
    expect(again.posting).toMatchObject({ counts: { already_posted: 1 } });
    expect((await txns(tE)).filter((x) => x.order_id === "770001")).toHaveLength(1);
    // A refused instruction is never turned into an investment by choosing a client.
    await expect(resolve(tE, "770002", client.id)).rejects.toThrow(/refused instruction/);

    // 2. An HUF row: an individual (the Karta) is refused.
    await expect(resolve(tH, "760002", inv.h)).rejects.toThrow(/not an HUF — a Karta is never the owner/);
    // 3. A minor's row on a folio not on record: the guardian is refused; the minor is accepted.
    await run(tH, camsR2([r2({ trxnno: "760003", folio_no: "5550010/11", pan: P.guardian, tax_status: "On Behalf Of Minor" })]), "r2-minor.xls");
    expect((await econ(tH, "760003")).posting_outcome).toBe("quarantined");
    await expect(resolve(tH, "760003", inv.guardian)).rejects.toThrow(/guardian is never the owner/);
    await resolve(tH, "760003", inv.minor);
    expect((await txns(tH)).filter((x) => x.order_id === "760003").map((x) => x.inv)).toEqual([inv.minor]);
    // 4. A folio on record under a different client: nothing is reassigned.
    //    (Even when the chosen client does hold the PAN the registrar reports.)
    await expect(resolve(tH, "720003", inv.guardian)).rejects.toThrow(/different PAN/);
    const adult2 = randomUUID();
    await withTenant(tH, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${adult2}::uuid, ${tH}::uuid, ${P.adult2}, 'Hist Adult Two')`));
    await expect(resolve(tH, "720003", adult2)).rejects.toThrow(/under a different client/);
    expect((await txns(tH)).some((x) => x.order_id === "720003")).toBe(false);
    // 5. Not ownership questions: a conflicting CRM transaction, an unsupported code.
    await expect(resolve(tH, "700002", inv.h)).rejects.toThrow(/not an ownership question/);
    await expect(resolve(tH, "720001", inv.h)).rejects.toThrow(/not an ownership question/);
    // 6. The gate holds for resolutions too.
    const saved = process.env.RTA_POSTING_DATABASE;
    process.env.RTA_POSTING_DATABASE = "some_other_database";
    await expect(resolve(tH, "720002", inv.h)).rejects.toThrow(/connected database is not RTA_POSTING_DATABASE/);
    process.env.RTA_POSTING_DATABASE = saved;
  });
  it("joint holders: written to folio_holders as relationships (tokens and masks only), idempotent on re-import, closed-and-replaced on change; the folio is counted once", async () => {
    const holders = () => q(tE, sql`SELECT h.role, h.investor_id::text AS inv, h.holder_pan_masked AS mask, h.effective_to IS NULL AS current, h.holder_pan_token LIKE 'pt1:%' AS tokenised
      FROM folio_holders h JOIN folios f ON f.id = h.folio_id WHERE f.tenant_id = ${tE}::uuid AND f.folio_number = '92300001' ORDER BY h.created_at, h.role`);
    const [owner] = await q(tE, sql`SELECT id::text AS id FROM investors WHERE tenant_id = ${tE}::uuid AND pan = ${P.adult}`);
    const file = m211([{ Folio: "92300001", "PAN Number": P.adult, PAN2: P.adult2, "Joint Name 1": "Synthetic Joint" }]);
    expect((await run(tE, file, "joint.csv")).posting).toMatchObject({ state: "posted", holders: { opened: 2 } });
    const first = await holders();
    expect(first).toEqual([
      expect.objectContaining({ role: "first", inv: owner.id, current: true, tokenised: true, mask: "******" + P.adult.slice(-4) }),
      expect.objectContaining({ role: "second", inv: null, current: true, tokenised: true, mask: "******" + P.adult2.slice(-4) }),
    ]);
    // No PAN is stored in the holders table.
    const [raw] = await q(tE, sql`SELECT count(*)::int AS n FROM folio_holders WHERE tenant_id = ${tE}::uuid AND (holder_pan_token = ${P.adult} OR holder_pan_token = ${P.adult2} OR holder_pan_masked IN (${P.adult}, ${P.adult2}))`);
    expect(raw.n).toBe(0);
    // Same facts again: nothing opened or closed.
    expect((await run(tE, file, "joint-again.csv")).posting).toMatchObject({ holders: { opened: 0, closed: 0, unchanged: 2 } });
    expect(await holders()).toHaveLength(2);
    // The joint holder changes: the old row is closed (kept), a new one opened.
    expect((await run(tE, m211([{ Folio: "92300001", "PAN Number": P.adult, PAN2: P.guardian }]), "joint-changed.csv")).posting).toMatchObject({ holders: { opened: 1, closed: 1, unchanged: 1 } });
    const after = await holders();
    expect(after.filter((h) => h.current).map((h) => h.role).sort()).toEqual(["first", "second"]);
    expect(after.filter((h) => !h.current)).toHaveLength(1);
    // A holdings statement with no joint-holder columns (MFSD203) leaves the joint holder alone.
    const h203 = csvOf(MFSD203_HEADER, [{ "Product Code": "117EQGR", Fund: "117", "Folio Number": "92300001", "Fund Description": "Example Equity Fund - Growth", Balance: "10.000", "Agent Code": "ARN-990002", "Investor Name": "Synthetic Person", AUM: "500.00", NAV: "50.0000", "Report Date": "18/05/2026", PAN: P.adult }]);
    expect((await run(tE, h203, "h203.csv")).posting).toMatchObject({ holders: { opened: 0, closed: 0 } });
    expect((await holders()).filter((h) => h.current).map((h) => h.role).sort()).toEqual(["first", "second"]);
    // A newer master, then an OLDER one saying something else: the older never overrides.
    expect((await run(tE, m211([{ Folio: "92300001", "PAN Number": P.adult, PAN2: P.adult2, "Report Date": "18/6/2026" }]), "joint-june.csv")).posting).toMatchObject({ holders: { opened: 1, closed: 1 } });
    expect((await run(tE, m211([{ Folio: "92300001", "PAN Number": P.adult, PAN2: P.guardian, "Report Date": "18/4/2026" }]), "joint-april.csv")).posting).toMatchObject({ holders: { opened: 0, closed: 0, skippedOlder: 1 } });
    // One folio, one owner: the joint holder's own client (Second Adult) never gets this folio.
    const f = await q(tE, sql`SELECT investor_id::text AS inv FROM folios WHERE tenant_id = ${tE}::uuid AND folio_number = '92300001'`);
    expect(f).toEqual([{ inv: owner.id }]);
  });
  it("SIP book: only VERIFIED registrations on a folio on record reach sips; observed / unknown never do; a differing CRM SIP is left alone; a rejected instalment stops nothing; re-running adds nothing", async () => {
    const reg = (v: Record<string, string>) => ({
      Folio: "92100001", "Fund Code": "117", "Product Code": "117EQGR", RegistrationDate: "01/10/2026", "Start Date": "10/09/2026", "End Date": "10/09/2056",
      "No Of Installments": "360", Amount: "1000", Frequency: "Monthly", Trtype: "SIP", Status: "Live SIP", TerminateDate: "", ...v,
    });
    const [client] = await q(tE, sql`SELECT id::text AS id FROM investors WHERE tenant_id = ${tE}::uuid AND pan = ${P.adult}`);
    const [folio] = await q(tE, sql`SELECT id::text AS id FROM folios WHERE tenant_id = ${tE}::uuid AND folio_number = '92100001'`);
    // A CRM SIP the firm keyed by hand, same folio / scheme / amount / frequency as registration 880006, but stopped.
    await withTenant(tE, (tx) => tx.execute(sql`INSERT INTO sips (tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name, amount, frequency, start_date, status)
      VALUES (${tE}::uuid, ${client.id}::uuid, ${folio.id}::uuid, '92100001', '117', 'AMC 117', '117EQGR', 'Example', 3000, 'monthly', '2026-01-10', 'stopped')`));
    const r = await run(tE, csvOf(MFSD243_HEADER, [
      reg({ RegSlno: "880001" }),                                                     // live, started → active
      reg({ RegSlno: "880002", "Start Date": "10/11/2026", Amount: "1500" }),         // start ahead → pending
      reg({ RegSlno: "880003", Status: "Terminated", TerminateDate: "01/10/2026", Amount: "2000" }), // → stopped
      reg({ RegSlno: "880004", Status: "Under Review", Amount: "2500" }),             // a status this code does not read → unknown
      reg({ RegSlno: "880005", Folio: "92999999" }),                                  // folio not on record → no owner
      reg({ RegSlno: "880006", Amount: "3000" }),                                     // live, but the CRM holds it as stopped
    ]), "mfsd243.csv");
    expect(r.recordKind).toBe("registration");
    // The import row says what happened — never left "parsing".
    const [imp] = await q(tE, sql`SELECT i.status, i.rows_imported, i.remarks FROM rta_file_imports i JOIN rta_staging_batches b ON b.import_id = i.id WHERE b.id = ${r.batchId}::uuid`);
    expect(imp).toMatchObject({ status: "completed", rows_imported: 6, remarks: expect.stringMatching(/verified registration/) });
    // Instalments: a REJECTED one on 880001 and a processed one on a registration no report describes.
    await run(tE, mfsd201([
      refused("880101", "SIND", { "Folio Number": "92100001", sipregslno: "880001", "Transaction Date": "10/10/2026" }),
      sip("880102", { "Folio Number": "92100001", sipregslno: "889999", "Transaction Date": "01/10/2026" }),
    ]), "inst.csv");
    const regs = await q(tE, sql`SELECT registration_id AS id, state, confidence, sip_id IS NOT NULL AS posted FROM rta_sip_registrations WHERE tenant_id = ${tE}::uuid ORDER BY registration_key`);
    const by = Object.fromEntries(regs.map((x) => [x.id ?? "?", x]));
    expect(by["880001"]).toMatchObject({ state: "VERIFIED_ACTIVE", confidence: "verified", posted: true });
    const [ev] = await q(tE, sql`SELECT lifecycle_events FROM rta_sip_registrations WHERE tenant_id = ${tE}::uuid AND registration_id = '880001'`);
    expect(ev.lifecycle_events).toEqual([expect.objectContaining({ kind: "instalment_rejected", date: "2026-10-10" })]);
    expect(by["880002"]).toMatchObject({ state: "PENDING", posted: true });
    expect(by["880003"]).toMatchObject({ state: "STOPPED", posted: true });
    expect(by["880004"]).toMatchObject({ state: "UNKNOWN", posted: false });
    expect(by["880005"]).toMatchObject({ posted: false });
    expect(by["880006"]).toMatchObject({ state: "VERIFIED_ACTIVE", posted: false });
    expect(regs.find((x) => x.state === "OBSERVED_ACTIVITY")).toMatchObject({ posted: false });
    const sipsNow = await q(tE, sql`SELECT amount::int AS amount, status FROM sips WHERE tenant_id = ${tE}::uuid ORDER BY amount`);
    expect(sipsNow).toEqual([{ amount: 1000, status: "active" }, { amount: 1500, status: "pending" }, { amount: 2000, status: "stopped" }, { amount: 3000, status: "stopped" }]);
    // The SIP book cache counts only the verified active one.
    const [cache] = await q(tE, sql`SELECT active_sip_amount::int AS a FROM investors WHERE id = ${client.id}::uuid`);
    expect(cache.a).toBe(1000);
    // Completeness: the book is said to be partial, with the reasons, per registrar and ARN.
    const { getSipBookCompleteness } = await import("@/lib/metrics/sip-completeness");
    const cov = await withTenant(tE, (tx) => getSipBookCompleteness(tx, tE));
    expect(cov.complete).toBe(false);
    expect(cov.totals).toMatchObject({ verifiedActive: { count: 3, inBook: 1 }, pending: { count: 1, inBook: 1 } }); // verified by the registrar; only 1 has an owner and no CRM conflict, so the book shows 1
    expect(cov.totals.unknown).toBeGreaterThanOrEqual(1);
    expect(cov.totals.observed.count).toBeGreaterThanOrEqual(1);
    expect(cov.lastVerifiedStatus.kfintech).toBe("2026-10-01");
    expect(cov.reports).toEqual([expect.objectContaining({ report: "MFSD243", statesLifecycle: true, registeredTo: "2026-10-01" })]);
    expect(cov.reasons.join(" ")).toMatch(/no verified status/);
    // Re-running is idempotent.
    const { rebuildSipBook } = await import("@/lib/rta/posting/sip-book");
    const again = await rebuildSipBook(tE, { asOf: "2026-10-08" });
    expect(again.sips).toMatchObject({ created: 0, updated: 0 });
    expect((await q(tE, sql`SELECT count(*)::int AS n FROM sips WHERE tenant_id = ${tE}::uuid`))[0].n).toBe(4);
  });
});
