/**
 * Phase 3E — the owner rules on the RICH importer (MFSD211 master, MFSD203
 * holdings), against a real Postgres. Synthetic rows on the verified headers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD203_HEADER, MFSD211_V2_HEADER, csvOf } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("rich importer — HUF, guardian and unstated holder type (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let parseRtaCsv: typeof import("@/lib/rta").parseRtaCsv;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;

  const t = randomUUID();
  const ids = { guardian: randomUUID(), minor: randomUUID() };
  const PAN = { guardian: "GGGPG1111G", karta: "KKKPK2222K", huf: "HHHHH3333H", adult: "AAAPA4444A" };

  const m211 = (o: Record<string, string>) => ({
    "Product Code": "117EQ", Fund: "117", Folio: "94000001", "Fund Description": "Example Equity Fund", "Investor Name": "TEST HOLDER",
    "Report Date": "08/10/2026", "PAN Number": PAN.adult, StatusDesc: "Individual", ...o,
  });
  const h203 = (o: Record<string, string>) => ({
    "Product Code": "117EQ", Fund: "117", "Folio Number": "94000001", "Fund Description": "Example Equity Fund - Growth",
    Balance: "10.000", "Agent Code": "ARN-990002", "Investor Name": "TEST HOLDER", AUM: "500.00", NAV: "50.0000", "Report Date": "08/10/2026", PAN: PAN.adult, ...o,
  });
  const run = async (header: string[], rows: Record<string, string>[], kind: "master" | "holdings") => {
    const p = parseRtaCsv(csvOf(header, rows).toString("latin1"));
    return withTenant(t, (tx) => importRtaFolios(tx, t, p.folios, { kind, reportType: p.reportType }));
  };
  const folioOwner = async (folio: string) => (await withTenant(t, async (tx) =>
    (await tx.execute(sql`SELECT investor_id::text AS id FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = ${folio}`)).rows as Array<{ id: string }>));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ parseRtaCsv } = await import("@/lib/rta"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Rich Owner', 'Rich Owner', ${"ARN-RO" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${ids.guardian}::uuid, ${t}::uuid, ${PAN.guardian}, 'Test Guardian')`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, is_minor, investor_category, guardian_investor_id)
        VALUES (${ids.minor}::uuid, ${t}::uuid, ${"MINOR:" + PAN.guardian + ":TESTMINOR"}, 'Test Minor', true, 'minor', ${ids.guardian}::uuid)`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${t}::uuid, ${ids.minor}::uuid, '94000050', '117', 'AMC 117', 'kfintech')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (stmt: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(stmt)); } catch { /* best effort */ } };
    for (const table of ["folios", "families"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`UPDATE investors SET family_id = NULL, guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("an HUF master row carrying an individual (Karta's) PAN is held; nothing goes to the Karta", async () => {
    const out = await run(MFSD211_V2_HEADER, [m211({ Folio: "94000010", "PAN Number": PAN.karta, StatusDesc: "HUF" })], "master");
    expect(JSON.stringify(out.exceptions ?? [])).toMatch(/HUF but the PAN is an individual's \(the Karta's\)/);
    expect(await folioOwner("94000010")).toEqual([]);
    const [k] = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${t}::uuid AND pan = ${PAN.karta}`)).rows as any[]);
    expect(k.n).toBe(0);
  });

  it("an HUF with its own H-type PAN is the owner; MFSD203 reads the holder type from the PAN", async () => {
    await run(MFSD203_HEADER, [h203({ "Folio Number": "94000011", PAN: PAN.huf })], "holdings");
    const [c] = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT investor_category FROM investors WHERE tenant_id = ${t}::uuid AND pan = ${PAN.huf}`)).rows as any[]);
    expect(c.investor_category).toBe("huf");
  });

  it("a minor's folio on record, reported with the guardian's PAN, stays the minor's", async () => {
    await run(MFSD203_HEADER, [h203({ "Folio Number": "94000050", PAN: PAN.guardian })], "holdings");
    expect(await folioOwner("94000050")).toEqual([{ id: ids.minor }]);
    const [legs] = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT jsonb_array_length(schemes) AS n FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '94000050'`)).rows as any[]);
    expect(legs.n).toBe(1);
  });

  it("a new folio under a recorded guardian's PAN: held where the layout could carry a guardian's PAN, filed under the holder where it cannot", async () => {
    // A layout not shown to leave a minor's PAN blank: the folio may be the minor's — held.
    const p = parseRtaCsv(csvOf(MFSD203_HEADER, [h203({ "Folio Number": "94000051", PAN: PAN.guardian })]).toString("latin1"));
    const held = await withTenant(t, (tx) => importRtaFolios(tx, t, p.folios, { kind: "holdings", reportType: "UNVERIFIED_LAYOUT" }));
    expect(JSON.stringify(held.exceptions ?? [])).toMatch(/recorded guardian of a minor/);
    expect(await folioOwner("94000051")).toEqual([]);
    // KFintech MFSD203 leaves a minor's PAN blank (12/12 real minor positions): the PAN is the holder's own.
    await run(MFSD203_HEADER, [h203({ "Folio Number": "94000051", PAN: PAN.guardian })], "holdings");
    expect(await folioOwner("94000051")).toEqual([{ id: ids.guardian }]);
  });
  it("a minor at a second registrar matching only by guardian PAN + name is a SEPARATE provisional client, reported for review — never merged by name", async () => {
    const minorRec = (rta: "cams" | "kfintech", folio: string, amc: string) => ({
      rta, amcCode: amc, amcName: `AMC ${amc}`, folioNumber: folio, schemes: [], nominees: [], bank: {}, reportDate: "2026-10-08",
      investor: { pan: null, name: "Second Child", category: "minor", isMinor: true, guardianPan: PAN.guardian, guardianName: "Test Guardian" },
    }) as any;
    await withTenant(t, (tx) => importRtaFolios(tx, t, [minorRec("cams", "5551234/11", "H")], { kind: "master", reportType: "R9" }));
    const second = await withTenant(t, (tx) => importRtaFolios(tx, t, [minorRec("kfintech", "94000077", "117")], { kind: "master", reportType: "MFSD211" }));
    const [a] = await folioOwner("5551234/11");
    const [b] = await folioOwner("94000077");
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(JSON.stringify((second as any).reviews ?? [])).toMatch(/separate provisional client; merge only after review/);
    const keys = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT pan, is_minor, guardian_investor_id::text AS g FROM investors WHERE tenant_id = ${t}::uuid AND id IN (${a.id}::uuid, ${b.id}::uuid) ORDER BY pan`)).rows as any[]);
    expect(keys.every((k) => k.is_minor && k.g === ids.guardian && String(k.pan).startsWith("MINOR:"))).toBe(true);
    expect(keys.map((k) => k.pan)).toEqual([`MINOR:${PAN.guardian}:SECONDCHILD`, `MINOR:${PAN.guardian}:SECONDCHILD:KFINTECH`].sort());
    // Re-importing either side reuses its own client — no third client, nothing moved.
    await withTenant(t, (tx) => importRtaFolios(tx, t, [minorRec("kfintech", "94000077", "117")], { kind: "master", reportType: "MFSD211" }));
    await withTenant(t, (tx) => importRtaFolios(tx, t, [minorRec("cams", "5551234/11", "H")], { kind: "master", reportType: "R9" }));
    expect(await folioOwner("5551234/11")).toEqual([a]);
    expect(await folioOwner("94000077")).toEqual([b]);
    // The guardian owns neither.
    expect([a.id, b.id]).not.toContain(ids.guardian);
  });
});
