/**
 * RTA Phase 2 — import behaviour against a real Postgres (RLS on).
 *
 * Needs TEST_DATABASE_URL pointing at a migrated database through a
 * NON-superuser role (see tests/rls-isolation.test.ts); skipped otherwise.
 *
 * All data is synthetic and every layout is invented from the importer's own
 * column aliases — these tests prove the importer's rules (identity, refusal
 * to guess, lifecycle, tenant scope), not compatibility with real CAMS or
 * KFintech files.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("RTA import — transactions, identity, tenancy (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;

  const tA = randomUUID();
  const tB = randomUUID();
  const ids = {
    alice: randomUUID(), // live client, PAN AAAPA1111A
    bob: randomUUID(), // live client, PAN BBBPB2222B
    trashed: randomUUID(), // in Trash, PAN CCCPC3333C
    loser: randomUUID(), // merged into survivor, PAN DDDPD4444D
    survivor: randomUUID(), // PAN EEEPE5555E
  };

  const H = "FOLIO_NO|PAN|AMC_CODE|SCH_CODE|SCH_NAME|TRXN_TYPE|TRXN_NATURE|TRADDATE|AMOUNT|UNITS|NAV|TRXNNO";
  type R = Partial<Record<"folio" | "pan" | "amc" | "code" | "type" | "nature" | "date" | "amount" | "units" | "ref" | "name", string>>;
  const line = (o: R) =>
    [o.folio ?? "1000001/11", o.pan ?? "AAAPA1111A", o.amc ?? "X", o.code ?? "S01", o.name ?? "Example Scheme - Growth",
      o.type ?? "PURCHASE", o.nature ?? "", o.date ?? "02/10/2024", o.amount ?? "1,00,000.00", o.units ?? "1,234.5678", "81.00", o.ref ?? "R-1"].join("|");
  const file = (...rows: R[]) => [H, ...rows.map(line)].join("\n");

  const run = (tenantId: string, text: string, kind: "daily_transaction_feed" = "daily_transaction_feed") =>
    withTenant(tenantId, (tx) => processRtaFile(tx, { tenantId, source: "cams", kind, text }));
  const q = async <T = any>(tenantId: string, query: ReturnType<typeof import("drizzle-orm").sql>) =>
    withTenant(tenantId, async (tx) => (await tx.execute(query)).rows as T[]);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));

    await withSystem(async (tx) => {
      for (const [id, n] of [[tA, "A"], [tB, "B"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"RTA Test " + n}, ${"RTA Test " + n}, ${"ARN-RT" + n + id.slice(0, 6)})`);
      }
      const inv = (id: string, pan: string, name: string) =>
        tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${id}::uuid, ${tA}::uuid, ${pan}, ${name})`);
      await inv(ids.alice, "AAAPA1111A", "Test Alice");
      await inv(ids.bob, "BBBPB2222B", "Test Bob");
      await inv(ids.trashed, "CCCPC3333C", "Test Trashed");
      await inv(ids.survivor, "EEEPE5555E", "Test Survivor");
      await inv(ids.loser, "DDDPD4444D", "Test Loser");
      await tx.execute(sql`UPDATE investors SET deleted_at = now() WHERE id = ${ids.trashed}::uuid`);
      await tx.execute(sql`UPDATE investors SET merged_into_id = ${ids.survivor}::uuid, status = 'inactive' WHERE id = ${ids.loser}::uuid`);
    });
  });

  afterAll(async () => {
    // Every statement runs on its own: one failure must not leave the rest of
    // the synthetic firms behind in a shared test database.
    const tryRun = async (q: ReturnType<typeof sql>) => {
      try {
        await withSystem((tx) => tx.execute(q));
      } catch {
        /* best effort */
      }
    };
    for (const t of [tA, tB]) {
      for (const table of ["investor_merges", "transactions", "sips", "folios", "families"]) {
        await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
      }
      await tryRun(sql`UPDATE investors SET merged_into_id = NULL, family_id = NULL, guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    }
  });

  it("imports Indian-formatted amounts exactly, and a repeat import adds nothing", async () => {
    const text = file({ ref: "REP-1" }, { ref: "REP-2", folio: "1000001/11", amount: "2,500.50", units: "30.8704" });
    const first = await run(tA, text);
    expect(first.rowsImported).toBe(2);
    const second = await run(tA, text);
    // Phase 3E: nothing changed, so nothing is reported as imported.
    expect(second.rowsImported).toBe(0);
    expect(second.rowsUnchanged).toBe(2);
    const rows = await q(tA, sql`SELECT order_id, amount::text, units::text FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id LIKE 'REP-%' ORDER BY order_id`);
    expect(rows).toEqual([
      { order_id: "REP-1", amount: "100000.00", units: "1234.5678" },
      { order_id: "REP-2", amount: "2500.50", units: "30.8704" },
    ]);
  });

  it("two files with rows in the same positions both land — nothing is keyed on line numbers", async () => {
    await run(tA, file({ ref: "POS-A1" }, { ref: "POS-A2", amount: "10" }));
    await run(tA, file({ ref: "POS-B1", amount: "20" }, { ref: "POS-B2", amount: "30" }));
    const rows = await q(tA, sql`SELECT order_id FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id LIKE 'POS-%' ORDER BY order_id`);
    expect(rows.map((r) => r.order_id)).toEqual(["POS-A1", "POS-A2", "POS-B1", "POS-B2"]);
  });

  it("a file with no transaction-number column is refused and writes nothing", async () => {
    const noRef = "FOLIO_NO|PAN|SCH_CODE|TRXN_TYPE|TRADDATE|AMOUNT|UNITS\n1000009/99|AAAPA1111A|S01|PURCHASE|02/10/2024|10|1";
    await expect(run(tA, noRef)).rejects.toThrow(/registrar transaction number/);
    const rows = await q(tA, sql`SELECT 1 FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '1000009/99'`);
    expect(rows).toHaveLength(0);
  });

  it("the same transaction number on a DIFFERENT transaction never overwrites the existing one", async () => {
    await run(tA, file({ ref: "DUP-1", amount: "5,000.00", units: "61.7284" }));
    const out = await run(tA, file({ ref: "DUP-1", folio: "1000002/22", amount: "9,999.00", units: "1.0000" }));
    expect(out.rowsImported).toBe(0);
    expect(out.errors.map((e) => e.reason).join(" ")).toMatch(/already in the CRM for a different transaction/);
    const rows = await q(tA, sql`SELECT folio_number, amount::text, units::text FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = 'DUP-1'`);
    expect(rows).toEqual([{ folio_number: "1000001/11", amount: "5000.00", units: "61.7284" }]);
  });

  it("a row rejected for a clashing transaction number leaves no stray folio behind", async () => {
    await run(tA, file({ ref: "STRAY-1" }));
    const out = await run(tA, file({ ref: "STRAY-1", folio: "1000099/99", amount: "7.00" }));
    expect(out.rowsImported).toBe(0);
    const f = await q(tA, sql`SELECT 1 FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '1000099/99'`);
    expect(f).toHaveLength(0);
  });

  it("unknown codes, reversals and unreadable values are held back with reasons; good rows still import", async () => {
    const out = await run(
      tA,
      file(
        { ref: "MIX-OK" },
        { ref: "MIX-UNK", type: "ZZ9" },
        { ref: "MIX-REV", type: "", nature: "Purchase Reversal" },
        { ref: "MIX-DATE", date: "31/02/2024" },
        { ref: "MIX-AMT", amount: "12,34" }
      )
    );
    expect(out.rowsImported).toBe(1);
    expect(out.rowsSkipped).toBe(4);
    expect(out.rowsTotal).toBe(5);
    const stored = await q(tA, sql`SELECT order_id FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id LIKE 'MIX-%'`);
    expect(stored.map((r) => r.order_id)).toEqual(["MIX-OK"]);
    expect(out.errors.every((e) => !/AAAPA1111A/.test(e.reason))).toBe(true);
  });

  it("a PAN held by a client in Trash blocks the row; no second client is created beside it", async () => {
    const out = await run(tA, file({ ref: "TR-1", pan: "CCCPC3333C", folio: "1000003/33" }));
    expect(out.rowsImported).toBe(0);
    expect(out.errors[0].reason).toMatch(/in Trash/);
    expect(out.errors[0].reason).not.toMatch(/CCCPC3333C/);
    const inv = await q(tA, sql`SELECT count(*)::int n FROM investors WHERE tenant_id = ${tA}::uuid AND pan = 'CCCPC3333C'`);
    expect(inv[0].n).toBe(1);
  });

  it("a PAN held by a merged client attaches to the survivor", async () => {
    const out = await run(tA, file({ ref: "MG-1", pan: "DDDPD4444D", folio: "1000004/44" }));
    expect(out.rowsImported).toBe(1);
    const rows = await q(tA, sql`SELECT investor_id FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = 'MG-1'`);
    expect(rows[0].investor_id).toBe(ids.survivor);
  });

  it("a folio the CRM files under another client is not reassigned by a row naming a different PAN", async () => {
    await run(tA, file({ ref: "OWN-1", pan: "AAAPA1111A", folio: "1000005/55" }));
    const out = await run(tA, file({ ref: "OWN-2", pan: "BBBPB2222B", folio: "1000005/55" }));
    expect(out.rowsImported).toBe(0);
    expect(out.errors[0].reason).toMatch(/different client/);
    const f = await q(tA, sql`SELECT investor_id FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '1000005/55'`);
    expect(f.map((r) => r.investor_id)).toEqual([ids.alice]);
  });

  it("a row whose PAN is unknown is not attached to a folio filed under a different PAN", async () => {
    // 1000005/55 is Alice's folio. A row naming an unknown PAN must not land on her.
    const out = await run(tA, file({ ref: "OWN-3", pan: "FFFPF6666F", folio: "1000005/55" }));
    expect(out.rowsImported).toBe(0);
    expect(out.errors[0].reason).toMatch(/different PAN/);
  });

  it("a folio number held by two different clients under different AMC codes is ambiguous without a PAN", async () => {
    await run(tA, file({ ref: "AMB-1", pan: "AAAPA1111A", folio: "1000006/66", amc: "X" }));
    await run(tA, file({ ref: "AMB-2", pan: "BBBPB2222B", folio: "1000006/66", amc: "Y" }));
    const out = await run(tA, file({ ref: "AMB-3", pan: "", folio: "1000006/66", amc: "Z" }));
    expect(out.rowsImported).toBe(0);
    expect(out.errors[0].reason).toMatch(/2 different clients/);
  });

  it("PAN-less rows of two different folios under the SAME name become two clients, not one", async () => {
    const named = [
      "FOLIO_NO|PAN|INVNAME|AMC_CODE|SCH_CODE|TRXN_TYPE|TRADDATE|AMOUNT|UNITS|TRXNNO",
      "1000007/77||SAME PERSON NAME|X|S01|PURCHASE|02/10/2024|100|1|NP-1",
      "1000008/88||SAME PERSON NAME|X|S01|PURCHASE|02/10/2024|100|1|NP-2",
    ].join("\n");
    await run(tA, named);
    const rows = await q(tA, sql`
      SELECT t.order_id, i.rta_nopan_key FROM transactions t JOIN investors i ON i.id = t.investor_id
       WHERE t.tenant_id = ${tA}::uuid AND t.order_id IN ('NP-1', 'NP-2') ORDER BY t.order_id`);
    expect(rows.map((r) => r.rta_nopan_key)).toEqual(["NOPAN:FOLIO:1000007/77", "NOPAN:FOLIO:1000008/88"]);
  });

  it("master import does NOT move a placeholder's folio or transactions (automatic reassignment is off)", async () => {
    await run(tA, file({ ref: "PH-1", pan: "", folio: "1000010/10", amc: "X" }));
    const before = await q(tA, sql`SELECT investor_id FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = 'PH-1'`);
    const placeholder = before[0].investor_id;
    expect(placeholder).not.toBe(ids.bob);

    const summary = await withTenant(tA, (tx) =>
      importRtaFolios(tx, tA, [{
        rta: "cams", amcCode: "X", amcName: "X Mutual Fund", folioNumber: "1000010/10",
        schemes: [{ schemeCode: "S01", schemeName: "Example Scheme - Growth", units: 10, nav: 10, value: 100 }],
        investor: { pan: "BBBPB2222B", name: "Test Bob", category: "individual" }, nominees: [], bank: {},
      }], { kind: "full" })
    );
    expect(summary.moved).toMatchObject({ folios: 0, transactions: 0 });
    expect(summary.exceptions[0].reason).toMatch(/import placeholder/);
    const after = await q(tA, sql`SELECT investor_id FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = 'PH-1'`);
    expect(after[0].investor_id).toBe(placeholder);
    const f = await q(tA, sql`SELECT investor_id FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '1000010/10'`);
    expect(f.map((r) => r.investor_id)).toEqual([placeholder]);
  });

  it("master import does not reassign a folio filed under a different real client", async () => {
    // 1000005/55 belongs to Alice (above). A master row naming Bob must not take it.
    const summary = await withTenant(tA, (tx) =>
      importRtaFolios(tx, tA, [{
        rta: "cams", amcCode: "X", amcName: "X Mutual Fund", folioNumber: "1000005/55",
        schemes: [], investor: { pan: "BBBPB2222B", name: "Test Bob", category: "individual" }, nominees: [], bank: {},
      }], { kind: "master" })
    );
    expect(summary.exceptions[0].reason).toMatch(/different client/);
    const f = await q(tA, sql`SELECT investor_id FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '1000005/55'`);
    expect(f.map((r) => r.investor_id)).toEqual([ids.alice]);
  });

  it("master import: PAN-less adults who share a mobile number stay separate clients", async () => {
    const rec = (folio: string, name: string) => ({
      rta: "cams" as const, amcCode: "X", amcName: "X Mutual Fund", folioNumber: folio, schemes: [],
      investor: { pan: null, name, mobile: "9000000001", category: "individual" as const }, nominees: [], bank: {},
    });
    await withTenant(tA, (tx) => importRtaFolios(tx, tA, [rec("1000011/11", "Test Spouse One"), rec("1000012/12", "Test Spouse Two")], { kind: "master" }));
    const rows = await q(tA, sql`
      SELECT f.folio_number, i.name FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${tA}::uuid AND f.folio_number IN ('1000011/11', '1000012/12') ORDER BY f.folio_number`);
    expect(rows.map((r) => r.name)).toEqual(["Test Spouse One", "Test Spouse Two"]);
  });

  it("master import: a PAN in Trash holds the folio back instead of writing into the trashed client", async () => {
    const summary = await withTenant(tA, (tx) =>
      importRtaFolios(tx, tA, [{
        rta: "cams", amcCode: "X", amcName: "X Mutual Fund", folioNumber: "1000013/13", schemes: [],
        investor: { pan: "CCCPC3333C", name: "Test Trashed", category: "individual" }, nominees: [], bank: {},
      }], { kind: "master" })
    );
    expect(summary.exceptions[0].reason).toMatch(/in Trash/);
    const f = await q(tA, sql`SELECT 1 FROM folios WHERE tenant_id = ${tA}::uuid AND folio_number = '1000013/13'`);
    expect(f).toHaveLength(0);
  });

  it("tenant isolation: the same PAN, folio and transaction number in another firm stays separate", async () => {
    const before = await q(tA, sql`SELECT amount::text FROM transactions WHERE tenant_id = ${tA}::uuid AND order_id = 'REP-1'`);
    const out = await run(tB, file({ ref: "REP-1", amount: "1.00", units: "0.0100" }));
    expect(out.rowsImported).toBe(1);
    const a = await q(tA, sql`SELECT amount::text FROM transactions WHERE order_id = 'REP-1'`);
    const b = await q(tB, sql`SELECT amount::text, investor_id FROM transactions WHERE order_id = 'REP-1'`);
    expect(a).toEqual(before); // firm A unchanged, and cannot see firm B's row
    expect(b).toHaveLength(1);
    expect(b[0].amount).toBe("1.00");
    expect(b[0].investor_id).not.toBe(ids.alice); // B got its own client for the PAN
  });
});
