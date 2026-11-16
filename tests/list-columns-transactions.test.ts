/**
 * The MF Transactions list's "add a field" catalog and the loader behind it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TRANSACTION_EXTRA_FIELDS,
  allowedTransactionExtraKeys,
  transactionExtraOptions,
} from "@/lib/list-columns/transaction-fields";

describe("transaction extra fields", () => {
  it("every field has a unique key, a label and an expression", () => {
    const keys = TRANSACTION_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TRANSACTION_EXTRA_FIELDS.every((f) => f.label && f.expr)).toBe(true);
    expect(keys.some((k) => k.startsWith("cf:") || k.includes(":"))).toBe(false);
  });

  it("withholds a client field the licence does not allow", () => {
    const opts = transactionExtraOptions((f) => f !== "pan");
    expect(opts.some((o) => o.key === "pan")).toBe(false);
    expect(opts.some((o) => o.key === "email")).toBe(true);
    expect(allowedTransactionExtraKeys(opts).has("order_no")).toBe(true);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadTransactionExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  const folio = crypto.randomUUID();
  const txn = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/transaction-fields").loadTransactionExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadTransactionExtra: load } = await import("@/lib/list-columns/transaction-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Txn Firm', 'Txn Firm', ${"ARN-TX-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rm}::uuid, ${tenant}::uuid, ${"tx-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, rm_id, branch_id, address)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPT" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Test Client', 'c@t.in', '9999999999', ${rm}::uuid, ${branch}::uuid,
                        '{"city":"Surat","state":"Gujarat"}'::jsonb)`);
    await q(sql`INSERT INTO folios (id, tenant_id, investor_id, folio_number, amc_code, amc_name, rta, opened_at, aum)
                VALUES (${folio}::uuid, ${tenant}::uuid, ${client}::uuid, 'F123', 'HDFC', 'HDFC MF', 'CAMS', '2020-01-15', 1234567)`);
    await q(sql`INSERT INTO transactions (id, tenant_id, investor_id, folio_id, type, direction, amount, order_id, settlement_date, exchange, amc_code, scheme_code, executed_euin, reason_code)
                VALUES (${txn}::uuid, ${tenant}::uuid, ${client}::uuid, ${folio}::uuid, 'purchase', 'inflow', 5000, 'ORD-1', '2024-02-10', 'BSE', 'HDFC', 'SC1', 'E123456', 'R1')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM transactions WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM folios WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(TRANSACTION_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [txn], [...all], all));
    const v = got[txn];
    expect(v.order_no).toBe("ORD-1");
    expect(v.direction).toBe("Inflow");
    expect(v.settlement).toBe("10 Feb 2024");
    expect(v.exchange).toBe("BSE");
    expect(v.rta).toBe("CAMS");
    expect(v.folio_opened).toBe("15 Jan 2020");
    expect(v.folio_aum).toMatch(/12,34,567/);
    expect(v.email).toBe("c@t.in");
    expect(v.city).toBe("Surat");
    expect(v.client_rm).toBe("Riya RM");
    expect(v.branch).toBe("Surat");
    expect(v.entered).toMatch(/^\d{2} \w{3} \d{4}$/);
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [txn], ["order_no", "pan; drop table investors", "email"], new Set(["order_no"])));
    expect(Object.keys(got[txn])).toEqual(["order_no"]);
  });
});
