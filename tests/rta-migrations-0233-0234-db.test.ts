/**
 * Phase 3D migration review — what 0233 (RTA staging) and 0234 (folio
 * holders) promise about deletes and tenancy, proved on a real Postgres.
 *
 *  - Purging an RTA import (the two purge routes hard-delete rta_file_imports)
 *    keeps its shadow batch and only clears the link (ON DELETE SET NULL).
 *  - A folio_holders row cannot point at another firm's folio or client, even
 *    in system context where RLS does not stop it (tenant-consistency trigger).
 *  - Purging a client keeps the holder row and clears its link; purging the
 *    folio removes the holder rows that describe it.
 *  - The new investors columns accept only their documented values.
 * Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("migrations 0233 / 0234 — deletes and tenancy (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;

  const tA = randomUUID();
  const tB = randomUUID();
  const invA = randomUUID();
  const invB = randomUUID();
  const folioA = randomUUID();
  const folioB = randomUUID();
  const importA = randomUUID();
  const batchA = randomUUID();

  const errOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return "";
    } catch (e: any) {
      return String(e?.cause?.message ?? e?.message ?? e);
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    await withSystem(async (tx) => {
      for (const [t, inv, folio, n] of [[tA, invA, folioA, "A"], [tB, invB, folioB, "B"]] as const) {
        await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, ${"Mig " + n}, ${"Mig " + n}, ${"ARN-MG" + n + t.slice(0, 6)})`);
        await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${inv}::uuid, ${t}::uuid, NULL, ${"Mig Client " + n})`);
        await tx.execute(sql`INSERT INTO folios (id, tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${folio}::uuid, ${t}::uuid, ${inv}::uuid, ${"MIG/" + n}, 'B', 'AMC B', 'cams')`);
      }
    });
  });

  afterAll(async () => {
    const tryRun = async (stmt: ReturnType<typeof sql>) => {
      try {
        await withSystem((tx) => tx.execute(stmt));
      } catch {
        /* best effort */
      }
    };
    for (const t of [tA, tB]) {
      for (const table of ["folio_holders", "rta_staging_batches", "rta_file_imports", "folios"]) {
        await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
      }
      await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    }
  });

  it("0233: purging an import keeps its shadow batch and clears only the link", async () => {
    await withTenant(tA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key)
        VALUES (${importA}::uuid, ${tA}::uuid, 'cams', 'daily_transaction_feed', '2026-10-01', '2026-10-01', 'synthetic.txt', 'synthetic/key')`);
      await tx.execute(sql`
        INSERT INTO rta_staging_batches (id, tenant_id, import_id, file_name, file_ref, file_checksum, parser_version, state)
        VALUES (${batchA}::uuid, ${tA}::uuid, ${importA}::uuid, 'synthetic.txt', 'synthetic/key', 'synthetic-checksum', 'test', 'uploaded')`);
      await tx.execute(sql`DELETE FROM rta_file_imports WHERE id = ${importA}::uuid`);
    });
    const left = await withTenant(tA, async (tx) =>
      (await tx.execute(sql`SELECT tenant_id::text AS tenant_id, import_id FROM rta_staging_batches WHERE id = ${batchA}::uuid`)).rows as Array<{ tenant_id: string; import_id: string | null }>,
    );
    expect(left).toEqual([{ tenant_id: tA, import_id: null }]);
  });

  it("0234: a holder row may not point at another firm's folio or client, even in system context", async () => {
    const insert = (tenant: string, folio: string, investor: string | null) =>
      withSystem((tx) => tx.execute(sql`
        INSERT INTO folio_holders (tenant_id, folio_id, role, investor_id, source)
        VALUES (${tenant}::uuid, ${folio}::uuid, 'guardian', ${investor}::uuid, 'staff')`));
    expect(await errOf(insert(tA, folioB, null))).toMatch(/not a folio of tenant/);
    expect(await errOf(insert(tA, folioA, invB))).toMatch(/not a client of tenant/);
    expect(await errOf(insert(tA, folioA, invA))).toBe("");
    // Re-pointing an existing row across firms is refused the same way.
    expect(await errOf(withSystem((tx) => tx.execute(sql`UPDATE folio_holders SET investor_id = ${invB}::uuid WHERE tenant_id = ${tA}::uuid`)))).toMatch(/not a client of tenant/);
    // Under RLS the other firm cannot see it.
    const seen = await withTenant(tB, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM folio_holders WHERE tenant_id = ${tA}::uuid`)).rows[0] as { n: number });
    expect(seen.n).toBe(0);
  });

  it("0234: purging the client keeps the holder row; purging the folio removes it", async () => {
    // A second client of firm A as the guardian.
    const g = randomUUID();
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name) VALUES (${g}::uuid, ${tA}::uuid, NULL, 'Mig Guardian')`);
      await tx.execute(sql`DELETE FROM folio_holders WHERE tenant_id = ${tA}::uuid`);
      await tx.execute(sql`INSERT INTO folio_holders (tenant_id, folio_id, role, investor_id, holder_name, source) VALUES (${tA}::uuid, ${folioA}::uuid, 'guardian', ${g}::uuid, 'Mig Guardian', 'staff')`);
      await tx.execute(sql`DELETE FROM investors WHERE id = ${g}::uuid`);
    });
    const after = await withSystem(async (tx) => (await tx.execute(sql`SELECT investor_id, holder_name FROM folio_holders WHERE tenant_id = ${tA}::uuid`)).rows);
    expect(after).toEqual([{ investor_id: null, holder_name: "Mig Guardian" }]);
    await withSystem((tx) => tx.execute(sql`DELETE FROM folios WHERE id = ${folioA}::uuid`));
    const gone = await withSystem(async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM folio_holders WHERE tenant_id = ${tA}::uuid`)).rows[0] as { n: number });
    expect(gone.n).toBe(0);
  });

  it("0234 (Phase 3E): no PAN in clear, one current role per person, rows closed and replaced — never edited", async () => {
    const f = randomUUID();
    await withSystem((tx) => tx.execute(sql`INSERT INTO folios (id, tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${f}::uuid, ${tB}::uuid, ${invB}::uuid, 'MIG/B2', 'B', 'AMC B', 'cams')`));
    const ins = (o: string) => withSystem((tx) => tx.execute(sql.raw(`INSERT INTO folio_holders (tenant_id, folio_id, source, ${o})`)));
    // A PAN in clear or a malformed mask is refused.
    expect(await errOf(ins(`role, holder_pan_token) VALUES ('${tB}', '${f}', 'staff', 'second', 'ABCPD1234E'`))).toMatch(/check constraint/);
    expect(await errOf(ins(`role, holder_pan_masked) VALUES ('${tB}', '${f}', 'staff', 'second', 'ABCPD1234E'`))).toMatch(/check constraint/);
    expect(await errOf(ins(`role, holder_pan_token, holder_pan_masked, holder_name) VALUES ('${tB}', '${f}', 'staff', 'second', 'pt1:abc', '******234E', 'Joint Holder'`))).toBe("");
    // The same person cannot hold two current roles on one folio.
    expect(await errOf(ins(`role, holder_pan_token) VALUES ('${tB}', '${f}', 'staff', 'third', 'pt1:abc'`))).toMatch(/folio_holders_current_pan_uidx/);
    expect(await errOf(ins(`role, investor_id) VALUES ('${tB}', '${f}', 'staff', 'first', '${invB}'`))).toBe("");
    expect(await errOf(ins(`role, investor_id) VALUES ('${tB}', '${f}', 'staff', 'guardian', '${invB}'`))).toMatch(/folio_holders_current_investor_uidx/);
    // What the registrar printed is never edited; the row is closed instead.
    const upd = (set: string) => withSystem((tx) => tx.execute(sql.raw(`UPDATE folio_holders SET ${set} WHERE folio_id = '${f}' AND role = 'second'`)));
    expect(await errOf(upd(`holder_name = 'Someone Else'`))).toMatch(/closed and replaced, never edited/);
    expect(await errOf(upd(`role = 'third'`))).toMatch(/closed and replaced, never edited/);
    expect(await errOf(upd(`effective_to = '2026-10-08', closed_reason = 'holder changed'`))).toBe("");
    expect(await errOf(upd(`effective_to = '2026-10-09'`))).toMatch(/closed and replaced, never edited/);
    // A closed row frees the role for its successor.
    expect(await errOf(ins(`role, holder_name) VALUES ('${tB}', '${f}', 'staff', 'second', 'New Joint Holder'`))).toBe("");
  });

  it("0234: the investors columns take only their documented values", async () => {
    const set = (col: "identity_confidence" | "majority_status", v: string) =>
      withSystem((tx) => tx.execute(sql`UPDATE investors SET ${sql.raw(col)} = ${v} WHERE id = ${invB}::uuid`));
    expect(await errOf(set("identity_confidence", "provisional_folio"))).toBe("");
    expect(await errOf(set("majority_status", "major_pending_regularisation"))).toBe("");
    expect(await errOf(set("identity_confidence", "guessed"))).toMatch(/investors_identity_confidence_ck/);
    expect(await errOf(set("majority_status", "adult"))).toMatch(/investors_majority_status_ck/);
  });
});
