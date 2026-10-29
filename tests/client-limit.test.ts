/**
 * The plan's client limit after an RTA import (the firm's decision of
 * 2026-10-26): the import is never cut short; a firm over its limit has its
 * owners told, once a day — lib/billing/client-limit.ts. DB-backed
 * (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("warnIfOverClientLimit", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let warn: typeof import("@/lib/billing/client-limit").warnIfOverClientLimit;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const owner = randomUUID();
  const rm = randomUUID();
  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const told = async () =>
    ((await q(sql`SELECT user_id::text AS u FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'plan.client_limit'`)).rows as Array<{ u: string }>).map((r) => r.u);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ warnIfOverClientLimit: warn } = await import("@/lib/billing/client-limit"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Limit Test', 'Limit Test', ${"ARN-CL-" + tenant.slice(0, 6)})`);
    for (const [id, role] of [[owner, "owner"], [rm, "rm"]] as const) {
      await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status)
                  VALUES (${id}::uuid, ${tenant}::uuid, ${role + "@" + tenant.slice(0, 8) + ".test"}, ${role}, ${`{${role}}`}::text[], 'active')`);
    }
    // Three live clients, one closed, one deleted: three count.
    for (const [name, status, deleted] of [["A", "active", false], ["B", "active", false], ["C", "dormant", false], ["D", "closed", false], ["E", "active", true]] as const) {
      await q(sql`INSERT INTO investors (tenant_id, name, status, deleted_at) VALUES (${tenant}::uuid, ${name}, ${status}, ${deleted ? sql`now()` : sql`NULL`})`);
    }
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of ["notifications", "investors", "users"]) await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("says nothing at or under the limit, or with no limit", async () => {
    expect(await withSystem((tx) => warn(tx, tenant, 3))).toBe(0);
    expect(await withSystem((tx) => warn(tx, tenant, 1e9))).toBe(0);
    expect(await told()).toEqual([]);
  });

  it("over the limit, tells each owner once a day — not the RM", async () => {
    const day = new Date("2026-10-26T06:00:00Z");
    expect(await withSystem((tx) => warn(tx, tenant, 2, day))).toBe(1);
    expect(await withSystem((tx) => warn(tx, tenant, 2, day))).toBe(0);
    expect(await told()).toEqual([owner]);
    expect(await withSystem((tx) => warn(tx, tenant, 2, new Date("2026-10-27T06:00:00Z")))).toBe(1);
  });
});
