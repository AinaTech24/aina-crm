/**
 * The family panel on a policy: a client's household and a search for one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("family lookup against the database", () => {
  const tenant = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const family = crypto.randomUUID();
  const head = crypto.randomUUID();
  const wife = crypto.randomUUID();
  const lone = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let lk: typeof import("@/lib/families/lookup");
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const session = () => ({ userId: owner, tenantId: tenant, roles: ["owner"], email: "o@t.in", name: "Owner" }) as any;
  const ctx = { userId: owner, roles: ["owner"] } as any;
  const pan = (n: string) => "ZZZP" + n + tenant.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "A") + "9Z";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    lk = await import("@/lib/families/lookup");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Fam Firm', 'Fam Firm', ${"ARN-FM-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, ${"fm-" + owner.slice(0, 6) + "@t.in"}, 'Owner', ARRAY['owner']::text[], 'active')`);
    await q(sql`INSERT INTO families (id, tenant_id, family_name, head_name, family_code) VALUES (${family}::uuid, ${tenant}::uuid, 'Patel Family', 'Ramesh Patel', 'FAM-0001')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, dob, gender, family_id, family_role) VALUES
      (${head}::uuid, ${tenant}::uuid, ${pan("A")}, 'Ramesh Patel', '1970-05-02', 'M', ${family}::uuid, 'self'),
      (${wife}::uuid, ${tenant}::uuid, ${pan("B")}, 'Sita Patel', '1974-09-30', 'F', ${family}::uuid, 'spouse'),
      (${lone}::uuid, ${tenant}::uuid, ${pan("C")}, 'Solo Person', '1990-01-01', 'M', NULL, NULL)`);
    await q(sql`UPDATE families SET primary_investor_id = ${head}::uuid WHERE id = ${family}::uuid`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`UPDATE families SET primary_investor_id = NULL WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM families WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("a client's household lists everyone, the head first, with gender and date of birth", async () => {
    const f = await withTenant(tenant, (tx) => lk.familyOfClient(tx as any, session(), wife), ctx);
    expect(f?.name).toBe("Patel Family");
    expect(f?.members.map((m) => m.name)).toEqual(["Ramesh Patel", "Sita Patel"]);
    expect(f?.members[0]).toMatchObject({ isHead: true, gender: "Male", dob: "1970-05-02", familyRole: "self" });
    expect(f?.members[1]).toMatchObject({ isHead: false, gender: "Female", dob: "1974-09-30", familyRole: "spouse" });
  });

  it("a client with no family has none", async () => {
    expect(await withTenant(tenant, (tx) => lk.familyOfClient(tx as any, session(), lone), ctx)).toBeNull();
  });

  it("a search finds the household by its name, its code or any member", async () => {
    for (const term of ["Patel Fam", "FAM-0001", "Sita"]) {
      const r = await withTenant(tenant, (tx) => lk.searchFamilies(tx as any, session(), term), ctx);
      expect(r.map((x) => x.id)).toEqual([family]);
      expect(r[0].members).toHaveLength(2);
    }
    expect(await withTenant(tenant, (tx) => lk.searchFamilies(tx as any, session(), "Nobody"), ctx)).toEqual([]);
  });
});
