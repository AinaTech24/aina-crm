/**
 * Pilot preflight — the live AUM figure says what it is made of: holdings at
 * today's AMFI NAV, holdings carried at the registrar's dated statement value
 * (scheme not mapped — every CAMS code until approved), and holdings at an
 * older NAV. The tile never calls the sum "today's NAV" unless it all is.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("AUM composition (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let M: typeof import("@/lib/metrics/aum-composition");
  const t = randomUUID();
  const CODES = { live: "9L0001", old: "9L0002" };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    M = await import("@/lib/metrics/aum-composition");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO scheme_nav (scheme_code, scheme_name, amc_name, nav, nav_date) VALUES
        (${CODES.live}, 'Omicron Equity Fund - Regular Plan - Growth', 'Omicron Mutual Fund', 25, CURRENT_DATE - 1),
        (${CODES.old}, 'Omicron Closed Fund - Regular Plan - Growth', 'Omicron Mutual Fund', 12, DATE '2024-03-28') ON CONFLICT (scheme_code) DO NOTHING`);
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Composition', 'Composition', ${"ARN-AC" + t.slice(0, 6)})`);
      const inv = randomUUID();
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, status) VALUES (${inv}::uuid, ${t}::uuid, 'RRRPA1234R', 'Composition Client', 'active')`);
      await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, amc_code, amc_name, folio_number, rta, schemes) VALUES
        (${t}::uuid, ${inv}::uuid, '199', 'AMC 199', '99100001', 'kfintech', ${JSON.stringify([
          { schemeCode: CODES.live, rtaSchemeCode: "199EQ", schemeStatus: "resolved_isin", units: 100, nav: 25, value: 2500, sourceValue: 2480, sourceAsOf: "2026-10-08" },
          // A legacy holding (imported before evidence tracking) priced at a NAV AMFI last published in March 2024.
          { schemeCode: CODES.old, schemeName: "Omicron Closed Fund", units: 10, nav: 12, value: 120 },
        ])}::jsonb),
        (${t}::uuid, ${inv}::uuid, 'ZQ', 'AMC ZQ', '8810001/11', 'cams', ${JSON.stringify([
          { schemeCode: "ZQ01", rtaSchemeCode: "ZQ01", schemeStatus: "unresolved", units: 50, value: 5000, sourceValue: 5000, sourceAsOf: "2026-05-18" },
          { schemeCode: "ZQ02", rtaSchemeCode: "ZQ02", schemeStatus: "unresolved", units: 0, value: 0, sourceValue: 0, sourceAsOf: "2026-05-18" },
        ])}::jsonb)`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const table of ["folios", "investors"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${CODES.live}, ${CODES.old})`);
  });

  it("splits the same holdings into today's NAV, registrar statement value and an older NAV, each dated", async () => {
    const c = await withTenant(t, (tx) => M.getAumComposition(tx, { tenantId: t }));
    expect(c.live).toMatchObject({ value: 2500, holdings: 1 });
    expect(c.registrar).toMatchObject({ value: 5000, holdings: 1, oldest: "2026-05-18", newest: "2026-05-18" });
    expect(c.stale).toMatchObject({ value: 120, holdings: 1, newest: "2024-03-28" });
    expect(c.total).toBe(7620);
    expect(c.allLive).toBe(false);
    const note = M.aumCompositionNote(c, (n) => `₹${n}`, (d) => d);
    expect(note).toBe("₹2500 at today's NAV · ₹5000 at registrar statement value (2026-05-18; scheme not mapped or not re-priced) · ₹120 at an older NAV (2024-03-28)");
  });

  it("all at today's NAV: no note, the tile may say Today", () => {
    const c = { total: 10, live: { value: 10, holdings: 1, oldest: "2026-10-08", newest: "2026-10-08" }, registrar: { value: 0, holdings: 0, oldest: null, newest: null }, stale: { value: 0, holdings: 0, oldest: null, newest: null }, allLive: true };
    expect(M.aumCompositionNote(c, String, String)).toBeNull();
  });
});
