/**
 * A SIP bounce that arrives through the transaction feed gets its row on the
 * SIP Rejections page — whenever it was imported, and never twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("SIP rejection rows from the transaction feed", () => {
  const tenant = randomUUID();
  const client = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let materialise: typeof import("@/lib/rta/sip-rejection-rows").materialiseSipRejectionRows;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const rows = async () =>
    (await q(sql`SELECT rejection_date::text AS d, rejection_amount::float8 AS amt, reason_category AS cat, escalated_at FROM sip_rejections WHERE tenant_id = ${tenant}::uuid ORDER BY rejection_date`)).rows as Array<{
      d: string; amt: number; cat: string; escalated_at: string | null;
    }>;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ materialiseSipRejectionRows: materialise } = await import("@/lib/rta/sip-rejection-rows"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Feed', 'Feed', ${"ARN-FD-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan) VALUES (${client}::uuid, ${tenant}::uuid, 'DDDDD4444D', 'Dev', true)`);
    const tx = (type: string, status: string, date: string, amt: number, reason: string, ageDays: number) =>
      q(sql`INSERT INTO transactions (tenant_id, investor_id, direction, type, status, order_date, amount, reason_description, scheme_name, folio_number, created_at)
            VALUES (${tenant}::uuid, ${client}::uuid, 'inflow', ${type}, ${status}, ${date}::date, ${amt}, ${reason}, 'Scheme A', '123/4', now() - (${ageDays} || ' days')::interval)`);
    await tx("sip", "rejected", new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10), 5000, "Insufficient funds", 1);
    // Imported a month ago, before any scan looked: the old two-day window never saw it.
    await tx("sip", "failed", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), 2500, "Mandate expired", 30);
    await tx("sip", "processed", new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), 5000, "", 2);
    await tx("lumpsum", "rejected", new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), 9999, "x", 2);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["sip_rejections", "transactions", "investors"]) await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("adds a row for every bounced SIP — including one imported weeks ago — and for nothing else", async () => {
    expect(await withSystem((tx) => materialise(tx))).toBe(2);
    const r = await rows();
    expect(r.map((x) => x.amt)).toEqual([2500, 5000]);
    expect(r[0].cat).toBe("mandate_expired");
    expect(r[1].cat).toBe("insufficient_balance");
  });

  it("does not alert the owners about an old bounce it is only catching up on", async () => {
    const r = await rows();
    expect(r[0].escalated_at).not.toBeNull(); // 30 days old
    expect(r[1].escalated_at).toBeNull(); // yesterday: still a live follow-up
  });

  it("a second run adds nothing", async () => {
    expect(await withSystem((tx) => materialise(tx))).toBe(0);
    expect((await rows()).length).toBe(2);
  });
});
