/**
 * Phase 2B regressions on the REAL column layouts of KFintech MFSD201 /
 * MFSD211 and CAMS R2 / R9 (tests/rta-real-layouts.ts), with synthetic data.
 * Each case reproduces a relationship the real files showed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, MFSD211_HEADER, R2_HEADER, R9_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";
import { decodeRtaToText } from "@/lib/rta/decode";
import { readSpreadsheetToRows } from "@/lib/rta/xls";
import { decodeTextBytes } from "@/lib/rta/file-kind";
import { parseRtaRows, parseRtaCsv } from "@/lib/rta";
import { parseReverseFeed } from "@/lib/integrations/cams-feed-parser";

// ── KFintech MFSD201 ──────────────────────────────────────────────────────
const k201 = (o: Record<string, string | number>) => ({
  "Product Code": "X01G", Fund: "X01", "Folio Number": "91000001", "Fund Description": "Example Fund - Growth",
  "Transaction Head": "P", "Transaction Number": "500001", "Transaction Status": "Y", "Transaction Date": "15/04/2026",
  "Nav Date": "15/04/2026", Price: "50.1234", Nav: "50.1234", Units: "19.951", Amount: "1000.00",
  "Transaction Sub": "N", "Transaction Description": "Systematic Investment", "Transaction Type": "SIN",
  PAN1: P.adult, "Investor Name": "TEST ADULT ONE", "Transaction ID": "1", NewUnqno: "1", Ihno: "70001",
  ...o,
});
const kfinText = (rows: Record<string, string | number>[]) => {
  const buf = csvOf(MFSD201_HEADER, rows);
  return decodeRtaToText(buf, "MFSD201_SYNTH.csv");
};

describe("MFSD201 layout (KFintech transactions)", () => {
  it("has the real 87-column header and maps the right columns", () => {
    expect(MFSD201_HEADER).toHaveLength(87);
    const { rows } = parseReverseFeed(kfinText([k201({})]));
    expect(rows[0]).toMatchObject({ externalRef: "500001", folioNumber: "91000001", schemeCode: "X01G", orderDate: "2026-04-15", amount: 1000, units: 19.951, type: "sip", direction: "inflow" });
  });

  it("a redemption reported lot by lot under one number is held back as ONE transaction in parts", () => {
    const lot = (n: number, units: string, amount: string, price: string) =>
      k201({ "Transaction Head": "R", "Transaction Number": "600001", "Transaction Description": "Redemption", "Transaction Type": "FUL",
        Units: units, Amount: amount, Price: price, Nav: "60.0000", "Purchase Transaction No": `PT${n}`, "Purchase Units": units, "Transaction ID": String(n) });
    const { rows, rejects } = parseReverseFeed(kfinText([lot(1, "10.000", "600.00", "40.0000"), lot(2, "5.000", "300.00", "45.0000"), lot(3, "5.000", "300.00", "45.0000"), k201({ "Transaction Number": "600002" })]));
    expect(rows.map((r) => r.externalRef)).toEqual(["600002"]);
    expect(rejects).toHaveLength(3);
    expect(rejects[0].reason).toMatch(/ONE transaction reported in parts/);
  });

  it("NAV is the Nav column, not Price (they differ on lot rows)", () => {
    const { rows } = parseReverseFeed(kfinText([k201({ "Transaction Head": "R", "Transaction Description": "Redemption", "Transaction Type": "RED", Price: "41.0000", Nav: "60.0000", Units: "10.000", Amount: "600.00" })]));
    expect(rows[0]).toMatchObject({ nav: 60, direction: "outflow", type: "redemption" });
  });

  it("letter-spaced 'S T P In' / 'S T P Out' are STP legs; 'Pre rejection' is held back", () => {
    const { rows, rejects } = parseReverseFeed(kfinText([
      k201({ "Transaction Number": "700001", "Transaction Description": "S T P In", "Transaction Type": "STPA", "Transaction Flag": "SI" }),
      k201({ "Transaction Number": "700002", "Transaction Head": "R", "Transaction Description": "S T P Out", "Transaction Type": "STPO", "Transaction Flag": "SO" }),
      k201({ "Transaction Number": "700003", "Transaction Description": "S T P In Pre rejection", "Transaction Type": "STPAD" }),
    ]));
    expect(rows.map((r) => [r.externalRef, r.type, r.direction])).toEqual([["700001", "stp", "inflow"], ["700002", "stp", "outflow"]]);
    expect(rejects[0].reason).toMatch(/reversal \/ rejection \/ cancellation/);
  });
});

// ── CAMS R2 ───────────────────────────────────────────────────────────────
const r2 = (o: Record<string, string | number>) => ({
  amc_code: "X", folio_no: "81000001", prodcode: "X1G", scheme: "Example Equity Fund - Growth", inv_name: "TEST ADULT ONE",
  trxntype: "P1S", trxnno: "1000001", trxnstat: "Y", traddate: serial("2026-04-15"), postdate: serial("2026-04-15"),
  purprice: 50.1234, units: 19.951, amount: 1000, trxnsubtyp: "N", trxn_nature: "Systematic-NSE - Instalment No - 3/120",
  trxn_type_flag: "Additional Purchase Systematic", pan: P.adult, swflag: "NA",
  ...o,
});
const camsText = (rows: Record<string, string | number>[]) => decodeRtaToText(xlsOf(R2_HEADER, rows, ["traddate", "postdate"]), "SYNTH_R2.xls");

describe("CAMS R2 layout (transactions, .xls)", () => {
  it("has the real 80-column header; dates come from serial cells", () => {
    expect(R2_HEADER).toHaveLength(80);
    const { rows } = parseReverseFeed(camsText([r2({})]));
    expect(rows[0]).toMatchObject({ externalRef: "1000001", orderDate: "2026-04-15", type: "sip", direction: "inflow", amount: 1000, units: 19.951, nav: 50.1234 });
  });

  it("trxn_type_flag decides: a systematic 'Partial Switch Out' is STP money OUT (it used to be booked as a SIP inflow)", () => {
    const { rows } = parseReverseFeed(camsText([
      r2({ trxnno: "2", trxntype: "SO1", trxn_type_flag: "Partial Switch Out", trxn_nature: "Systematic - To Example Mid Cap Fund-Growth-NSE - Instalment No - 4" }),
      r2({ trxnno: "3", trxntype: "SI55AS", trxn_type_flag: "Switch In", swflag: "INTER", trxn_nature: "Systematic - From Example Liquid Fund-Growth-NSE - Instalment No - 4/12" }),
      r2({ trxnno: "4", trxntype: "R1", trxn_type_flag: "Full Redemption", trxn_nature: "Redemption" }),
      r2({ trxnno: "5", trxntype: "R10", trxn_type_flag: "Partial Redemption", trxn_nature: "Systematic Systematic withdrawal - Instalment 2/24" }),
      r2({ trxnno: "6", trxntype: "PC1", trxn_type_flag: "Fresh Purchase", trxn_nature: "Fresh Purchase" }),
      r2({ trxnno: "7", trxntype: "PMF1S", trxn_type_flag: "Additional Purchase Systematic", trxn_nature: "Systematic-NSE -" }),
    ]));
    expect(rows.map((r) => [r.externalRef, r.type, r.direction])).toEqual([
      ["2", "stp", "outflow"], ["3", "stp", "inflow"], ["4", "redemption", "outflow"], ["5", "swp", "outflow"], ["6", "lumpsum", "inflow"], ["7", "sip", "inflow"],
    ]);
  });

  it("an unseen flag falls back to the description rules, and an unknown one is held back", () => {
    const { rows, rejects } = parseReverseFeed(camsText([r2({ trxnno: "8", trxntype: "ZZ", trxn_type_flag: "Something New", trxn_nature: "Unheard of" })]));
    expect(rows).toHaveLength(0);
    expect(rejects[0].reason).toMatch(/not one this importer recognises/);
  });
});

// ── CAMS R9 / KFintech MFSD211 (masters) ──────────────────────────────────
const r9 = (o: Record<string, string | number>) => ({
  foliochk: "81000001", inv_name: "TEST ADULT ONE", product: "X1G", sch_name: "Example Equity Fund - Growth",
  rep_date: serial("2026-05-18"), clos_bal: 19.951, rupee_bal: 1000, pan_no: P.adult, tax_status: "Individual",
  broker_code: "ARN-0001", amc_code: "X", ...o,
});
const r9Parsed = (rows: Record<string, string | number>[]) => parseRtaRows(readSpreadsheetToRows(xlsOf(R9_HEADER, rows, ["rep_date"]), "SYNTH_R9.xls"));

describe("CAMS R9 layout (master + holdings)", () => {
  it("has the real 101-column header and is recognised", () => {
    expect(R9_HEADER).toHaveLength(101);
    const p = r9Parsed([r9({})]);
    expect(p).toMatchObject({ source: "cams", kind: "full", reportType: "R9" });
  });

  it("a stated zero balance is stored as 0, not as 'unknown'", () => {
    const p = r9Parsed([r9({ clos_bal: 0, rupee_bal: 0 })]);
    expect(p.folios[0].schemes[0]).toMatchObject({ units: 0, value: 0 });
  });

  it("a blank balance stays unknown (never 0)", () => {
    const p = r9Parsed([r9({ clos_bal: "", rupee_bal: "" })]);
    expect(p.folios[0].schemes[0].units).toBeUndefined();
  });
});

describe("KFintech MFSD211 layout (master)", () => {
  it("has the real 129-column header and is recognised", () => {
    expect(MFSD211_HEADER).toHaveLength(129);
    const p = parseRtaCsv(decodeTextBytes(csvOf(MFSD211_HEADER, [{ "Product Code": "X01G", Fund: "X01", Folio: "91000001", "Fund Description": "Example Fund - Growth", "Investor Name": "TEST ADULT ONE", "PAN Number": P.adult }])));
    expect(p).toMatchObject({ source: "kfintech", kind: "master", reportType: "MFSD211" });
  });
});

// ── DB: R9 → R2 order, minors, re-import, tenants ─────────────────────────
const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("real layouts against the database", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  const tA = randomUUID();
  const tB = randomUUID();

  const minorMaster = [
    r9({}),
    // A minor's folio: no PAN of their own, guardian's PAN in guard_pan.
    r9({ foliochk: "81000002", inv_name: "TEST MINOR CHILD", pan_no: "", guard_pan: P.guardian, guard_name: "TEST GUARDIAN", tax_status: "On behalf of Minor", clos_bal: 10, rupee_bal: 500 }),
  ];
  const minorTxn = [
    r2({}),
    // R2 reports the minor's transaction with the GUARDIAN's PAN.
    r2({ trxnno: "1000002", folio_no: "81000002", inv_name: "TEST MINOR CHILD", pan: P.guardian, tax_status: "On behalf of Minor" }),
  ];

  const feed = (t: string, rows = minorTxn) => withTenant(t, (tx) => processRtaFile(tx, { tenantId: t, source: "cams", kind: "daily_transaction_feed", text: camsText(rows) }));
  const master = (t: string) => withTenant(t, (tx) => importRtaFolios(tx, t, r9Parsed(minorMaster).folios, { kind: "full", reportType: "R9" }));
  const state = (t: string) => withTenant(t, async (tx) => (await tx.execute(sql`
      SELECT t.order_id, t.amount::text a, t.units::text u, t.order_date::text d, t.type, t.direction, i.name, i.is_minor, f.folio_number
        FROM transactions t JOIN investors i ON i.id = t.investor_id JOIN folios f ON f.id = t.folio_id ORDER BY t.order_id`)).rows);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    for (const [id, n] of [[tA, "A"], [tB, "B"]] as const) {
      await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"Layout Test " + n}, ${"Layout Test " + n}, ${"ARN-LT" + n + id.slice(0, 6)})`));
    }
  });

  afterAll(async () => {
    const tryRun = async (q: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    for (const t of [tA, tB]) {
      for (const table of ["investor_merges", "transactions", "sips", "folios", "families"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
      await tryRun(sql`UPDATE investors SET merged_into_id = NULL, family_id = NULL, guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    }
  });

  it("R9 then R2: the minor's transaction (reported with the guardian's PAN) lands on the minor's folio", async () => {
    await master(tA);
    const out = await feed(tA);
    expect(out).toMatchObject({ rowsImported: 2, rowsSkipped: 0 });
    const rows = await state(tA);
    expect(rows.map((r: any) => [r.order_id, r.folio_number, r.is_minor])).toEqual([["1000001", "81000001", false], ["1000002", "81000002", true]]);
  });

  it("importing the same files again changes nothing", async () => {
    const before = await state(tA);
    await master(tA);
    await feed(tA);
    expect(await state(tA)).toEqual(before);
  });

  it("R2 before R9 (other firm): same transactions and amounts; the minor folio is held for review, never silently moved", async () => {
    await feed(tB);
    const s = await master(tB);
    const a = (await state(tA)).map((r: any) => [r.order_id, r.a, r.u, r.d, r.type, r.direction]);
    const b = (await state(tB)).map((r: any) => [r.order_id, r.a, r.u, r.d, r.type, r.direction]);
    expect(b).toEqual(a);
    expect(s.exceptions.map((e) => e.reason).join(" ")).toMatch(/different client|import placeholder/);
    expect(s.moved.transactions).toBe(0);
  });

  it("each firm sees only its own rows", async () => {
    const seen = await withTenant(tA, async (tx) => (await tx.execute(sql`SELECT count(DISTINCT tenant_id)::int n FROM transactions`)).rows[0] as any);
    expect(seen.n).toBe(1);
  });
});
