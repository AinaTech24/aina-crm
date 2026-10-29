/**
 * A client whose holdings exist only in the transaction ledger (a transaction
 * feed was imported, no holdings / AUM file — so the folio rows have no
 * schemes) must still have an equity exposure: the client page shows the
 * holdings, and the suitability email, the page's suitability panel and the
 * proposal builder have to read the same ones. DB-backed (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadExposureBook", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let load: typeof import("@/lib/investors/exposure-book").loadExposureBook;
  let exposureOf: typeof import("@/lib/investors/asset-class").assetClassExposure;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const ledgerOnly = randomUUID();
  const nothing = randomUUID();
  const eqCode = "T" + tenant.slice(0, 7);
  const debtCode = "T" + tenant.slice(8, 15);
  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ loadExposureBook: load } = await import("@/lib/investors/exposure-book"));
    ({ assetClassExposure: exposureOf } = await import("@/lib/investors/asset-class"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Exposure Test', 'Exposure Test', ${"ARN-EX-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, status) VALUES (${ledgerOnly}::uuid, ${tenant}::uuid, 'Ledger Only', 'active'), (${nothing}::uuid, ${tenant}::uuid, 'No Holdings', 'active')`);
    await q(sql`INSERT INTO scheme_nav (scheme_code, scheme_name, nav, nav_date, scheme_category) VALUES
      (${eqCode}, 'Exposure Test Flexi Cap Fund - Growth', 20, current_date, 'Equity Scheme - Flexi Cap Fund'),
      (${debtCode}, 'Exposure Test Liquid Fund - Growth', 5000, current_date, 'Debt Scheme - Liquid Fund')`);
    const folio = ((await q(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name) VALUES (${tenant}::uuid, ${ledgerOnly}::uuid, 'EX/1', 'EX', 'EX') RETURNING id`)).rows[0] as { id: string }).id;
    await q(sql`INSERT INTO transactions (tenant_id, investor_id, folio_id, folio_number, type, direction, amount, units, order_date, scheme_code, scheme_name, amc_name, status) VALUES
      (${tenant}::uuid, ${ledgerOnly}::uuid, ${folio}::uuid, 'EX/1', 'purchase', 'inflow', 10000, 400, current_date - 60, ${'R' + eqCode}, 'Exposure Test - Flexi Cap Fund - Regular Plan Growth', 'Exposure', 'processed'),
      (${tenant}::uuid, ${ledgerOnly}::uuid, ${folio}::uuid, 'EX/1', 'purchase', 'inflow', 5000, 1, current_date - 40, ${'R' + debtCode}, 'Exposure Test - Liquid Fund - Regular Plan Growth', 'Exposure', 'processed')`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`UPDATE folios SET schemes = '[]'::jsonb WHERE tenant_id = ${tenant}::uuid`);
    for (const table of ["transactions", "folios", "investors"]) await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${eqCode}, ${debtCode})`);
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("reads a ledger-only client's holdings, with categories found through the registrar's own spelling of each scheme", async () => {
    const book = await withSystem((tx) => load(tx, tenant, ledgerOnly));
    const e = exposureOf(book as never);
    expect(e.classifiedPct).toBe(100);
    expect(Math.round(e.equityPct ?? -1)).toBe(62); // 8,000 equity of 13,000
  });

  it("says nothing for a client with no holdings at all", async () => {
    const book = await withSystem((tx) => load(tx, tenant, nothing));
    const e = exposureOf(book as never);
    expect(e.classifiedPct).toBe(0);
    expect(e.equityPct).toBeNull();
  });
});
