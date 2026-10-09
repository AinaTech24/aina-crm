/**
 * A registrar file must land on the client the firm already has — never on a
 * second copy of them. Each case below is a way the importer used to create a
 * duplicate (lib/rta/client-match.ts has the story):
 *
 *   - the firm's Excel-loaded client (dedup_pan = false) got a same-PAN twin;
 *   - a merge was undone by the next file, which sent the folios to the
 *     retired record still holding the PAN;
 *   - a client the firm entered without a PAN got a twin carrying it;
 *   - a feed placeholder kept the transactions after the master moved its
 *     folio to the real client.
 *
 * And what must NOT happen: a namesake is never adopted.
 *
 * DB-backed: needs a migrated Postgres in TEST_DATABASE_URL; skipped otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { nameMatchKey } from "@/lib/rta/client-match";
import type { RtaFolioRecord } from "@/lib/rta/types";

describe("nameMatchKey", () => {
  it("ignores case, punctuation, honorifics and word order", () => {
    expect(nameMatchKey("Mr. Nimesh C. Shah")).toBe(nameMatchKey("SHAH NIMESH C"));
    expect(nameMatchKey("Smt  Asha-Ben Patel")).toBe(nameMatchKey("ASHA BEN PATEL"));
  });
  it("keeps different people apart", () => {
    expect(nameMatchKey("Nimesh Shah")).not.toBe(nameMatchKey("Nimesh C Shah"));
    expect(nameMatchKey("")).toBe("");
  });
});

describe("KFintech holdings: PAN and mobile under any of their column names", () => {
  it("reads 'PAN Number' / 'Mobile Number' as well as 'PAN' / 'Mobile No'", async () => {
    const { parseKfintechHoldings } = await import("@/lib/rta/kfintech");
    for (const [panCol, mobCol] of [["PAN", "Mobile No"], ["PAN Number", "Mobile Number"], ["PAN No", "Mobile"]]) {
      const header = ["Product Code", "Fund", "Folio Number", "Fund Description", "Balance", "NAV", "AUM", "Investor Name", "Email", panCol, mobCol];
      const row = ["P1746", "117", "1234567", "Test Fund Growth", "10", "100", "1000", "ASHA MEHTA", "a@x.in", "aaapa1111a", "9876543210"];
      const { folios, missingPan } = parseKfintechHoldings([header, row]);
      expect(missingPan).toBe(0);
      expect(folios[0].investor.pan).toBe("AAAPA1111A");
      expect(folios[0].investor.mobile).toBe("9876543210");
    }
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("RTA import matches the clients the firm already has", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  let mergeInvestors: typeof import("@/lib/investors/merge").mergeInvestors;
  let sql: typeof import("drizzle-orm").sql;

  const tenant = randomUUID();

  const rec = (pan: string | undefined, name: string, folio: string, extra: Partial<RtaFolioRecord["investor"]> = {}): RtaFolioRecord =>
    ({
      rta: "cams",
      folioNumber: folio,
      amcCode: "P",
      amcName: "ICICI Prudential",
      investor: { pan, name, category: "individual", ...extra },
      nominees: [],
      bank: {},
      schemes: [{ schemeCode: "P1746", schemeName: "Test Fund", units: 10, nav: 100, value: 1000 }],
      aum: 1000,
    }) as unknown as RtaFolioRecord;

  const q = async <T = any>(text: ReturnType<typeof import("drizzle-orm").sql>) =>
    withSystem(async (tx) => (await tx.execute(text)).rows as T[]);
  const run = (records: RtaFolioRecord[], kind: "master" | "holdings" = "master") =>
    withSystem((tx) => importRtaFolios(tx, tenant, records, { kind }));
  const liveWithPan = (pan: string) =>
    q<{ id: string; dedup_pan: boolean }>(sql`
      SELECT id, dedup_pan FROM investors
       WHERE tenant_id = ${tenant}::uuid AND pan = ${pan} AND deleted_at IS NULL AND merged_into_id IS NULL
    `);
  const folioOwner = async (folio: string) =>
    (await q<{ investor_id: string }>(sql`SELECT investor_id FROM folios WHERE tenant_id = ${tenant}::uuid AND folio_number = ${folio}`))[0]?.investor_id;
  const insertClient = (id: string, v: { name: string; pan?: string | null; dedupPan?: boolean; rta?: string | null }) =>
    q(sql`
      INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, rta_nopan_key)
      VALUES (${id}::uuid, ${tenant}::uuid, ${v.name}, ${v.pan ?? null}, ${v.dedupPan ?? true}, ${v.rta ?? null})
    `);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    ({ mergeInvestors } = await import("@/lib/investors/merge"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'RTA Match Test', 'RTA Match Test', ${"ARN-RM-" + tenant.slice(0, 6)})`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["investor_merges", "audit_log", "transactions", "sips", "folios"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`UPDATE investors SET merged_into_id = NULL WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    for (const t of ["investors", "tenants"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE ${sql.raw(t === "tenants" ? "id" : "tenant_id")} = ${tenant}::uuid`).catch(() => {});
    }
  });

  it("updates the firm's Excel-loaded client instead of creating a same-PAN twin", async () => {
    const firm = randomUUID();
    await insertClient(firm, { name: "Excel Client", pan: "AAAPE1111A", dedupPan: false });
    const s = await run([rec("AAAPE1111A", "EXCEL CLIENT", "F-EX-1")]);
    expect(s.investors.created).toBe(0);
    const rows = await liveWithPan("AAAPE1111A");
    expect(rows.map((r) => r.id)).toEqual([firm]);
    expect(rows[0].dedup_pan).toBe(true);
    expect(await folioOwner("F-EX-1")).toBe(firm);
  });

  it("keeps a merge: the next file lands on the survivor, which takes the PAN", async () => {
    const survivor = randomUUID();
    const twin = randomUUID();
    await insertClient(survivor, { name: "Merged Survivor" });
    await insertClient(twin, { name: "MERGED SURVIVOR", pan: "AAAPM2222B" });
    await withSystem((tx) => mergeInvestors(tx, { tenantId: tenant, survivorId: survivor, loserId: twin, byUserId: null, source: "manual" }));
    await run([rec("AAAPM2222B", "MERGED SURVIVOR", "F-MG-1")]);
    expect(await folioOwner("F-MG-1")).toBe(survivor);
    expect((await liveWithPan("AAAPM2222B")).map((r) => r.id)).toEqual([survivor]);
  });

  it("adopts the firm's PAN-less client on an unambiguous name", async () => {
    const firm = randomUUID();
    await insertClient(firm, { name: "Mr Nimesh C Shah" });
    const s = await run([rec("AAAPN3333C", "SHAH NIMESH C", "F-NP-1")]);
    expect(s.investors.created).toBe(0);
    expect(s.investors.matchedByName).toBe(1);
    expect((await liveWithPan("AAAPN3333C")).map((r) => r.id)).toEqual([firm]);
    expect(await folioOwner("F-NP-1")).toBe(firm);
  });

  it("never adopts a namesake", async () => {
    await insertClient(randomUUID(), { name: "Ramesh Kumar Patel" });
    await insertClient(randomUUID(), { name: "Ramesh Kumar Patel" });
    const s = await run([rec("AAAPR4444D", "RAMESH KUMAR PATEL", "F-NS-1")]);
    expect(s.investors.created).toBe(1);
    expect(s.investors.matchedByName).toBe(0);
  });

  it("moves a placeholder's history with its folio and folds the placeholder away", async () => {
    const placeholder = randomUUID();
    await insertClient(placeholder, { name: "Feed Person", rta: "NOPAN:NFEEDPERSON" });
    const [f] = await q<{ id: string }>(sql`
      INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta, schemes)
      VALUES (${tenant}::uuid, ${placeholder}::uuid, 'F-PH-1', 'P', 'ICICI Prudential', 'cams', '[]'::jsonb) RETURNING id
    `);
    await q(sql`
      INSERT INTO transactions (tenant_id, investor_id, folio_id, folio_number, amc_code, scheme_code, scheme_name, type, direction, amount, units, nav, order_id, order_date, status)
      VALUES (${tenant}::uuid, ${placeholder}::uuid, ${f.id}::uuid, 'F-PH-1', 'P', 'P1746', 'Test Fund', 'purchase', 'in', 1000, 10, 100, ${"ord-" + tenant.slice(0, 8)}, '2026-09-01', 'processed')
    `);
    await run([rec("AAAPF5555E", "FEED PERSON TWO", "F-PH-1")]);
    const owner = await folioOwner("F-PH-1");
    expect(owner).not.toBe(placeholder);
    const [t] = await q<{ investor_id: string }>(sql`SELECT investor_id FROM transactions WHERE tenant_id = ${tenant}::uuid AND folio_number = 'F-PH-1'`);
    expect(t.investor_id).toBe(owner);
    const [ph] = await q<{ merged_into_id: string | null }>(sql`SELECT merged_into_id FROM investors WHERE id = ${placeholder}::uuid`);
    expect(ph.merged_into_id).toBe(owner);
  });

  it("a holdings row with no PAN never takes a folio from the PAN client who holds it", async () => {
    const holder = randomUUID();
    await insertClient(holder, { name: "Family Head" });
    await run([rec("AAAPH7777G", "FAMILY HEAD", "F-HD-1")]);
    const owner = await folioOwner("F-HD-1");
    const before = (await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${tenant}::uuid`))[0].n;
    // The same folio again from a holdings file whose PAN column was not read.
    const s = await run([rec(undefined, "FAMILY HEAD", "F-HD-1", { email: "family@example.com" })], "holdings");
    expect(s.investors.created).toBe(0);
    expect(await folioOwner("F-HD-1")).toBe(owner);
    const after = (await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${tenant}::uuid`))[0].n;
    expect(after).toBe(before);
  });

  it("is idempotent: the same file twice creates nothing the second time", async () => {
    const file = [rec("AAAPI6666F", "IDEM POTENT", "F-ID-1"), rec(undefined, "NO PAN PERSON", "F-ID-2", { mobile: "9876543210" })];
    await run(file);
    const s = await run(file);
    expect(s.investors.created).toBe(0);
    expect((await liveWithPan("AAAPI6666F")).length).toBe(1);
  });
});
