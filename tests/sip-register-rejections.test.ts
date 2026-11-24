/**
 * A SIP the registrar's register marks rejected gets a SIP Rejections row (Ahpal, 24 Nov 2026), once.
 * DB-backed (TEST_DATABASE_URL), skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("rejections from the SIP register", () => {
  const tenant = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let make: typeof import("@/lib/rta/sip-rejection-rows").materialiseRegisterRejections;
  const q = async <T = any>(t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(t)).rows as T[]);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ materialiseRegisterRejections: make } = await import("@/lib/rta/sip-rejection-rows"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Reg Rej', 'Reg Rej', ${"ARN-RR-" + tenant.slice(0, 6)})`);
    const inv = randomUUID();
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, status) VALUES (${inv}::uuid, ${tenant}::uuid, 'Asha', ${"PAN" + inv.slice(0, 7).toUpperCase()}, true, 'active')`);
    for (const [remarks, status] of [
      ["KFintech: Bank Rejection · ceased 12 Mar 2026", "stopped"],
      ["KFintech: Terminated by Investor", "stopped"],
      ["CAMS: Three consecutive reversals", "stopped"],
    ] as const) {
      await q(sql`INSERT INTO sips (tenant_id, investor_id, folio_number, scheme_code, scheme_name, amount, frequency, status, remarks, start_date)
                  VALUES (${tenant}::uuid, ${inv}::uuid, ${"F" + Math.random()}, 'S1', 'Scheme X', 5000, 'monthly', ${status}, ${remarks}, '2025-01-05')`);
    }
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["sip_rejections", "sips", "investors"]) await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("adds a row for each rejected / reversed SIP, not for a plain termination, and never twice", async () => {
    expect(await withSystem((tx) => make(tx))).toBe(2);
    expect(await withSystem((tx) => make(tx))).toBe(0);
    const rows = await q<{ rejection_reason: string; rejection_date: string }>(
      sql`SELECT rejection_reason, rejection_date::text FROM sip_rejections WHERE tenant_id = ${tenant}::uuid ORDER BY rejection_reason`,
    );
    expect(rows.map((r) => r.rejection_reason)).toEqual(["Bank Rejection · ceased 12 Mar 2026", "Three consecutive reversals"]);
    expect(rows.find((r) => r.rejection_reason.startsWith("Bank"))?.rejection_date).toBe("2026-03-12");
  });
});
