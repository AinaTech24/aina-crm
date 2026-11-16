/**
 * The SIP Book's added fields: the catalog and the loader behind them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIP_EXTRA_FIELDS, allowedSipExtraKeys, sipExtraOptions } from "@/lib/list-columns/sip-fields";

describe("SIP extra fields", () => {
  it("every field has a unique key, a label and an expression", () => {
    const keys = SIP_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SIP_EXTRA_FIELDS.every((f) => f.label && f.expr && f.group)).toBe(true);
    expect(keys.every((k) => !k.includes(":"))).toBe(true);
  });

  it("withholds personal data the licence does not allow", () => {
    const opts = sipExtraOptions((f) => f !== "pan" && f !== "email");
    expect(opts.some((o) => o.key === "pan")).toBe(false);
    expect(opts.some((o) => o.key === "email")).toBe(false);
    expect(opts.some((o) => o.key === "phone")).toBe(true);
    expect(allowedSipExtraKeys(opts).has("mandate_ref")).toBe(true);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadSipExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const rm2 = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  const mandate = crypto.randomUUID();
  const folio = crypto.randomUUID();
  const sip = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/sip-fields").loadSipExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadSipExtra: load } = await import("@/lib/list-columns/sip-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Sip Col Firm', 'Sip Col Firm', ${"ARN-SC-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES
      (${rm}::uuid, ${tenant}::uuid, ${"sc-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active'),
      (${rm2}::uuid, ${tenant}::uuid, ${"sc-" + rm2.slice(0, 6) + "@t.in"}, 'Sam SipRM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, rm_id, branch_id, address, aum)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPS" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Sip Client', 'c@t.in', '9999999999', ${rm}::uuid, ${branch}::uuid,
                        '{"city":"Surat","state":"Gujarat"}'::jsonb, 2500000)`);
    await q(sql`INSERT INTO mandates (id, tenant_id, investor_id, mandate_ref_no, bank_account_masked, ifsc, amount_limit, registered_at, expires_at, status)
                VALUES (${mandate}::uuid, ${tenant}::uuid, ${client}::uuid, 'MND-1', 'XXXX1234', 'HDFC0001', 100000, '2025-01-10', '2030-01-09', 'active')`);
    await q(sql`INSERT INTO folios (id, tenant_id, investor_id, folio_number, amc_code, amc_name, rta, opened_at)
                VALUES (${folio}::uuid, ${tenant}::uuid, ${client}::uuid, 'F-100', 'HDFC', 'HDFC AMC', 'CAMS', '2020-06-15')`);
    await q(sql`INSERT INTO sips (id, tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name, amount, frequency, sip_date, next_installment_at, mandate_id, status, rm_id, consecutive_failures)
                VALUES (${sip}::uuid, ${tenant}::uuid, ${client}::uuid, ${folio}::uuid, 'F-100', 'HDFC', 'HDFC AMC', 'HF1', 'HDFC Flexi', 30000, 'quarterly', '5', '2026-12-05', ${mandate}::uuid, 'active', ${rm2}::uuid, '2')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM sips WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM folios WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM mandates WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(SIP_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [sip], [...all], all));
    const v = got[sip];
    expect(v.email).toBe("c@t.in");
    expect(v.phone).toBe("9999999999");
    expect(v.city).toBe("Surat");
    expect(v.client_rm).toBe("Riya RM");
    expect(v.branch).toBe("Surat");
    expect(v.client_aum).toMatch(/25,00,000/);
    expect(v.amc).toBe("HDFC AMC");
    expect(v.sip_day).toBe("5");
    expect(v.monthly).toMatch(/10,000/); // quarterly 30,000 = 10,000 a month
    expect(v.failures).toBe("2");
    expect(v.stored_next).toBe("05 Dec 2026");
    expect(v.mandate_ref).toBe("MND-1");
    expect(v.mandate_limit).toMatch(/1,00,000/);
    expect(v.mandate_expires).toBe("09 Jan 2030");
    expect(v.folio_rta).toBe("CAMS");
    expect(v.folio_opened).toBe("15 Jun 2020");
    expect(v.folio_closed).toBe("No");
    expect(v.created).toMatch(/^\d{2} \w{3} \d{4}$/);
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [sip], ["email", "pan; drop table sips"], new Set(["email"])));
    expect(Object.keys(got[sip])).toEqual(["email"]);
  });
});
