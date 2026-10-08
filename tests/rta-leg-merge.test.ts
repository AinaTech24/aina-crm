/**
 * A folio's holding must be stored once, whichever file names it.
 *
 * The CAMS AUM statement names a holding by the registrar's code ("D157") and
 * no scheme name; the master and holdings files by AMFI code and name. The
 * merge matched on code or name only, so the folio kept both legs and the
 * holding was valued twice (Nimesh C Shah, 8 Oct 2026: 158 legs, Rs 8.19 Cr).
 * And two BLANK names compared equal, so one nameless leg replaced every
 * nameless leg in the folio.
 *
 * DB-backed: needs a migrated Postgres in TEST_DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { RtaFolioRecord } from "@/lib/rta/types";
import { dedupeLegs } from "../scripts/dedupe-folio-legs";

type Leg = { schemeCode: string; schemeName: string; units: number; nav?: number; value?: number; arn?: string };

describe("dedupeLegs (the repair for folios already stored twice)", () => {
  const codes = (legs: Leg[]) => dedupeLegs(legs).kept.map((l) => `${l.schemeCode}/${l.arn ?? "-"}`);
  it("drops a nameless registrar-code leg repeating a named one, keeping the AMFI code", () => {
    expect(codes([
      { schemeCode: "D157", schemeName: "", units: 25862.605, value: 58 },
      { schemeCode: "105989", schemeName: "DSP Small Cap", units: 25862.605, value: 59, arn: "ARN-1" },
    ])).toEqual(["105989/ARN-1"]);
  });
  it("treats ARN '0' as no ARN", () => {
    expect(codes([
      { schemeCode: "1", schemeName: "A", units: 10, arn: "ARN-1" },
      { schemeCode: "X1", schemeName: "A x", units: 10, arn: "0" },
    ])).toEqual(["1/ARN-1"]);
  });
  it("keeps a split across two ARNs and two named options under one ARN", () => {
    expect(codes([
      { schemeCode: "1", schemeName: "A", units: 10, arn: "ARN-1" },
      { schemeCode: "1", schemeName: "A", units: 10, arn: "ARN-2" },
    ])).toHaveLength(2);
    expect(codes([
      { schemeCode: "1", schemeName: "A growth", units: 10, arn: "ARN-1" },
      { schemeCode: "2", schemeName: "A idcw", units: 10, arn: "ARN-1" },
    ])).toHaveLength(2);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("holdings import merges legs of one folio", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  let n = 0;

  const rec = (folio: string, schemes: Leg[]): RtaFolioRecord =>
    ({
      rta: "cams", folioNumber: folio, amcCode: "D", amcName: "DSP",
      investor: { pan: "AAAPL1111A", name: "LEG TEST CLIENT", category: "individual" },
      nominees: [], bank: {}, schemes, aum: schemes.reduce((t, s) => t + (s.value ?? 0), 0),
    }) as unknown as RtaFolioRecord;
  const run = (records: RtaFolioRecord[]) => withSystem((tx) => importRtaFolios(tx, tenant, records, { kind: "holdings" }));
  const legs = async (folio: string) =>
    withSystem(async (tx) => ((await tx.execute(sql`
      SELECT schemes, aum::numeric AS aum FROM folios WHERE tenant_id = ${tenant}::uuid AND folio_number = ${folio}
    `)).rows[0] as { schemes: Leg[]; aum: string }));
  const folio = () => `F-LEG-${++n}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    ({ sql } = await import("drizzle-orm"));
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Leg Merge Test', 'Leg Merge Test', ${"ARN-LM-" + tenant.slice(0, 6)})`));
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["audit_log", "transactions", "sips", "folios", "investors"]) {
      await withSystem((tx) => tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`)).catch(() => {});
    }
    await withSystem((tx) => tx.execute(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`)).catch(() => {});
  });

  it("a nameless registrar-code leg restates the named leg with the same units", async () => {
    const f = folio();
    await run([rec(f, [{ schemeCode: "105989", schemeName: "DSP Small Cap Fund - Regular - Growth", units: 25862.605, nav: 226.734, value: 5863867.67 }])]);
    await run([rec(f, [{ schemeCode: "D157", schemeName: "", units: 25862.605, nav: 224.899, value: 5816410.05 }])]);
    const r = await legs(f);
    expect(r.schemes).toHaveLength(1);
    expect(Number(r.aum)).toBeCloseTo(5816410.05, 1);
  });

  it("two nameless legs of different schemes both stay", async () => {
    const f = folio();
    await run([rec(f, [
      { schemeCode: "D157", schemeName: "", units: 100, value: 1000 },
      { schemeCode: "D201", schemeName: "", units: 200, value: 2000 },
    ])]);
    await run([rec(f, [{ schemeCode: "D157", schemeName: "", units: 101, value: 1010 }])]);
    const r = await legs(f);
    expect(r.schemes.map((s) => s.schemeCode).sort()).toEqual(["D157", "D201"]);
    expect(Number(r.aum)).toBeCloseTo(3010, 1);
  });

  it("a split across two real ARNs with equal units is kept as two slices", async () => {
    const f = folio();
    await run([rec(f, [{ schemeCode: "105989", schemeName: "DSP Small Cap", units: 50, value: 500, arn: "ARN-1" }])]);
    await run([rec(f, [{ schemeCode: "105989", schemeName: "DSP Small Cap", units: 50, value: 500, arn: "ARN-2" }])]);
    expect((await legs(f)).schemes).toHaveLength(2);
  });
});
