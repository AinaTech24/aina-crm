/**
 * A client may have several open opportunities for one product (the firm's
 * request of 2026-11-07 — a second SIP, a top-up). The one thing never made
 * twice is the same click.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("a second opportunity for the same product", () => {
  const tenant = randomUUID();
  const user = randomUUID();
  const investor = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let createOpportunity: typeof import("@/lib/opportunities/journey").createOpportunity;
  const actor = { tenantId: tenant, userId: user };
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ createOpportunity } = await import("@/lib/opportunities/journey"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Opp Firm', 'Opp Firm', ${"ARN-OP-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${user}::uuid, ${tenant}::uuid, ${"op-" + user.slice(0, 6) + "@t.in"}, 'Op User', ARRAY['owner']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, rm_id) VALUES (${investor}::uuid, ${tenant}::uuid, 'Aditya P', ${"ABCPP" + Math.floor(1000 + Math.random() * 8999) + "Q"}, ${user}::uuid)`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM tasks WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM client_opportunities WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("the database no longer holds one open row per (client, product)", async () => {
    const r = await q(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'client_opps_one_open_per_product'`);
    expect(r.rows).toHaveLength(0);
  });

  it("an automatic caller still gets the open one back; a person choosing another gets a new one", async () => {
    const first = await withTenant(tenant, (tx) => createOpportunity(tx, actor, { investorId: investor, product: "health_insurance", reuseOpen: true }));
    expect(first.created).toBe(true);
    const again = await withTenant(tenant, (tx) => createOpportunity(tx, actor, { investorId: investor, product: "health_insurance", reuseOpen: true }));
    expect(again.created).toBe(false);
    expect(again.opportunity.id).toBe(first.opportunity.id);

    // The same person seconds later (a double click) is the same one…
    const click = await withTenant(tenant, (tx) => createOpportunity(tx, actor, { investorId: investor, product: "health_insurance" }));
    expect(click.created).toBe(false);

    // …but another person, or the same one a minute on, may open another.
    const other = randomUUID();
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${other}::uuid, ${tenant}::uuid, ${"op-" + other.slice(0, 6) + "@t.in"}, 'Other', ARRAY['rm']::text[], 'active')`);
    const second = await withTenant(tenant, (tx) => createOpportunity(tx, { tenantId: tenant, userId: other }, { investorId: investor, product: "health_insurance" }));
    expect(second.created).toBe(true);
    expect(second.opportunity.id).not.toBe(first.opportunity.id);

    const open = await q(sql`SELECT count(*)::int AS n FROM client_opportunities WHERE tenant_id = ${tenant}::uuid AND product = 'health_insurance' AND status = 'open'`);
    expect((open.rows[0] as any).n).toBe(2);
  });
});
