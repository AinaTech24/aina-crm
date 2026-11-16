/**
 * SIP Rejections: the fields a person can add as columns, and the loader behind them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orderKeys } from "@/lib/list-columns/prefs";
import {
  SIP_REJ_DEFAULT_COLUMNS,
  SIP_REJECTION_EXTRA_FIELDS,
  allowedSipRejectionKeys,
  sipRejectionExtraOptions,
} from "@/lib/list-columns/sip-rejection-fields";

describe("sip rejection extra fields", () => {
  it("every field has a unique key, a label and an expression", () => {
    const keys = SIP_REJECTION_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SIP_REJECTION_EXTRA_FIELDS.every((f) => f.label && f.expr)).toBe(true);
  });

  it("no extra field repeats a built-in column key", () => {
    const keys = new Set(SIP_REJECTION_EXTRA_FIELDS.map((f) => f.key));
    expect(SIP_REJ_DEFAULT_COLUMNS.some((k) => keys.has(k))).toBe(false);
  });

  it("withholds personal fields the licence does not allow", () => {
    const opts = sipRejectionExtraOptions((f) => f !== "email");
    expect(opts.some((o) => o.key === "email")).toBe(false);
    expect(opts.some((o) => o.key === "phone")).toBe(true);
    expect(allowedSipRejectionKeys(opts).has("amc")).toBe(true);
  });

  it("the date column stays first however the rest is ordered", () => {
    const avail = [...SIP_REJ_DEFAULT_COLUMNS, "x:amc"];
    const out = orderKeys(avail, ["remarks", "x:amc", "rejected_on", "amount"], ["rejected_on"]);
    expect(out[0]).toBe("rejected_on");
    expect(out.indexOf("remarks")).toBeLessThan(out.indexOf("x:amc"));
    expect(out.indexOf("x:amc")).toBeLessThan(out.indexOf("amount"));
    expect(out.length).toBe(avail.length);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadSipRejectionExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  const sipId = crypto.randomUUID();
  const rej = crypto.randomUUID();
  const rejBare = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/sip-rejection-fields").loadSipRejectionExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadSipRejectionExtra: load } = await import("@/lib/list-columns/sip-rejection-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Rej Firm', 'Rej Firm', ${"ARN-SR-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rm}::uuid, ${tenant}::uuid, ${"sr-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, rm_id, branch_id, address)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZSR" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Rej Client', 'c@t.in', '9999999999', ${rm}::uuid, ${branch}::uuid,
                        '{"city":"Surat","state":"Gujarat"}'::jsonb)`);
    await q(sql`INSERT INTO sips (id, tenant_id, investor_id, amount, frequency, sip_date, start_date, status, consecutive_failures)
                VALUES (${sipId}::uuid, ${tenant}::uuid, ${client}::uuid, 25000, 'monthly', '5', '2025-01-05', 'active', '2')`);
    await q(sql`INSERT INTO sip_rejections (id, tenant_id, investor_id, sip_id, rejection_date, rejection_amount, rejection_reason, scheme_name, folio_number, amc_name, reason_category, recovery_status, status_changed_at)
                VALUES (${rej}::uuid, ${tenant}::uuid, ${client}::uuid, ${sipId}::uuid, '2026-03-07', 25000, 'Insufficient funds', 'Fund A', 'F123', 'HDFC Mutual Fund', 'insufficient_balance', 'pending', now() - interval '5 days')`);
    await q(sql`INSERT INTO sip_rejections (id, tenant_id, investor_id, rejection_date, rejection_amount, recovery_status)
                VALUES (${rejBare}::uuid, ${tenant}::uuid, ${client}::uuid, '2026-03-08', 1000, 'recovered')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM sip_rejections WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM sips WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(SIP_REJECTION_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [rej, rejBare], [...all], all));
    const v = got[rej];
    expect(v.amc).toBe("HDFC Mutual Fund");
    expect(v.folio).toBe("F123");
    expect(v.reason_category).toBe("Insufficient Balance");
    expect(v.reason_text).toBe("Insufficient funds");
    expect(v.days_since).toMatch(/^\d+$/);
    expect(v.sla_breached).toBe("Yes");
    expect(v.sip_status).toBe("Active");
    expect(v.sip_amount).toMatch(/25,000/);
    expect(v.sip_frequency).toBe("Monthly");
    expect(v.sip_date).toBe("5");
    expect(v.sip_start).toBe("05 Jan 2025");
    expect(v.sip_failures).toBe("2");
    expect(v.email).toBe("c@t.in");
    expect(v.phone).toBe("9999999999");
    expect(v.city).toBe("Surat");
    expect(v.client_rm).toBe("Riya RM");
    expect(v.branch).toBe("Surat");
    // A rejection with no linked SIP simply has no SIP values.
    expect(got[rejBare].sip_status).toBeUndefined();
    expect(got[rejBare].sla_breached).toBe("No");
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [rej], ["amc", "pan; drop table investors"], new Set(["amc"])));
    expect(Object.keys(got[rej])).toEqual(["amc"]);
  });
});
