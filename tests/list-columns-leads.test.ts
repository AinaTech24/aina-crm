/**
 * The Leads list's "Add a field" catalog and the loader behind it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEAD_EXTRA_FIELDS, allowedLeadExtraKeys, leadExtraOptions } from "@/lib/list-columns/lead-fields";
import { leadExtraColumns } from "@/lib/leads/table-columns";

describe("lead extra fields", () => {
  it("every field has a unique key, a label, a group and an expression", () => {
    const keys = LEAD_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(LEAD_EXTRA_FIELDS.every((f) => f.label && f.expr && f.group)).toBe(true);
  });

  it("offers nothing the table already draws as a column", () => {
    const drawn = new Set(leadExtraColumns([]).map((c) => c.key));
    expect(LEAD_EXTRA_FIELDS.filter((f) => drawn.has(f.key))).toEqual([]);
    const labels = new Set(leadExtraColumns([]).map((c) => c.label.toLowerCase()));
    expect(LEAD_EXTRA_FIELDS.filter((f) => labels.has(f.label.toLowerCase()))).toEqual([]);
  });

  it("only offered keys are allowed", () => {
    const allowed = allowedLeadExtraKeys(leadExtraOptions());
    expect(allowed.has("owner_email")).toBe(true);
    expect(allowed.has("l.name; drop table leads")).toBe(false);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadLeadExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const lead = crypto.randomUUID();
  const lead2 = crypto.randomUUID();
  const client = crypto.randomUUID();
  const sub = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/lead-fields").loadLeadExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadLeadExtra: load } = await import("@/lib/list-columns/lead-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Lead Col Firm', 'Lead Col Firm', ${"ARN-LC-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, branch_id, email, name, phone, department, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, ${branch}::uuid, ${"lc-" + owner.slice(0, 6) + "@t.in"}, 'Riya RM', '9888877777', 'Sales', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO sub_distributors (id, tenant_id, name, code, mobile) VALUES (${sub}::uuid, ${tenant}::uuid, 'Sub One', 'SD-1', '9000000001')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, status) VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPL" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Became Client', 'active')`);
    await q(sql`INSERT INTO leads (id, tenant_id, branch_id, name, owner_id, sub_distributor_id, utm_params, expected_business_amount, onboarding_route,
                                   created_at, last_contact_at, next_follow_up_at, stage_changed_at, converted_investor_id)
                VALUES (${lead}::uuid, ${tenant}::uuid, ${branch}::uuid, 'Test Lead', ${owner}::uuid, ${sub}::uuid,
                        '{"term":"sip plan","content":"banner-a"}'::jsonb, 1234567, 'exchange',
                        now() - interval '10 days', now() - interval '3 days', now() - interval '2 days', now() - interval '5 days', ${client}::uuid)`);
    await q(sql`INSERT INTO leads (id, tenant_id, name) VALUES (${lead2}::uuid, ${tenant}::uuid, 'Bare Lead')`);
    await q(sql`INSERT INTO tasks (tenant_id, subject_type, type, title, related_lead_id, status) VALUES (${tenant}::uuid, 'lead', 'follow_up', 'Call back', ${lead}::uuid, 'open')`);
    await q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, type, title, status) VALUES (${tenant}::uuid, 'lead', ${lead}::uuid, 'follow_up', 'Send docs', 'open')`);
    await q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, type, title, status) VALUES (${tenant}::uuid, 'lead', ${lead}::uuid, 'follow_up', 'Done one', 'completed')`);
    await q(sql`INSERT INTO review_meetings (tenant_id, lead_id, meeting_type, meeting_date, meeting_mode, status) VALUES (${tenant}::uuid, ${lead}::uuid, 'discovery', now() + interval '2 days', 'phone', 'scheduled')`);
    await q(sql`INSERT INTO review_meetings (tenant_id, lead_id, meeting_type, meeting_date, meeting_mode, status) VALUES (${tenant}::uuid, ${lead}::uuid, 'discovery', now() - interval '2 days', 'phone', 'cancelled')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM review_meetings WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tasks WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM leads WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM sub_distributors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(LEAD_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [lead, lead2], [...all], all));
    const v = got[lead];
    expect(v.owner_email).toMatch(/^lc-.*@t\.in$/);
    expect(v.owner_phone).toBe("9888877777");
    expect(v.owner_branch).toBe("Surat");
    expect(v.owner_department).toBe("Sales");
    expect(v.branch_code).toBe("SRT");
    expect(v.utm_term).toBe("sip plan");
    expect(v.utm_content).toBe("banner-a");
    expect(v.sub_dist_code).toBe("SD-1");
    expect(v.expected_business).toMatch(/12,34,567/);
    expect(v.onboarding_route).toMatch(/^Exchange/);
    expect(v.converted).toBe("Yes");
    expect(v.client_name).toBe("Became Client");
    expect(v.client_status).toBe("active");
    expect(v.open_tasks).toBe("2");
    expect(v.meetings).toBe("1");
    expect(v.next_meeting).toMatch(/^\d{2} \w{3} \d{4}, \d{2}:\d{2} [AP]M$/);
    expect(v.age_days).toBe("10");
    expect(v.days_in_stage).toBe("5");
    expect(v.days_since_contact).toBe("3");
    expect(v.fu_overdue_days).toBe("2");
    // A lead with nothing set shows blanks, counts of zero, and "No".
    const bare = got[lead2];
    expect(bare.owner_email).toBeUndefined();
    expect(bare.open_tasks).toBe("0");
    expect(bare.converted).toBe("No");
    expect(bare.fu_overdue_days).toBeUndefined();
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [lead], ["owner_email", "l.name; drop table leads"], new Set(["owner_email"])));
    expect(Object.keys(got[lead])).toEqual(["owner_email"]);
  });
});
