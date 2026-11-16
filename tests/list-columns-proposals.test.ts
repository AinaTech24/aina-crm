/**
 * The Proposals list's "More fields": catalog sanity and the loader against the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROPOSAL_EXTRA_FIELDS, proposalExtraOptions, allowedProposalExtraKeys } from "@/lib/list-columns/proposal-fields";

describe("proposal extra fields", () => {
  it("every field has a unique key, a label and an expression", () => {
    const keys = PROPOSAL_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(PROPOSAL_EXTRA_FIELDS.every((f) => f.label && f.expr)).toBe(true);
  });

  it("no field repeats a default column's key", () => {
    const defaults = ["number", "title", "recipient", "type", "invest", "corpus", "status", "valid_till", "prepared_by", "created", "actions"];
    expect(PROPOSAL_EXTRA_FIELDS.some((f) => defaults.includes(f.key))).toBe(false);
  });

  it("withholds personal data the licence does not allow", () => {
    const opts = proposalExtraOptions((f) => f !== "email" && f !== "pan");
    expect(opts.some((o) => o.key === "email")).toBe(false);
    expect(opts.some((o) => o.key === "pan")).toBe(false);
    expect(opts.some((o) => o.key === "phone")).toBe(true);
    expect(allowedProposalExtraKeys(opts).has("rm")).toBe(true);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadProposalExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  const proposal = crypto.randomUUID();
  const parent = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/proposal-fields").loadProposalExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadProposalExtra: load } = await import("@/lib/list-columns/proposal-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Prop Firm', 'Prop Firm', ${"ARN-PC-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rm}::uuid, ${tenant}::uuid, ${"pc-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, branch_id)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPP" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Test Client', ${rm}::uuid, ${branch}::uuid)`);
    await q(sql`INSERT INTO proposals (id, tenant_id, proposal_number, recipient_type, recipient_name, title, version)
                VALUES (${parent}::uuid, ${tenant}::uuid, 'PR-OLD-1', 'investor', 'Test Client', 'Old', 1)`);
    await q(sql`INSERT INTO proposals (id, tenant_id, branch_id, proposal_number, recipient_type, investor_id, recipient_name, recipient_email, recipient_phone,
                  title, summary, products, risk_rating, status, sent_at, view_count, executed_amount, prepared_by_user_id, parent_proposal_id, version,
                  suitability_override_by_user_id, suitability_override_reason, valid_until)
                VALUES (${proposal}::uuid, ${tenant}::uuid, ${branch}::uuid, 'PR-NEW-2', 'investor', ${client}::uuid, 'Test Client', 'c@t.in', '9999999999',
                  'New', 'A summary', '[{"a":1},{"b":2}]'::jsonb, 'moderate', 'sent', '2026-03-05 10:00:00+05:30', 3, 1234567, ${rm}::uuid, ${parent}::uuid, 2,
                  ${rm}::uuid, 'Client insisted', '2026-04-10 12:00:00+05:30')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM proposals WHERE tenant_id = ${tenant}::uuid AND id = ${proposal}::uuid`).catch(() => {});
    await q(sql`DELETE FROM proposals WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(PROPOSAL_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [proposal], [...all], all));
    const v = got[proposal];
    expect(v.recipient_kind).toBe("Client");
    expect(v.email).toBe("c@t.in");
    expect(v.phone).toBe("9999999999");
    expect(v.pan).toMatch(/^ZZZPP/);
    expect(v.rm).toBe("Riya RM");
    expect(v.branch).toBe("Surat");
    expect(v.risk).toBe("Moderate");
    expect(v.products).toBe("2");
    expect(v.version).toBe("2");
    expect(v.revises).toBe("PR-OLD-1");
    expect(v.suitability_override_by).toBe("Riya RM");
    expect(v.sent).toBe("05 Mar 2026 10:00 AM");
    expect(v.valid_date).toBe("10 Apr 2026");
    expect(v.views).toBe("3");
    expect(v.executed_amount).toMatch(/12,34,567/);
    expect(v.expired_flag).toBe("No");
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [proposal], ["email", "pan; drop table proposals"], new Set(["email"])));
    expect(Object.keys(got[proposal])).toEqual(["email"]);
  });
});
