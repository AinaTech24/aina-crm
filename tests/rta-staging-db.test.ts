/**
 * RTA staging (Phase 3B, SHADOW) against a real Postgres with RLS on.
 *
 * Needs TEST_DATABASE_URL pointing at a migrated database (0233 included)
 * through a NON-superuser role; skipped otherwise. Files are built in the REAL
 * column layouts (tests/rta-real-layouts.ts) with synthetic people and money.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { MFSD201_HEADER, MFSD211_HEADER, R2_HEADER, R9_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

// ── Fixtures ────────────────────────────────────────────────────────────────
const kfin = (v: Record<string, string>) => ({
  "Fund": "117", "Folio Number": "91000001", "Product Code": "117EQGR", "Scheme Code": "EQ", "Transaction Head": "R",
  "Transaction Description": "Redemption", "Transaction Type": "RED", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Process Date": "15/4/2026", "Nav Date": "15/4/2026", "Nav": "50.0000", "Load Percentage": "1", "PAN1": P.adult, ...v,
});
const lot = (txn: string, lotId: string, units: string, extra: Record<string, string> = {}) => {
  const u = Number(units), gross = u * 50, load = Math.round(gross * 0.01 * 100) / 100;
  return kfin({
    "Transaction Number": txn, "Transaction ID": lotId, "Purchase Transaction No": `P${lotId}`, "Purchase Date": "2/1/2025",
    "Purchase Units": units, "Purchase Amount": (u * 40).toFixed(2), "Units": units, "Price": "49.5000",
    "Load Amount": load.toFixed(2), "Amount": (gross - load).toFixed(2), ...extra,
  });
};
const sip = (txn: string, amount = "1000.00", extra: Record<string, string> = {}) => kfin({
  "Transaction Number": txn, "Transaction Head": "P", "Transaction Type": "SIN", "Transaction Description": "Systematic Investment",
  "Units": (Number(amount) / 50).toFixed(3), "Amount": amount, "Load Percentage": "", "Price": "50.0000", ...extra,
});
const mfsd201 = (rows: Record<string, string>[]) => csvOf(MFSD201_HEADER, rows);

const r2 = (v: Record<string, string | number>) => ({
  amc_code: "H", folio_no: "5550001/11", prodcode: "HFC", trxnno: "900001", traddate: serial("2026-05-02"), units: "20.0000",
  amount: "1000.00", purprice: "50.0000", trxn_type_flag: "Additional Purchase Systematic", trxn_nature: "Systematic-NSE - Instalment No - 4/60",
  trxntype: "P1S", trxnstat: "Y", pan: P.adult2, siptrxnno: "", ...v,
});
const camsR2 = (rows: Record<string, string | number>[]) => xlsOf(R2_HEADER, rows, ["traddate"]);
const camsR9 = (rows: Record<string, string | number>[]) => xlsOf(R9_HEADER, rows, ["rep_date"]);
const kfinMaster = (rows: Record<string, string>[]) => csvOf(MFSD211_HEADER, rows);

describe.skipIf(!TEST_DB)("RTA staging — shadow pipeline (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let staging: typeof import("@/lib/rta/staging");
  let pipeline: typeof import("@/lib/rta/staging/pipeline");

  const tA = randomUUID();
  const tB = randomUUID();
  const tC = randomUUID();
  const inv = { adult: randomUUID(), adult2: randomUUID() };

  const q = async <T = any>(tenantId: string, query: ReturnType<typeof import("drizzle-orm").sql>) =>
    withTenant(tenantId, async (tx) => (await tx.execute(query)).rows as T[]);
  const stage = (tenantId: string, buf: Buffer, name = "file.csv", extra: Partial<Parameters<typeof staging.shadowImport>[0]> = {}) =>
    staging.shadowImport({ tenantId, fileName: name, fileRef: `test:${name}`, buf, ...extra });
  const econ = (tenantId: string, batchId: string) =>
    q(tenantId, sql`SELECT identity_key, status, rta_class, row_count, lot_count, reported_units::text AS units, reported_amount::text AS amount, reason, proposed_action, duplicate_of_id FROM rta_staging_economic_txns WHERE batch_id = ${batchId}::uuid ORDER BY identity_key`);
  const rowStates = async (tenantId: string, batchId: string) =>
    Object.fromEntries((await q(tenantId, sql`SELECT state, count(*)::int AS n FROM rta_staging_rows WHERE batch_id = ${batchId}::uuid GROUP BY 1`)).map((r) => [r.state, r.n]));

  /** Every live table the importer could touch, for one tenant, as count + content hash. */
  const FIN = ["investors", "folios", "transactions", "sips", "mandates", "sip_rejections", "families", "rta_file_imports", "audit_log", "business_entries", "expected_inflows", "tasks"];
  const fingerprint = (tenantId: string) =>
    withSystem(async (tx) => {
      const out: Record<string, string> = {};
      for (const t of FIN) {
        const r = (await tx.execute(sql.raw(`SELECT count(*)::int AS n, coalesce(md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))), '') AS h FROM "${t}" x WHERE tenant_id = '${tenantId}'`))).rows[0] as any;
        out[t] = `${r.n}:${r.h}`;
      }
      return out;
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    staging = await import("@/lib/rta/staging");
    pipeline = await import("@/lib/rta/staging/pipeline");
    await withSystem(async (tx) => {
      for (const [id, n] of [[tA, "A"], [tB, "B"], [tC, "C"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"Staging Test " + n}, ${"Staging Test " + n}, ${"ARN-ST" + n + id.slice(0, 6)})`);
      }
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv.adult}::uuid, ${tA}::uuid, ${P.adult}, ${"Test Adult"})`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number) VALUES (${tA}::uuid, ${inv.adult}::uuid, '117', 'Test AMC', '91000001')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => {
      try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ }
    };
    for (const t of [tA, tB, tC]) {
      await tryRun(sql`DELETE FROM rta_staging_lots WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_checks WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_rows WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`UPDATE rta_staging_economic_txns SET duplicate_of_id = NULL WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`UPDATE rta_staging_batches SET rerun_of_batch_id = NULL, same_file_as_batch_id = NULL WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM rta_staging_batches WHERE tenant_id = ${t}::uuid`);
      for (const table of ["transactions", "folios"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
      await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    }
  });

  it("stages all four real layouts with every row accounted for (test 1)", async () => {
    const files: Array<[string, Buffer, number]> = [
      ["MFSD201.csv", mfsd201([sip("6001"), lot("6002", "L1", "10.000")]), 2],
      ["R2.xls", camsR2([r2({ trxnno: "910001" }), r2({ trxnno: "910002", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase" })]), 2],
      ["R9.xls", camsR9([{ foliochk: "5550001/11", product: "HFC", amc_code: "H", rep_date: serial("2026-05-18"), clos_bal: "20.000", rupee_bal: "1000.00", pan_no: P.adult2 }, { foliochk: "5550002/11", product: "HFC", amc_code: "H", rep_date: serial("2026-05-18"), clos_bal: "0", rupee_bal: "0", pan_no: P.adult2 }]), 2],
      ["MFSD211.csv", kfinMaster([{ "Fund": "117", "Folio": "91000001", "Product Code": "117EQGR", "PAN Number": P.adult, "Report Date": "18/5/2026", "Investor Name": "Synthetic Person" }]), 1],
    ];
    for (const [name, buf, n] of files) {
      const r = await stage(tC, buf, name);
      expect(r.state, name).toBe("ready_to_commit");
      const report = await staging.loadBatchReport(tC, r.batchId);
      expect(report!.batch.rowCount, name).toBe(n);
      const accounted = report!.checks.find((c) => c.code === "rows.accounted")!;
      expect(accounted.status, name).toBe("pass");
      expect(report!.checks.filter((c) => c.scope === "batch" && c.status === "fail"), name).toEqual([]);
    }
    // Names never reach staging; only tokens do.
    const leaked = await q(tC, sql`SELECT count(*)::int AS n FROM rta_staging_rows r WHERE r::text LIKE '%Synthetic Person%' OR r::text LIKE ${"%" + P.adult + "%"} OR r::text LIKE ${"%" + P.adult2 + "%"}`);
    expect(leaked[0].n).toBe(0);
  });

  it("KFintech multi-lot redemptions: one economic transaction per group, every lot its own row (tests 2–3)", async () => {
    const r = await stage(tA, mfsd201([
      lot("7001", "L1", "100.000"), lot("7001", "L2", "20.000"), lot("7001", "L2", "5.000", { "Load Amount": "0.00", "Price": "50.0000", "Amount": "250.00" }), lot("7001", "L3", "1.000", { STT: "0.05" }),
      sip("7002"),
      lot("7003", "L7", "4.000"), lot("7003", "L8", "6.000", { STT: "0.01" }),
    ]), "groups.csv");
    expect(r.state).toBe("ready_to_commit");
    const e = await econ(tA, r.batchId);
    expect(e.map((x) => [x.identity_key, x.status, x.rta_class, x.row_count, x.lot_count, x.units, x.amount])).toEqual([
      ["kfin.v1:117:7001", "complete", "redemption", 4, 4, "126.000", "6239.50"],
      ["kfin.v1:117:7002", "complete", "sip_investment", 1, 0, "20.000", "1000.00"],
      ["kfin.v1:117:7003", "complete", "redemption", 2, 2, "10.000", "495.00"],
    ]);
    expect(await rowStates(tA, r.batchId)).toEqual({ staged_as_part: 6, staged: 1 });
    const lots = await q(tA, sql`SELECT l.registrar_lot_id, l.lot_part, r.row_no FROM rta_staging_lots l JOIN rta_staging_rows r ON r.id = l.row_id WHERE r.batch_id = ${r.batchId}::uuid ORDER BY r.row_no`);
    expect(lots.map((l) => [l.registrar_lot_id, l.lot_part, l.row_no])).toEqual([["L1", 1, 1], ["L2", 1, 2], ["L2", 2, 3], ["L3", 1, 4], ["L7", 1, 6], ["L8", 1, 7]]);
    // matched read-only to the folio's client
    expect((await q(tA, sql`SELECT DISTINCT match_rule FROM rta_staging_rows WHERE batch_id = ${r.batchId}::uuid`)).map((x) => x.match_rule)).toEqual(["existing_folio_owner:folio+owner_pan"]);
    expect(e.every((x) => x.proposed_action === "post_new")).toBe(true);
  });

  it("re-running a finished batch is a no-op; the same file as a new batch is all duplicates, history kept (test 6)", async () => {
    const buf = mfsd201([lot("7101", "L1", "2.000"), lot("7101", "L2", "3.000"), sip("7102")]);
    const first = await stage(tA, buf, "same.csv");
    const again = await pipeline.runShadowBatch(tA, first.batchId, buf);
    expect(again.state).toBe("ready_to_commit");
    expect((await q(tA, sql`SELECT attempt, row_count FROM rta_staging_batches WHERE id = ${first.batchId}::uuid`))[0]).toEqual({ attempt: 1, row_count: 3 });
    const second = await stage(tA, buf, "same.csv");
    const b2 = (await q(tA, sql`SELECT same_file_as_batch_id FROM rta_staging_batches WHERE id = ${second.batchId}::uuid`))[0];
    expect(b2.same_file_as_batch_id).toBe(first.batchId);
    expect((await econ(tA, second.batchId)).map((x) => x.status)).toEqual(["duplicate", "duplicate"]);
    expect(await rowStates(tA, second.batchId)).toEqual({ duplicate: 3 });
    expect((await econ(tA, first.batchId)).map((x) => x.status)).toEqual(["complete", "complete"]); // first batch untouched
  });

  it("overlapping report periods: transactions already staged are duplicates, new ones complete (test 7)", async () => {
    await stage(tA, mfsd201([sip("7201"), sip("7202")]), "week1.csv");
    const w2 = await stage(tA, mfsd201([sip("7202"), sip("7203")]), "week2.csv");
    expect((await econ(tA, w2.batchId)).map((x) => [x.identity_key.split(":")[2], x.status])).toEqual([["7202", "duplicate"], ["7203", "complete"]]);
  });

  it("a corrected report is held as restated (lots changed) or conflict (identity changed) — never merged (test 10)", async () => {
    await stage(tA, mfsd201([lot("7301", "L1", "10.000"), lot("7301", "L2", "20.000"), lot("7301", "L3", "30.000", { STT: "0.10" })]), "orig.csv");
    const missingLot = await stage(tA, mfsd201([lot("7301", "L1", "10.000"), lot("7301", "L3", "30.000", { STT: "0.10" })]), "partial.csv");
    const [restated] = await econ(tA, missingLot.batchId);
    expect(restated).toMatchObject({ status: "restated", proposed_action: "none" });
    expect(restated.reason).toMatch(/^restated_by_registrar/);
    expect(await rowStates(tA, missingLot.batchId)).toEqual({ quarantined: 2 });
    const otherFolio = await stage(tA, mfsd201([lot("7301", "L1", "10.000", { "Folio Number": "91000099" })]), "clash.csv");
    expect((await econ(tA, otherFolio.batchId))[0]).toMatchObject({ status: "conflict" });
  });

  it("invalid and unsupported source data is held with a reason; an unknown layout stages nothing (test 9)", async () => {
    const r = await stage(tA, mfsd201([sip("7401", "abc"), sip("7402", "100.00", { "Transaction Type": "XYZ" }), sip("7403", "100.00", { "Transaction Type": "SIND", "Transaction Description": "Systematic Investment Pre-Rejection", Units: "0.000", Remarks: "Primary KYC Invalid ref 4455" }), sip("7404")]), "bad.csv");
    expect(r.state).toBe("ready_to_commit");
    const rows = await q(tA, sql`SELECT row_no, state, exception_code, amount::text AS amount, reason FROM rta_staging_rows WHERE batch_id = ${r.batchId}::uuid ORDER BY row_no`);
    expect(rows.map((x) => [x.row_no, x.state, x.exception_code, x.amount])).toEqual([
      [1, "invalid", "row_invalid", null],
      [2, "quarantined", "unknown_transaction_code", "100.00"],
      [3, "quarantined", "instalment_rejected", "100.00"],
      [4, "staged", null, "1000.00"],
    ]);
    expect(rows[0].reason).toMatch(/amount/);
    // A failed instalment keeps the registrar's reason, minimised.
    const failed = (await q(tA, sql`SELECT attrs FROM rta_staging_rows WHERE batch_id = ${r.batchId}::uuid AND row_no = 3`))[0];
    expect(failed.attrs.rejectionReason).toBe("Primary KYC Invalid ref #");
    const unknown = await stage(tA, Buffer.from("A,B,C\n1,2,3\n"), "mystery.csv");
    expect(unknown.state).toBe("exception");
    expect((await q(tA, sql`SELECT count(*)::int AS n FROM rta_staging_rows WHERE batch_id = ${unknown.batchId}::uuid`))[0].n).toBe(0);
  });

  it("transactions before masters: unmatched, nothing created; a re-run after the master is re-matched (test 8)", async () => {
    const fp0 = await fingerprint(tB);
    const buf = camsR2([r2({ trxnno: "920001" }), r2({ trxnno: "920002", trxn_type_flag: "Partial Switch Out", trxn_nature: "Systematic - To Flexi Cap - Instalment No - 3", siptrxnno: "S1", units: "-20.0000" })]);
    const first = await stage(tB, buf, "r2.xls");
    expect((await econ(tB, first.batchId)).map((x) => x.proposed_action)).toEqual(["unmatched", "unmatched"]);
    expect(await fingerprint(tB)).toEqual(fp0); // nothing created by staging
    // The master arrives (simulated: the existing importer's job, not staging's).
    const id = randomUUID();
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${id}::uuid, ${tB}::uuid, ${P.adult2}, ${"Test Adult Two"})`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number) VALUES (${tB}::uuid, ${id}::uuid, 'H', 'Test AMC', '5550001/11')`);
    });
    const fp1 = await fingerprint(tB);
    const rerunId = await pipeline.createShadowBatch({ tenantId: tB, fileName: "r2.xls", fileRef: "test:r2:rerun", buf, rerunOfBatchId: first.batchId });
    await pipeline.runShadowBatch(tB, rerunId, buf);
    const e = await econ(tB, rerunId);
    expect(e.map((x) => [x.status, x.proposed_action, x.rta_class])).toEqual([["complete", "post_new", "sip_investment"], ["complete", "post_new", "stp_out"]]);
    expect(await fingerprint(tB)).toEqual(fp1);
  });

  it("a failure inside a stage rolls that stage back; the next attempt resumes and finishes (test 11)", async () => {
    const buf = mfsd201([lot("7501", "L1", "1.000"), lot("7501", "L2", "2.000"), sip("7502")]);
    const batchId = await pipeline.createShadowBatch({ tenantId: tA, fileName: "retry.csv", fileRef: "test:retry", buf });
    await expect(pipeline.runShadowBatch(tA, batchId, buf, { failInsideStage: "reconcile" })).rejects.toThrow(/injected/);
    const mid = (await q(tA, sql`SELECT state, attempt, stage_log FROM rta_staging_batches WHERE id = ${batchId}::uuid`))[0];
    expect(mid.state).toBe("failed");
    expect(mid.stage_log.map((s: any) => s.stage)).toEqual(["identify", "parse", "match", "failed"]);
    expect((await econ(tA, batchId)).length).toBe(0); // the failed stage left nothing behind
    expect(await rowStates(tA, batchId)).toEqual({ matched: 3 }); // earlier stages kept
    const done = await pipeline.runShadowBatch(tA, batchId, buf);
    expect(done.state).toBe("ready_to_commit");
    const end = (await q(tA, sql`SELECT attempt, row_count FROM rta_staging_batches WHERE id = ${batchId}::uuid`))[0];
    expect(end).toEqual({ attempt: 2, row_count: 3 });
    expect((await q(tA, sql`SELECT count(*)::int AS n FROM rta_staging_rows WHERE batch_id = ${batchId}::uuid`))[0].n).toBe(3); // no duplicate rows
    expect((await econ(tA, batchId)).map((x) => x.status)).toEqual(["complete", "complete"]);
    // A different file can never finish this batch.
    const other = await pipeline.createShadowBatch({ tenantId: tA, fileName: "x.csv", fileRef: "test:x", buf });
    await expect(pipeline.runShadowBatch(tA, other, mfsd201([sip("7999")]))).rejects.toThrow(/checksum/);
  });

  it("concurrent imports of the same file: exactly one is first, the other all duplicates", async () => {
    const buf = mfsd201([lot("7601", "L1", "1.000"), lot("7601", "L2", "1.000"), sip("7602"), sip("7603")]);
    const [a, b] = await Promise.all([stage(tA, buf, "c1.csv"), stage(tA, buf, "c2.csv")]);
    const statuses = [(await econ(tA, a.batchId)).map((x) => x.status), (await econ(tA, b.batchId)).map((x) => x.status)].map((s) => [...new Set(s)].join());
    expect(statuses.sort()).toEqual(["complete", "duplicate"]);
  });

  it("CAMS switch vs STP lands in staging as classified (test 14)", async () => {
    const r = await stage(tC, camsR2([
      r2({ trxnno: "930001", trxn_type_flag: "Switch In", trxn_nature: "Systematic - From Liquid Fund - Instalment No - 2/12", siptrxnno: "S9", trxntype: "SI1" }),
      r2({ trxnno: "930002", trxn_type_flag: "Switch In", trxn_nature: "Switch In - From Liquid Fund", siptrxnno: "", trxntype: "SI1" }),
      r2({ trxnno: "930003", trxn_type_flag: "Partial Switch Out", trxn_nature: "Systematic - To X", siptrxnno: "", trxntype: "SO1", units: "-1.0000" }),
    ]), "switch.xls");
    const rows = await q(tC, sql`SELECT registrar_txn_no, rta_class, class_confidence, state, exception_code FROM rta_staging_rows WHERE batch_id = ${r.batchId}::uuid ORDER BY row_no`);
    expect(rows.map((x) => [x.registrar_txn_no, x.rta_class, x.class_confidence, x.state, x.exception_code])).toEqual([
      ["930001", "stp_in", "verified", "staged", null],
      ["930002", "switch_in", "inferred", "staged", null],
      ["930003", "unknown", "inferred", "quarantined", "switch_stp_ambiguous"],
    ]);
  });

  it("a reconciliation discrepancy holds the transaction and records a failing check, without touching the figures (test 15)", async () => {
    const bad = lot("7701", "L2", "20.000", { "Amount": "990.50" });
    const r = await stage(tA, mfsd201([lot("7701", "L1", "100.000"), bad]), "discrepancy.csv");
    expect(r.state).toBe("ready_to_commit"); // a data finding does not stop the batch
    const [e] = await econ(tA, r.batchId);
    expect(e).toMatchObject({ status: "quarantined", amount: "5940.50", proposed_action: "none" });
    expect(e.reason).toMatch(/^lot_arithmetic/);
    const checks = await q(tA, sql`SELECT check_code, status FROM rta_staging_checks WHERE batch_id = ${r.batchId}::uuid AND scope = 'econ' ORDER BY check_code`);
    expect(checks).toEqual([{ check_code: "econ.group_arithmetic", status: "fail" }, { check_code: "econ.lot_arithmetic", status: "fail" }]);
    const unverified = await q(tA, sql`SELECT check_code FROM rta_staging_checks WHERE batch_id = ${r.batchId}::uuid AND status = 'unverified' ORDER BY 1`);
    expect(unverified.map((c) => c.check_code)).toEqual(["class.transfer_leg_pairing", "econ.group_completeness", "econ.lot_purchase_history", "econ.payout_semantics"]);
  });

  it("shadow mode changes no live table — before/after fingerprints are identical (test 13)", async () => {
    const before = await fingerprint(tA);
    await stage(tA, mfsd201([lot("7801", "L1", "1.000"), lot("7801", "L2", "1.000"), sip("7802")]), "zero.csv");
    await stage(tA, camsR2([r2({ trxnno: "940001", folio_no: "91000001", amc_code: "117", pan: P.adult })]), "zero.xls");
    expect(await fingerprint(tA)).toEqual(before);
  });

  it("tenant isolation: another firm sees nothing and cannot point at it, even bypassing RLS (test 12)", async () => {
    const r = await stage(tA, mfsd201([sip("7901")]), "iso.csv");
    for (const t of ["rta_staging_batches", "rta_staging_rows", "rta_staging_economic_txns", "rta_staging_checks", "rta_staging_lots"]) {
      const n = await q(tB, sql.raw(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = '${tA}'`));
      expect(n[0].n, t).toBe(0);
    }
    expect(await staging.loadBatchReport(tB, r.batchId)).toBeNull();
    // A row in firm B that names firm A's batch: refused by the composite key, even in system context.
    await expect(withSystem((tx) => tx.execute(sql`
      INSERT INTO rta_staging_rows (tenant_id, batch_id, row_no, row_hash, record_kind, state)
      VALUES (${tB}::uuid, ${r.batchId}::uuid, 1, 'x', 'transaction', 'parsed')`))).rejects.toThrow();
    // And firm B cannot write a row under firm A's id (RLS WITH CHECK).
    await expect(withTenant(tB, (tx) => tx.execute(sql`
      INSERT INTO rta_staging_rows (tenant_id, batch_id, row_no, row_hash, record_kind, state)
      VALUES (${tA}::uuid, ${r.batchId}::uuid, 99, 'x', 'transaction', 'parsed')`))).rejects.toThrow();
  });

  it("the staging API is read-only and behind the RTA import access rule (test 12)", () => {
    for (const f of ["src/app/api/rta-staging/batches/route.ts", "src/app/api/rta-staging/batches/[id]/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/(assert|require)RtaImportAccess/);
      expect(src, f).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    }
  });

  it("the worker hook does nothing unless RTA_PIPELINE_MODE=shadow, and never throws", async () => {
    const saved = process.env.RTA_PIPELINE_MODE;
    try {
      delete process.env.RTA_PIPELINE_MODE;
      expect(await staging.runShadowForImport({ tenantId: tA, importId: null, fileName: "f.csv", fileRef: "t", buf: mfsd201([sip("8001")]) })).toEqual({ ran: false, refused: undefined });
      process.env.RTA_PIPELINE_MODE = "on";
      expect((await staging.runShadowForImport({ tenantId: tA, importId: null, fileName: "f.csv", fileRef: "t", buf: mfsd201([sip("8001")]) })).ran).toBe(false);
      process.env.RTA_PIPELINE_MODE = "shadow";
      const bad = await staging.runShadowForImport({ tenantId: randomUUID(), importId: null, fileName: "f.csv", fileRef: "t", buf: mfsd201([sip("8001")]) });
      expect(bad.ran).toBe(true);
      expect(bad.error).toBeTruthy(); // unknown tenant → recorded, not thrown
    } finally {
      if (saved === undefined) delete process.env.RTA_PIPELINE_MODE; else process.env.RTA_PIPELINE_MODE = saved;
    }
  });
});
