/**
 * A recorded fixed deposit shows up on the Fixed Deposits list with its client,
 * and keeps the interest payout date it was given.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("fixed deposits against the database", () => {
  const tenant = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const client = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let svc: typeof import("@/lib/fixed-deposits/service");
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const session = () => ({ userId: owner, tenantId: tenant, roles: ["owner"], email: "o@t.in", name: "Owner" }) as any;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    svc = await import("@/lib/fixed-deposits/service");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'FD Firm', 'FD Firm', ${"ARN-FD-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, ${"fd-" + owner.slice(0, 6) + "@t.in"}, 'Owner', ARRAY['owner']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id) VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPF" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'FD Client', ${owner}::uuid)`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["tasks", "expected_inflows", "fixed_deposits", "audit_log", "notifications", "investors", "users"]) {
      await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("records an FD with its payout date and lists it with the client", async () => {
    const created = await withTenant(tenant, (tx) => svc.createFd(tx as any, session(), {
      investorId: client, issuer: "HDFC Bank", issuerType: "bank", depositDate: "2026-11-17", maturityDate: "2027-11-17",
      principal: 500000, interestRate: 7.25, payout: "quarterly", compounding: "quarterly", interestPayoutDate: "2027-02-17",
      holding: "single", seniorCitizen: false, taxForm: "none", autoRenew: false, status: "active",
    } as any), { userId: owner, roles: ["owner"] } as any);
    expect((created as any).fd?.id).toBeTruthy();

    const { rows, totals } = await withTenant(tenant, (tx) => svc.listFds(tx as any, session(), {}), { userId: owner, roles: ["owner"] } as any);
    expect(rows).toHaveLength(1);
    expect(rows[0].investorName).toBe("FD Client");
    expect(totals.liveCount).toBe(1);
    expect(totals.clients).toBe(1);

    const r = await q(sql`SELECT interest_payout_date::text AS d FROM fixed_deposits WHERE tenant_id = ${tenant}::uuid`);
    expect((r.rows[0] as any).d).toBe("2027-02-17");
  });

  it("an edit can move the payout date, and refuses one outside the deposit", async () => {
    const list = await withTenant(tenant, (tx) => svc.listFds(tx as any, session(), {}), { userId: owner, roles: ["owner"] } as any);
    const id = list.rows[0].id;
    const ok = await withTenant(tenant, (tx) => svc.updateFd(tx as any, session(), id, { interestPayoutDate: "2027-05-17" } as any), { userId: owner, roles: ["owner"] } as any);
    expect((ok as any).fd?.interestPayoutDate).toBe("2027-05-17");
    const bad = await withTenant(tenant, (tx) => svc.updateFd(tx as any, session(), id, { interestPayoutDate: "2029-01-01" } as any), { userId: owner, roles: ["owner"] } as any);
    expect((bad as any).status).toBe(400);
  });
});
