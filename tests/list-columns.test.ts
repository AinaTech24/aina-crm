/**
 * The column menu: order, added fields, and the loader behind them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moveKey, orderKeys, parsePrefs, serializePrefs } from "@/lib/list-columns/prefs";
import { INVESTOR_EXTRA_FIELDS, investorExtraOptions, allowedExtraKeys } from "@/lib/list-columns/investor-fields";

describe("column order", () => {
  const base = ["name", "pan", "aum", "sip", "kyc", "actions"];

  it("keeps the default order when nothing was moved", () => {
    expect(orderKeys(base, [], ["name"], ["actions"])).toEqual(base);
  });

  it("follows the saved sequence; the name stays first and the actions last", () => {
    expect(orderKeys(base, ["actions", "kyc", "name", "aum"], ["name"], ["actions"])).toEqual(["name", "kyc", "aum", "pan", "sip", "actions"]);
  });

  it("ignores saved keys that no longer exist and places new columns after the saved ones", () => {
    expect(orderKeys(["name", "pan", "aum", "x:email", "actions"], ["aum", "gone"], ["name"], ["actions"])).toEqual(["name", "aum", "pan", "x:email", "actions"]);
  });

  it("moves one step up or down among the movable columns only", () => {
    const k = ["name", "pan", "aum", "sip", "actions"];
    expect(moveKey(k, "aum", -1, ["name"], ["actions"])).toEqual(["name", "aum", "pan", "sip", "actions"]);
    expect(moveKey(k, "sip", 1, ["name"], ["actions"])).toEqual(k); // already last of the movable ones
    expect(moveKey(k, "pan", -1, ["name"], ["actions"])).toEqual(k); // cannot pass the pinned name
  });

  it("survives the cookie and refuses junk", () => {
    const p = { order: ["name", "x:email"], extra: ["email"] };
    expect(parsePrefs(serializePrefs(p))).toEqual(p);
    expect(parsePrefs("%7Bbroken")).toEqual({ order: [], extra: [] });
    expect(parsePrefs(serializePrefs({ order: ["a b", "ok"], extra: ["x'; drop table"] } as any))).toEqual({ order: ["ok"], extra: [] });
  });
});

describe("investor extra fields", () => {
  it("every field has a unique key and a label", () => {
    const keys = INVESTOR_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(INVESTOR_EXTRA_FIELDS.every((f) => f.label && f.expr)).toBe(true);
  });

  it("withholds a field the licence does not allow, and adds the firm's custom fields", () => {
    const opts = investorExtraOptions((f) => f !== "email", [{ key: "birth_city", label: "Birth city" }]);
    expect(opts.some((o) => o.key === "email")).toBe(false);
    expect(opts.some((o) => o.key === "phone")).toBe(true);
    expect(allowedExtraKeys(opts).has("cf:birth_city")).toBe(true);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadInvestorExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/investor-fields").loadInvestorExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadInvestorExtra: load } = await import("@/lib/list-columns/investor-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Col Firm', 'Col Firm', ${"ARN-CL-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rm}::uuid, ${tenant}::uuid, ${"cl-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, dob, rm_id, branch_id, address, lifetime_inflow, custom_fields, tags, gender)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPC" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Test Client', 'c@t.in', '9999999999', '1980-03-05', ${rm}::uuid, ${branch}::uuid,
                        '{"line1":"12 Ring Rd","city":"Surat","state":"Gujarat","pincode":"395001"}'::jsonb, 1234567, '{"birth_city":"Vadodara"}'::jsonb, '["vip","nri"]'::jsonb, 'F')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set([...INVESTOR_EXTRA_FIELDS.map((f) => f.key), "cf:birth_city"]);
    const got = await withTenant(tenant, (tx) => load(tx as any, [client], [...all], all));
    const v = got[client];
    expect(v.email).toBe("c@t.in");
    expect(v.phone).toBe("9999999999");
    expect(v.city).toBe("Surat");
    expect(v.address).toBe("12 Ring Rd, Surat, Gujarat, 395001");
    expect(v.rm).toBe("Riya RM");
    expect(v.branch).toBe("Surat");
    expect(v.dob).toBe("05 Mar 1980");
    expect(v.gender).toBe("Female");
    expect(v.tags).toBe("vip, nri");
    expect(v.inflow).toMatch(/12,34,567/);
    expect(v["cf:birth_city"]).toBe("Vadodara");
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [client], ["email", "pan; drop table investors"], new Set(["email"])));
    expect(Object.keys(got[client])).toEqual(["email"]);
  });
});
