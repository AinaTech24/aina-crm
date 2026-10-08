/**
 * Phase 3E — dated AUM through the RICH holdings import (MFSD203), against a
 * real Postgres: the registrar's figures and date are kept on every leg, an
 * older statement never overwrites a newer one, a stated zero stays a zero,
 * live-NAV revaluation leaves the statement alone, the portfolio reconciles to
 * its legs, and a joint holder adds nothing. Synthetic rows, verified header.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MFSD203_HEADER, csvOf } from "./rta-real-layouts";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("dated AUM — MFSD203 through the rich importer (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let parseRtaCsv: typeof import("@/lib/rta").parseRtaCsv;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  let revalueAllFolios: typeof import("@/lib/finance/aum-persist").revalueAllFolios;
  let valueInvestor: typeof import("@/lib/finance/valuation").valueInvestor;
  let getRegistrarAum: typeof import("@/lib/metrics").getRegistrarAum;

  const t = randomUUID();
  const ARN = "ARN-990001";
  const PAN = "KKKPK1234K";
  const row = (o: Record<string, string>) => ({
    "Product Code": "117EQ", Fund: "117", "Folio Number": "93000001", "Scheme Code": "EQ", "Fund Description": "Example Equity Fund - Growth",
    Balance: "100.000", "Agent Code": ARN, "Investor Name": "TEST HOLDER", AUM: "5000.00", NAV: "50.0000", "Report Date": "08/10/2026", PAN, ...o,
  });
  const statement = (rows: Record<string, string>[]) => parseRtaCsv(csvOf(MFSD203_HEADER, rows).toString("latin1"));
  const importIt = async (rows: Record<string, string>[]) => {
    const p = statement(rows);
    return withTenant(t, (tx) => importRtaFolios(tx, t, p.folios, { kind: "holdings", reportType: p.reportType }));
  };
  const legs = async () => withTenant(t, async (tx) => (await tx.execute(sql`
    SELECT f.folio_number, leg->>'schemeCode' AS code, leg->>'units' AS units, leg->>'sourceUnits' AS su, leg->>'sourceValue' AS sv,
           leg->>'sourceAsOf' AS asof, leg->>'sourceReport' AS rep, leg->>'value' AS value
      FROM folios f CROSS JOIN LATERAL jsonb_array_elements(f.schemes) leg WHERE f.tenant_id = ${t}::uuid ORDER BY 1, 2`)).rows as any[]);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ parseRtaCsv } = await import("@/lib/rta"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    ({ revalueAllFolios } = await import("@/lib/finance/aum-persist"));
    ({ valueInvestor } = await import("@/lib/finance/valuation"));
    ({ getRegistrarAum } = await import("@/lib/metrics"));
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'AUM Test', 'AUM Test', ${ARN})`));
  });

  afterAll(async () => {
    const tryRun = async (stmt: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(stmt)); } catch { /* best effort */ } };
    for (const table of ["folio_holders", "transactions", "folios", "families"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`UPDATE investors SET family_id = NULL, guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM audit_log WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code = '117EQ' AND scheme_name = 'Example Equity Fund - Growth'`);
  });

  it("keeps the registrar's units, value, date and report on each leg, and a stated zero as zero", async () => {
    await importIt([row({}), row({ "Product Code": "117DB", "Fund Description": "Example Debt Fund - Growth", Balance: "0.000", AUM: "0.00" })]);
    const l = await legs();
    expect(l.map((x) => [x.code, Number(x.su), Number(x.sv), x.asof, x.rep])).toEqual([
      ["117DB", 0, 0, "2026-10-08", "MFSD203"],
      ["117EQ", 100, 5000, "2026-10-08", "MFSD203"],
    ]);
  });

  it("an OLDER statement never overwrites a newer one; a newer one does", async () => {
    await importIt([row({ Balance: "90.000", AUM: "4400.00", "Report Date": "01/09/2026" })]);
    expect((await legs()).find((x) => x.code === "117EQ")).toMatchObject({ su: "100", asof: "2026-10-08" });
    await importIt([row({ Balance: "110.000", AUM: "5600.00", "Report Date": "09/10/2026" })]);
    expect((await legs()).find((x) => x.code === "117EQ")).toMatchObject({ su: "110", sv: "5600", asof: "2026-10-09" });
    expect((await legs()).filter((x) => x.code === "117EQ")).toHaveLength(1);
  });

  it("live-NAV revaluation changes the valuation, never the registrar's figures", async () => {
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO scheme_nav (scheme_code, scheme_name, nav, nav_date) VALUES ('117EQ', 'Example Equity Fund - Growth', 60, '2026-10-10') ON CONFLICT (scheme_code) DO UPDATE SET nav = 60, nav_date = '2026-10-10'`);
    });
    await withTenant(t, (tx) => revalueAllFolios(tx));
    const leg = (await legs()).find((x) => x.code === "117EQ");
    expect([Number(leg.value), Number(leg.sv), leg.asof]).toEqual([6600, 5600, "2026-10-09"]);
  });

  it("the portfolio shows both figures and reconciles to its legs; a joint holder adds nothing", async () => {
    const inv = (await withTenant(t, async (tx) => (await tx.execute(sql`SELECT id FROM investors WHERE tenant_id = ${t}::uuid AND pan = ${PAN}`)).rows[0])) as { id: string };
    const folio = (await withTenant(t, async (tx) => (await tx.execute(sql`SELECT id FROM folios WHERE tenant_id = ${t}::uuid`)).rows[0])) as { id: string };
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO folio_holders (tenant_id, folio_id, role, holder_name, source) VALUES (${t}::uuid, ${folio.id}::uuid, 'second', 'Joint Holder', 'registrar')`));
    const v = await withTenant(t, (tx) => valueInvestor(tx, inv.id));
    const eq = v.holdings.find((h) => h.schemeCode === "117EQ")!;
    expect(eq.currentValue).toBe(6600);
    expect(eq.registrar).toEqual({ units: 110, value: 5600, asOf: "2026-10-09", report: "MFSD203" });
    expect(v.currentValue).toBe(v.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0));
    const [aum] = await withTenant(t, async (tx) => (await tx.execute(sql`
      SELECT COALESCE(SUM((leg->>'value')::numeric), 0)::float AS legs FROM folios f CROSS JOIN LATERAL jsonb_array_elements(f.schemes) leg WHERE f.tenant_id = ${t}::uuid`)).rows as any[]);
    expect(v.currentValue).toBe(aum.legs);
  });

  it("registrar AUM: one dated card per registrar × ARN; no firm total without a CAMS statement", async () => {
    const r = await withTenant(t, (tx) => getRegistrarAum(tx, { tenantId: t }, { asOf: "2026-10-10" }));
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ rta: "kfintech", arn: ARN, asOf: "2026-10-09", fullBook: true, sourceValue: 5600, stale: false });
    // The nil 117DB leg stands on the 08-Oct statement, which the 09-Oct full book did not restate: reported, not counted.
    expect(r.legsOnOlderStatements).toBe(1);
    // Only KFintech folios exist, so KFintech is all that is required: the total stands.
    expect(r.headline).toMatchObject({ value: 5600, reasons: [] });
    // A CAMS folio with no CAMS statement withholds it, with the reason.
    await withTenant(t, async (tx) => {
      const inv = (await tx.execute(sql`SELECT id FROM investors WHERE tenant_id = ${t}::uuid LIMIT 1`)).rows[0] as { id: string };
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${t}::uuid, ${inv.id}::uuid, '8001', 'B', 'AMC B', 'cams')`);
    });
    const r2 = await withTenant(t, (tx) => getRegistrarAum(tx, { tenantId: t }, { asOf: "2026-10-10" }));
    expect(r2.headline.value).toBeNull();
    expect(r2.headline.reasons).toContain(`no statement for cams/${ARN}`);
    // A filtered view never claims to be a full book.
    const r3 = await withTenant(t, (tx) => getRegistrarAum(tx, { tenantId: t, categories: ["A"] }, { asOf: "2026-10-10" }));
    expect(r3.filtered).toBe(true);
  });
});
