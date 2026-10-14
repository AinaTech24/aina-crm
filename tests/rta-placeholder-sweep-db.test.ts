/**
 * main's empty-placeholder sweep (lib/rta/placeholder-sweep.ts, b795fdba) inside
 * the RTA release: it is a `derived` writer on registrar data, so it asks the
 * release's write guard and leaves a stopped firm untouched; its schema-driven
 * reference check counts the release's own tables. Real PostgreSQL, app role.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("RTA placeholder sweep under the release's write guard (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let P: typeof import("@/lib/rta/placeholder-sweep");
  const t = randomUUID(), halted = randomUUID();
  const ids = { empty: randomUUID(), young: randomUUID(), heldByRelease: randomUUID(), haltedEmpty: randomUUID() };
  const live = async (tenant: string, id: string) =>
    withTenant(tenant, async (tx) => (await tx.execute(sql`SELECT deleted_at IS NULL AS live FROM investors WHERE id = ${id}::uuid`)).rows[0] as { live: boolean });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    P = await import("@/lib/rta/placeholder-sweep");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES
      (${t}::uuid, 'Sweep firm', 'Sweep firm', ${"ARN-SW" + t.slice(0, 5)}), (${halted}::uuid, 'Halted firm', 'Halted firm', ${"ARN-SH" + halted.slice(0, 5)})`));
    const placeholder = (tenant: string, id: string, ageMinutes: number) => withTenant(tenant, (tx) => tx.execute(sql`
      INSERT INTO investors (id, tenant_id, pan, name, rta_nopan_key, created_at)
      VALUES (${id}::uuid, ${tenant}::uuid, NULL, 'Placeholder', ${"NOPAN:FOLIO:" + id.slice(0, 8)}, now() - make_interval(mins => ${ageMinutes}::int))`));
    await placeholder(t, ids.empty, 120);
    await placeholder(t, ids.young, 5);
    await placeholder(t, ids.heldByRelease, 120);
    await placeholder(halted, ids.haltedEmpty, 120);
    // A release table (validate-first SIP registrations) refers to one of them.
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO rta_sip_registrations (tenant_id, registration_key, rta, kind, state, described, confidence, as_of, investor_id)
      VALUES (${t}::uuid, ${"reg:kfintech:119:" + t.slice(0, 6)}, 'kfintech', 'sip', 'UNKNOWN', false, 'unverified', current_date, ${ids.heldByRelease}::uuid)`));
    const C = await import("@/lib/rta/posting/controls");
    await C.setPostingHalt({ scope: halted, halted: true, reason: "test: firm stopped", changedBy: randomUUID() });
  });

  afterAll(async () => {
    const tryRun = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    for (const tn of [t, halted]) {
      for (const table of ["rta_sip_registrations", "audit_log", "investors"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${tn}'`));
      await tryRun(sql`DELETE FROM rta_posting_controls WHERE scope = ${tn}`);
      await tryRun(sql`DELETE FROM tenants WHERE id = ${tn}::uuid`);
    }
  });

  it("an empty, old placeholder goes to the Trash (audited); a young one and one a release table refers to stay", async () => {
    const n = await withTenant(t, (tx) => P.retireEmptyPlaceholders(tx, t));
    expect(n).toBe(1);
    expect((await live(t, ids.empty)).live).toBe(false);
    expect((await live(t, ids.young)).live).toBe(true);
    expect((await live(t, ids.heldByRelease)).live).toBe(true);
    const audit = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${ids.empty}::uuid AND action = 'investor.trash'`)).rows[0] as { n: number });
    expect(audit.n).toBe(1);
  });

  it("a firm whose RTA writes are stopped is left exactly as it is", async () => {
    const n = await withTenant(halted, (tx) => P.retireEmptyPlaceholders(tx, halted));
    expect(n).toBe(0);
    expect((await live(halted, ids.haltedEmpty)).live).toBe(true);
  });
});
