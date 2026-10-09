/**
 * Phase 3G — every rejection and correction shape through the validate-first
 * posting engine (real Postgres, RLS on). For each: what is written, what is
 * held, that nothing rejected raises a successful-investment total, that a
 * failed instalment stops no SIP, that a correction moves no ownership, and
 * that a re-import creates no second rejection.
 *
 * Shapes: the verified KFintech SIND / STPAD / STPOD (failed instalments) and
 * proved SINR folio correction; the rest — standalone NEWR / REDR, a
 * pre-rejection naming its original, reversal / cancellation wording, CAMS
 * rejection wording, an unknown code, an unprocessed status — have NO verified
 * meaning and must stay held, visible, never posted. Synthetic values.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD201_HEADER, R2_HEADER, csvOf, xlsOf, serial, P } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;
const kfin = (txn: string, v: Record<string, string> = {}) => ({
  "Fund": "117", "Folio Number": "97000001", "Product Code": "117EQGR", "Fund Description": "Example Equity Fund - Growth", "Transaction Head": "P",
  "Transaction Description": "Systematic Investment", "Transaction Type": "SIN", "Transaction Status": "Y", "Transaction Date": "15/4/2026",
  "Nav": "50.0000", "Price": "50.0000", Units: "20.000", Amount: "1000.00", "Transaction Number": txn, PAN1: P.adult, ...v,
});
const refused = (txn: string, type: string, v: Record<string, string> = {}) =>
  kfin(txn, { "Transaction Type": type, "Transaction Description": "Pre rejection", Units: "0.000", Amount: "2000.00", Price: "0", Remarks: "Required amount not available", ...v });

describe.skipIf(!TEST_DB)("rejections and corrections through validate-first posting (DB)", () => {
  let H2p: typeof import("./helpers/two-person");
  let ops2p: import("./helpers/two-person").Operators;
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let vf: typeof import("@/lib/rta/posting/validate-first");
  const t = randomUUID();
  const inv = { a: randomUUID(), b: randomUUID() };
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const run = async (name: string, buf: Buffer) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status)
      VALUES (${id}::uuid, ${t}::uuid, 'kfintech', 'daily_transaction_feed', '2026-10-08', '2026-10-08', ${name}, ${"test/" + name}, 'parsing')`));
    return vf.validateFirstImport({ tenantId: t, importId: id, fileName: name, fileRef: `test:${name}`, buf, asOf: "2026-10-08" });
  };
  const outcome = async (no: string) => (await q(sql`SELECT posting_outcome AS o, posting_reason AS r, reason FROM rta_staging_economic_txns WHERE tenant_id = ${t}::uuid AND registrar_txn_no = ${no} ORDER BY created_at DESC LIMIT 1`))[0];
  const snapshot = () => q(sql`SELECT
      (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid)::int AS txns,
      (SELECT count(*) FROM transactions WHERE tenant_id = ${t}::uuid AND status = 'rejected')::int AS rejected,
      (SELECT coalesce(sum(amount), 0) FROM transactions WHERE tenant_id = ${t}::uuid AND status IN ('processed', 'successful'))::text AS invested,
      (SELECT coalesce(sum(units), 0) FROM transactions WHERE tenant_id = ${t}::uuid AND status = 'rejected')::text AS rejected_units,
      (SELECT count(*) FROM sip_rejections WHERE tenant_id = ${t}::uuid)::int AS sip_rejections,
      (SELECT string_agg(folio_number || '>' || investor_id, ',' ORDER BY folio_number) FROM folios WHERE tenant_id = ${t}::uuid) AS owners,
      (SELECT string_agg(status, ',' ORDER BY id) FROM sips WHERE tenant_id = ${t}::uuid) AS sips`).then((r) => r[0]);

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
    H2p = await import("./helpers/two-person");
    ops2p = await H2p.createOperators("rm");
    await H2p.release(ops2p, "global");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Rejections', 'Rejections', ${"ARN-RJ" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv.a}::uuid, ${t}::uuid, ${P.adult}, 'Matrix Adult'), (${inv.b}::uuid, ${t}::uuid, ${P.adult2}, 'Matrix Adult Two')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta) VALUES
        (${t}::uuid, ${inv.a}::uuid, '117', 'AMC 117', '97000001', 'kfintech'), (${t}::uuid, ${inv.a}::uuid, '117', 'AMC 117', '97000002', 'kfintech'),
        (${t}::uuid, ${inv.b}::uuid, 'H', 'AMC H', '5570001/11', 'cams')`);
      await tx.execute(sql`INSERT INTO sips (tenant_id, investor_id, folio_number, amc_code, amc_name, scheme_code, scheme_name, amount, frequency, start_date, status)
        VALUES (${t}::uuid, ${inv.a}::uuid, '97000001', '117', 'AMC 117', '117EQGR', 'Example', 2000, 'monthly', '2025-01-15', 'active')`);
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
    await tryRun(sql`DELETE FROM folios WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("the matrix: what posts, what is a rejection record, what is held — and nothing rejected counts as investment", async () => {
    const before = await snapshot();
    const k = await run("matrix.csv", csvOf(MFSD201_HEADER, [
      kfin("980001"),                                                                                   // a genuine SIP instalment (control)
      refused("980002", "SIND"),                                                                        // SIP instalment rejection (verified shape)
      refused("980003", "STPAD", { "Switch_Ref. No.": "SW9" }), refused("980004", "STPOD", { "Transaction Head": "R", "Switch_Ref. No.": "SW9" }), // STP rejection, both legs
      refused("980005", "SIND", { RejTrnoOrgNo: "970001" }),                                            // pre-rejection naming its original
      kfin("980006", { "Transaction Type": "NEWR", "Transaction Head": "R", "Transaction Description": "Purchase Rejection", Units: "-10.000", Amount: "-500.00" }), // purchase rejection, standalone
      kfin("980007", { "Transaction Type": "REDR", "Transaction Head": "P", "Transaction Description": "Redemption Rejection", Units: "5.000", Amount: "250.00" }),   // redemption rejection, standalone
      kfin("980008", { "Transaction Description": "SIP Reversal" }),                                    // reversal wording
      kfin("980009", { "Transaction Description": "Purchase Cancellation" }),                           // cancellation wording
      kfin("980010", { "Transaction Type": "QQQ" }),                                                    // unknown code
      kfin("980011", { "Transaction Status": "N" }),                                                    // not processed by the registrar
      // A proved folio correction: original + exact negation in 97000001, equal re-post in 97000002.
      kfin("980012", { "Transaction Date": "10/1/2025" }), kfin("980012", { "Transaction Date": "10/1/2025", "Transaction Type": "SINR", "Transaction Head": "R", Units: "-20.000", Amount: "-1000.00" }),
      kfin("980012", { "Transaction Date": "10/1/2025", "Folio Number": "97000002" }),
    ]));
    const c = await run("cams.xls", xlsOf(R2_HEADER, [{
      amc_code: "H", folio_no: "5570001/11", prodcode: "HFC", trxnno: "990001", traddate: serial("2026-05-02"), units: "0.0000", amount: "1000.00", purprice: "0",
      trxn_type_flag: "Purchase Rejection", trxn_nature: "Rejection", trxntype: "P1", trxnstat: "Y", pan: P.adult2, siptrxnno: "",
    }], ["traddate"]));
    expect(c.posting).toMatchObject({ counts: { unsupported: 1 } });

    const o = Object.fromEntries(await Promise.all(["980001", "980002", "980003", "980004", "980005", "980006", "980007", "980008", "980009", "980010", "980011", "980012"].map(async (n) => [n, await outcome(n)])));
    expect(o["980001"].o).toBe("posted");
    expect([o["980002"].o, o["980003"].o, o["980004"].o]).toEqual(["rejected_recorded", "rejected_recorded", "rejected_recorded"]);
    for (const n of ["980005", "980006", "980007", "980008", "980009", "980010", "980011"]) expect(o[n].o, n).toBe("unsupported");
    expect(o["980005"].reason).toMatch(/^pre_rejection_unlinked/);
    expect(o["980006"].reason).toMatch(/^rejection_semantics_unverified/);
    expect(o["980007"].reason).toMatch(/^rejection_semantics_unverified/);
    expect(o["980008"].reason).toMatch(/^reversal_unlinked/);
    expect(o["980009"].reason).toMatch(/^cancellation_unlinked/);
    expect(o["980010"].reason).toMatch(/^unknown_transaction_code/);
    expect(o["980011"].reason).toMatch(/^registrar_status_not_processed/);
    expect(o["980012"].o).toBe("correction_held");
    expect((await outcome("990001")).reason).toMatch(/^pre_rejection_unlinked/);
    expect(k.posting).toBeTruthy();

    const after = await snapshot();
    // Only the genuine SIP instalment is investment; every rejection record carries 0 units.
    expect(Number(after.invested) - Number(before.invested)).toBe(1000);
    expect(after.rejected - before.rejected).toBe(3);
    expect(Number(after.rejected_units)).toBe(0);
    // One SIP Rejection (the SIP instalment); the STP pair is not a SIP rejection.
    expect(after.sip_rejections - before.sip_rejections).toBe(1);
    // A failed instalment stops no SIP; a correction moves no folio between clients.
    expect(after.sips).toBe(before.sips);
    expect(after.owners).toBe(before.owners);
    // Everything held is visible, with its reason, on the exception list.
    const { loadHeldTransactions } = await import("@/lib/rta/posting/held");
    const h = await withTenant(t, (tx) => loadHeldTransactions(tx, t));
    expect(h.counts).toMatchObject({ unsupported: 8, correction_held: 1 });
    expect(h.rows.every((r) => r.reason.length > 0)).toBe(true);
    // Traceable: every rejection record is in the ledger, linked to its source rows.
    const led = await q(sql`SELECT p.kind, t.status, t.raw_feed_row->>'identityKey' = p.identity_key AS linked FROM rta_posted_transactions p JOIN transactions t ON t.id = p.transaction_id WHERE p.tenant_id = ${t}::uuid AND p.kind = 'rejected_recorded'`);
    expect(led).toHaveLength(3);
    expect(led.every((r) => r.status === "rejected" && r.linked)).toBe(true);
  });

  it("re-importing the same rejections creates no second rejection record or SIP Rejection", async () => {
    const before = await snapshot();
    const again = await run("matrix-again.csv", csvOf(MFSD201_HEADER, [refused("980002", "SIND"), refused("980003", "STPAD", { "Switch_Ref. No.": "SW9" }), refused("980004", "STPOD", { "Transaction Head": "R", "Switch_Ref. No.": "SW9" })]));
    expect(again.posting).toMatchObject({ counts: { already_posted: 3 } });
    expect(await snapshot()).toEqual(before);
  });
});
