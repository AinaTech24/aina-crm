/**
 * Phase 3E — refused instructions and folio corrections through the LEGACY
 * transaction-feed importer, against a real Postgres. MFSD201's verified
 * header with synthetic rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, P, csvOf } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("RTA legacy feed — refused instructions and folio corrections (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  let decode: typeof import("@/lib/rta/decode").decodeRtaToText;

  const t = randomUUID();
  const inv = randomUUID();
  const k201 = (o: Record<string, string>) => ({
    "Product Code": "X01G", Fund: "X01", "Folio Number": "91000001", "Fund Description": "Example Fund - Growth",
    "Transaction Head": "P", "Transaction Number": "500001", "Transaction Status": "Y", "Transaction Date": "15/04/2026",
    "Nav Date": "15/04/2026", Price: "50.0000", Nav: "50.0000", Units: "20.000", Amount: "1000.00",
    "Transaction Sub": "N", "Transaction Description": "Systematic Investment", "Transaction Type": "SIN",
    PAN1: P.adult, "Investor Name": "TEST ADULT ONE", "Transaction ID": "1", Ihno: "70001", ...o,
  });
  const refused = (o: Record<string, string>) => k201({ Units: "0.000", Amount: "2000.00", Price: "0", ...o });
  const file = () => decode(csvOf(MFSD201_HEADER, [
    k201({ "Transaction Number": "500001" }),
    refused({ "Transaction Number": "500002", "Transaction Type": "SIND", "Transaction Description": "Systematic Investment Pre-Rejection", Remarks: "Primary KYC Invalid(KYC Modification not Done)" }),
    refused({ "Transaction Number": "500003", "Transaction Type": "STPAD", "Transaction Description": "S T P In Pre rejection", "Switch_Ref. No.": "77001", Remarks: "Required amount not available in source fund" }),
    refused({ "Transaction Number": "500004", "Transaction Head": "R", "Transaction Type": "STPOD", "Transaction Description": "S T P Out Pre rejection", "Switch_Ref. No.": "77001", Remarks: "Required amount not available in source fund" }),
    refused({ "Transaction Number": "500005", "Folio Number": "91000999", "Transaction Type": "SIND", "Transaction Description": "Systematic Investment Pre-Rejection" }),
    // a proved folio correction: original, exact negation, equal re-post
    k201({ "Transaction Number": "500006", "Transaction Date": "10/01/2025", Units: "10.000", Amount: "500.00" }),
    k201({ "Transaction Number": "500006", "Transaction Date": "10/01/2025", "Transaction Type": "SINR", "Transaction Head": "R", "Transaction Description": "SIP Rejection", Units: "-10.000", Amount: "-500.00" }),
    k201({ "Transaction Number": "500006", "Transaction Date": "10/01/2025", "Folio Number": "91000002", Units: "10.000", Amount: "500.00" }),
  ]), "MFSD201_SYNTH.csv");
  const run = () => withTenant(t, (tx) => processRtaFile(tx, { tenantId: t, source: "kfintech", kind: "daily_transaction_feed", text: file() }));
  const q = async <T = any>(query: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(query)).rows as T[]);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    ({ decodeRtaToText: decode } = await import("@/lib/rta/decode"));
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Rej Test', 'Rej Test', ${"ARN-RJ" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, ${P.adult}, 'Test Adult')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${t}::uuid, ${inv}::uuid, '91000001', 'X01', 'AMC X', 'kfintech')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (stmt: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(stmt)); } catch { /* best effort */ } };
    for (const table of ["events_outbox", "sip_rejections", "transactions", "folios"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("a refused instruction is a rejected transaction (0 units, never business); a refused SIP also opens one SIP Rejection", async () => {
    const out = await run();
    const txs = await q<{ order_id: string; status: string; units: string; reason_code: string | null; reason_description: string | null; sw: string | null }>(sql`
      SELECT order_id, status, units::text AS units, reason_code, reason_description, raw_feed_row->>'switchRef' AS sw
        FROM transactions WHERE tenant_id = ${t}::uuid ORDER BY order_id`);
    expect(txs.map((x) => [x.order_id, x.status, Number(x.units), x.reason_code])).toEqual([
      ["500001", "processed", 20, null],
      ["500002", "rejected", 0, "failed_sip_instalment"],
      ["500003", "rejected", 0, "failed_stp_leg"],
      ["500004", "rejected", 0, "failed_stp_leg"],
    ]);
    expect(txs[1].reason_description).toBe("Primary KYC Invalid(KYC Modification not Done)");
    // Business counts only the processed instalment.
    const [biz] = await q<{ amt: string }>(sql`SELECT COALESCE(SUM(amount),0)::text AS amt FROM transactions WHERE tenant_id = ${t}::uuid AND status IN ('processed','successful')`);
    expect(Number(biz.amt)).toBe(1000);
    // One refused STP instruction, two legs.
    const [stp] = await q<{ n: number }>(sql`SELECT count(DISTINCT (raw_feed_row->>'switchRef', order_date))::int AS n FROM transactions WHERE tenant_id = ${t}::uuid AND reason_code = 'failed_stp_leg'`);
    expect(stp.n).toBe(1);
    const rej = await q<{ order_id: string; reason: string }>(sql`
      SELECT tr.order_id, r.rejection_reason AS reason FROM sip_rejections r JOIN transactions tr ON tr.id = r.transaction_id WHERE r.tenant_id = ${t}::uuid`);
    expect(rej).toEqual([{ order_id: "500002", reason: "Primary KYC Invalid(KYC Modification not Done)" }]);
    // The refused SIP for a folio not on record created nothing and says why.
    expect(out.errors.find((e) => e.row === 6)?.reason).toMatch(/not on record — held until the folio master arrives/);
    // The folio correction moved nothing and is explained as a correction.
    expect(out.errors.filter((e) => /^folio correction/.test(e.reason))).toHaveLength(3);
    const [f2] = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '91000002'`);
    expect(f2.n).toBe(0);
  });

  it("re-importing the same file adds nothing", async () => {
    const out = await run();
    expect(out.rowsImported).toBe(0);
    const [n] = await q<{ tx: number; rej: number }>(sql`SELECT (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid)::int AS tx, (SELECT count(*) FROM sip_rejections WHERE tenant_id = ${t}::uuid)::int AS rej`);
    expect(n).toEqual({ tx: 4, rej: 1 });
  });
});
