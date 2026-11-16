/**
 * Service Requests list: the fields a person can add as columns.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SERVICE_REQUEST_DEFAULT_COLUMNS,
  SERVICE_REQUEST_EXTRA_FIELDS,
  allowedServiceRequestKeys,
  serviceRequestExtraOptions,
} from "@/lib/list-columns/service-request-fields";

describe("service request extra fields", () => {
  it("every field has a unique key, a label and an expression, and none repeats a default column", () => {
    const keys = SERVICE_REQUEST_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SERVICE_REQUEST_EXTRA_FIELDS.every((f) => f.label && f.expr)).toBe(true);
    expect(keys.some((k) => SERVICE_REQUEST_DEFAULT_COLUMNS.includes(k))).toBe(false);
  });

  it("withholds licence-gated client fields, and the client's data from someone with no client access", () => {
    const noEmail = serviceRequestExtraOptions((f) => f !== "email");
    expect(noEmail.some((o) => o.key === "client_email")).toBe(false);
    expect(noEmail.some((o) => o.key === "client_phone")).toBe(true);
    const noClients = serviceRequestExtraOptions(() => true, { canSeeClientData: false });
    expect(noClients.some((o) => o.key.startsWith("client_"))).toBe(false);
    expect(allowedServiceRequestKeys(noClients).has("channel")).toBe(true);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadServiceRequestExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const assignee = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  const ticket = crypto.randomUUID();
  const orphan = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/service-request-fields").loadServiceRequestExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadServiceRequestExtra: load } = await import("@/lib/list-columns/service-request-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'SR Col Firm', 'SR Col Firm', ${"ARN-SR-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rm}::uuid, ${tenant}::uuid, ${"sr-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${assignee}::uuid, ${tenant}::uuid, ${"sa-" + assignee.slice(0, 6) + "@t.in"}, 'Omkar Ops', ARRAY['ops']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, rm_id, branch_id, address)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZSR" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Test Client', 'c@t.in', '9999999999', ${rm}::uuid, ${branch}::uuid,
                        '{"city":"Surat"}'::jsonb)`);
    await q(sql`INSERT INTO service_requests (id, tenant_id, ticket_no, investor_id, type, channel, subject, description, status, assigned_to_user_id,
                  sla_resolution_at, escalated_at, escalated_to_user_id, remarks, csat_rating, sebi_category, scores_ref_no)
                VALUES (${ticket}::uuid, ${tenant}::uuid, 'SR-2026-00001', ${client}::uuid, 'complaint', 'form', 'Late statement', 'Not received', 'escalated', ${assignee}::uuid,
                  '2026-01-05 10:00:00+05:30', '2026-01-06 12:00:00+05:30', ${rm}::uuid, 'Called client', 9, 'Service', 'SCORES-1')`);
    await q(sql`INSERT INTO service_requests (id, tenant_id, ticket_no, type, subject, status, requester_name)
                VALUES (${orphan}::uuid, ${tenant}::uuid, 'SR-2026-00002', 'other', 'Walk-in', 'open', 'Someone Else')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM service_requests WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(SERVICE_REQUEST_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [ticket, orphan], [...all], all, sql`TRUE`));
    const v = got[ticket];
    expect(v.channel).toBe("Online form");
    expect(v.description).toBe("Not received");
    expect(v.sla_resolution).toBe("05 Jan 2026 10:00 AM");
    expect(v.escalated_to).toBe("Riya RM");
    expect(v.breached).toBe("Yes");
    expect(v.csat).toBe("9");
    expect(v.sebi_category).toBe("Service");
    expect(v.scores_ref).toBe("SCORES-1");
    expect(v.client_email).toBe("c@t.in");
    expect(v.client_phone).toBe("9999999999");
    expect(v.client_city).toBe("Surat");
    expect(v.client_rm).toBe("Riya RM");
    expect(v.client_branch).toBe("Surat");
    expect(got[orphan].requester).toBe("Someone Else");
    expect(got[orphan].client_email).toBeUndefined();
  });

  it("a client the viewer may not see is never revealed, and a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) =>
      load(tx as any, [ticket], ["client_email", "channel", "x; drop table service_requests"], new Set(["client_email", "channel"]), sql`FALSE`),
    );
    expect(Object.keys(got[ticket])).toEqual(["channel"]);
  });
});
