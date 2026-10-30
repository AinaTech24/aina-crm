/**
 * The Opportunity pipeline and Service requests cards (lib/metrics). Needs a
 * migrated Postgres in TEST_DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("pipeline cards", () => {
  const tenant = randomUUID();
  const client = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let getOpportunityPipeline: typeof import("@/lib/metrics/opportunities").getOpportunityPipeline;
  let getServiceRequestBreakdown: typeof import("@/lib/metrics/service").getServiceRequestBreakdown;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const period = { from: "2026-10-01", to: "2026-10-31", label: "Oct" } as any;

  const opp = (product: string, status = "open", extra = "") =>
    q(sql.raw(`INSERT INTO client_opportunities (tenant_id, investor_id, product, pipeline, status, expected_value ${extra ? ", " + extra.split("=")[0] : ""})
               VALUES ('${tenant}', '${client}', '${product}', 'general', '${status}', 1000 ${extra ? ", " + extra.split("=")[1] : ""})`));
  const sr = (no: string, type: string, status: string, createdAt: string) =>
    q(sql.raw(`INSERT INTO service_requests (tenant_id, ticket_no, type, subject, status, created_at, sla_resolution_at)
               VALUES ('${tenant}', '${no}', '${type}', 'x', '${status}', ${createdAt}, now() + interval '5 days')`));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ getOpportunityPipeline } = await import("@/lib/metrics/opportunities"));
    ({ getServiceRequestBreakdown } = await import("@/lib/metrics/service"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Cards', 'Cards', ${"ARN-PC-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan) VALUES (${client}::uuid, ${tenant}::uuid, 'AAAAA1111A', 'Asha', false)`);

    await opp("nps"); // open, no journey instance → "Need identified"
    await opp("fd_bonds_ncd"); // open
    await opp("life_insurance", "open", "parked_at=now()"); // open but parked → Later
    await opp("health_insurance", "won", "won_at='2026-10-10'");
    await opp("general_insurance", "lost", "lost_at='2026-10-12'");
    await opp("other", "won", "won_at='2026-08-01'"); // won outside the period

    await sr("S-1", "statement_request", "open", "'2026-10-02'");
    await sr("S-2", "statement_request", "escalated", "'2026-10-03'");
    await sr("S-3", "kyc_update", "waiting_customer", "'2026-10-04'");
    await sr("S-4", "kyc_update", "closed", "'2026-10-05'");
    await sr("S-5", "other", "open", "'2026-09-01'");
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["client_opportunities", "service_requests", "investors"]) await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("the opportunity pipeline counts open by board column, parked ones as Later, and closed in the period", async () => {
    const m = await withSystem((tx) => getOpportunityPipeline(tx, { tenantId: tenant } as any, period));
    expect(m.open).toBe(3);
    expect(m.byColumn.identified?.n).toBe(2);
    expect(m.byColumn.later?.n).toBe(1);
    expect(m.openValue).toBe(3000);
    expect(m.won).toBe(1); // the August one is outside the period
    expect(m.lost).toBe(1);
    expect(m.conversion).toBe(0.5);
    expect(m.noFollowUp).toBe(3);
  });

  it("service requests: the backlog, by type, and raised / closed in the period", async () => {
    const s = await withSystem((tx) => getServiceRequestBreakdown(tx, { tenantId: tenant } as any, period));
    expect(s.open).toBe(2); // S-1, S-5
    expect(s.escalated).toBe(1);
    expect(s.waiting).toBe(1);
    expect(s.pastSla).toBe(0);
    expect(s.raised).toBe(4); // S-1 … S-4 were raised in October; S-5 in September
    expect(s.closed).toBe(1);
    expect(s.byType[0]).toEqual({ type: "statement_request", n: 2 });
  });
});
