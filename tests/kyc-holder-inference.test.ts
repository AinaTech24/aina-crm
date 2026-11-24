/**
 * A client who holds units is at least KYC-registered (lib/kyc/holder-inference.ts) — and an
 * authoritative status is never overwritten. DB-backed (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("KYC from holdings", () => {
  const tenant = randomUUID();
  const other = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let inferKycFromHoldings: typeof import("@/lib/kyc/holder-inference").inferKycFromHoldings;
  const q = async <T = any>(t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(t)).rows as T[]);
  const ids: Record<string, string> = {};

  async function client(key: string, o: { status?: string; aum?: number; folioAum?: number; txn?: boolean; deleted?: boolean; t?: string }) {
    const id = randomUUID();
    ids[key] = id;
    const t = o.t ?? tenant;
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, kyc_status, aum, deleted_at)
                VALUES (${id}::uuid, ${t}::uuid, ${key}, ${"PAN" + id.slice(0, 7).toUpperCase()}, true, ${o.status ?? "pending"}, ${o.aum ?? 0},
                        ${o.deleted ? sql`now()` : sql`NULL`})`);
    if (o.folioAum != null) {
      await q(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta, aum)
                  VALUES (${t}::uuid, ${id}::uuid, ${"F" + id.slice(0, 6)}, 'P', 'AMC', 'cams', ${o.folioAum})`);
    }
    if (o.txn) {
      await q(sql`INSERT INTO transactions (tenant_id, investor_id, type, direction, amount, status, order_date, order_id)
                  VALUES (${t}::uuid, ${id}::uuid, 'sip', 'in', 5000, 'processed', current_date, ${"T" + id})`);
    }
    return id;
  }
  const status = async (key: string) => (await q<any>(sql`SELECT kyc_status, kyc_status_remark, kyc_check_source, kyc_checked_at FROM investors WHERE id = ${ids[key]}::uuid`))[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ inferKycFromHoldings } = await import("@/lib/kyc/holder-inference"));
    for (const [id, tag] of [[tenant, "KA"], [other, "KB"]] as const) {
      await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${tag}, ${tag}, ${"ARN-" + tag + "-" + id.slice(0, 6)})`);
    }
    await client("aum_holder", { aum: 1_000_000 });
    await client("folio_holder", { folioAum: 50_000 });
    await client("sip_buyer", { txn: true });
    await client("nothing", {});
    await client("on_hold", { status: "hold", aum: 500_000 });
    await client("rejected", { status: "rejected", aum: 500_000 });
    await client("re_kyc", { status: "re_kyc_required", aum: 500_000 });
    await client("verified", { status: "verified", aum: 500_000 });
    await client("deleted", { aum: 500_000, deleted: true });
    await client("other_firm", { aum: 500_000, t: other });
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["transactions", "folios", "investors"]) await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id IN (${tenant}::uuid, ${other}::uuid)`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id IN (${tenant}::uuid, ${other}::uuid)`).catch(() => {});
  });

  it("pending → registered for a client with AUM, a valued folio, or a processed purchase / SIP", async () => {
    const n = await withSystem((tx) => inferKycFromHoldings(tx, tenant));
    expect(n).toBe(3);
    for (const k of ["aum_holder", "folio_holder", "sip_buyer"]) {
      const s = await status(k);
      expect(s.kyc_status).toBe("registered");
      expect(s.kyc_check_source).toBe("registrar_holdings");
      expect(s.kyc_status_remark).toMatch(/not yet checked with the KRA/);
      expect(s.kyc_checked_at).toBeNull(); // it is not a KRA check
    }
  });

  it("leaves a client who holds nothing, a deleted one, and another firm's clients alone", async () => {
    expect((await status("nothing")).kyc_status).toBe("pending");
    expect((await status("deleted")).kyc_status).toBe("pending");
    expect((await status("other_firm")).kyc_status).toBe("pending");
  });

  it("never overwrites an authoritative status", async () => {
    expect((await status("on_hold")).kyc_status).toBe("hold");
    expect((await status("rejected")).kyc_status).toBe("rejected");
    expect((await status("re_kyc")).kyc_status).toBe("re_kyc_required");
    expect((await status("verified")).kyc_status).toBe("verified");
  });

  it("is idempotent", async () => {
    expect(await withSystem((tx) => inferKycFromHoldings(tx, tenant))).toBe(0);
  });

  it("the backfill migration does the same across firms", async () => {
    await q(sql`UPDATE investors SET kyc_status = 'pending', kyc_status_remark = NULL, kyc_check_source = NULL WHERE id = ${ids.aum_holder}::uuid`);
    const mig = readFileSync(join(__dirname, "../drizzle/migrations/0289_kyc_registered_for_holders.sql"), "utf8");
    await withSystem(async (tx) => { await tx.execute(sql.raw(mig)); });
    expect((await status("aum_holder")).kyc_status).toBe("registered");
    expect((await status("other_firm")).kyc_status).toBe("registered"); // holds AUM at another firm: same rule
    expect((await status("on_hold")).kyc_status).toBe("hold");
    expect((await status("nothing")).kyc_status).toBe("pending");
  });
});
