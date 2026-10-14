/**
 * main's "a client who holds money is never in the Trash" restore
 * (lib/investors/holds-money.ts, d334b35b) inside the RTA release: it acts on
 * registrar holdings, so it is a `derived` writer and leaves a firm whose RTA
 * writes are stopped exactly as it is. Real PostgreSQL, app role.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("money-holding clients come back from the Trash — unless the firm's RTA writes are stopped (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let H: typeof import("@/lib/investors/holds-money");
  const t = randomUUID(), halted = randomUUID();
  const ids = { holder: randomUUID(), empty: randomUUID(), haltedHolder: randomUUID() };
  const trashed = async (tenant: string, id: string) =>
    withTenant(tenant, async (tx) => (await tx.execute(sql`SELECT deleted_at IS NOT NULL AS trashed FROM investors WHERE id = ${id}::uuid`)).rows[0] as { trashed: boolean });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    H = await import("@/lib/investors/holds-money");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES
      (${t}::uuid, 'Holder firm', 'Holder firm', ${"ARN-HM" + t.slice(0, 5)}), (${halted}::uuid, 'Halted holder firm', 'Halted holder firm', ${"ARN-HH" + halted.slice(0, 5)})`));
    const client = (tenant: string, id: string, aum: number | null) => withTenant(tenant, async (tx) => {
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, deleted_at) VALUES (${id}::uuid, ${tenant}::uuid, NULL, 'Trashed client', now() - interval '2 days')`);
      if (aum != null) await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, aum)
        VALUES (${tenant}::uuid, ${id}::uuid, ${"F" + id.slice(0, 8)}, 'X', 'Test AMC', ${aum})`);
    });
    await client(t, ids.holder, 250000);
    await client(t, ids.empty, null);
    await client(halted, ids.haltedHolder, 250000);
    const C = await import("@/lib/rta/posting/controls");
    await C.setPostingHalt({ scope: halted, halted: true, reason: "test: firm stopped", changedBy: randomUUID() });
  });

  afterAll(async () => {
    const tryRun = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    for (const tn of [t, halted]) {
      for (const table of ["folios", "audit_log", "investors"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${tn}'`));
      await tryRun(sql`DELETE FROM rta_posting_controls WHERE scope = ${tn}`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${tn}::uuid`);
    }
  });

  it("a trashed client holding money is restored (audited); one holding nothing stays in the Trash", async () => {
    const n = await withTenant(t, (tx) => H.restoreTrashedHolders(tx, t));
    expect(n).toBe(1);
    expect((await trashed(t, ids.holder)).trashed).toBe(false);
    expect((await trashed(t, ids.empty)).trashed).toBe(true);
    const audit = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${ids.holder}::uuid AND action = 'investor.restore'`)).rows[0] as { n: number });
    expect(audit.n).toBe(1);
  });

  it("a firm whose RTA writes are stopped is left exactly as it is", async () => {
    const n = await withTenant(halted, (tx) => H.restoreTrashedHolders(tx, halted));
    expect(n).toBe(0);
    expect((await trashed(halted, ids.haltedHolder)).trashed).toBe(true);
  });
});
