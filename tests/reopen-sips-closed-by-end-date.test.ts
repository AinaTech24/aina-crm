/**
 * Migration 0304 (2026-11-27): SIPs closed on their END DATE alone are put back — and nothing the registrar said ended,
 * nothing with positive evidence that it stopped, and no deceased client's, is touched. Runs the migration file itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("migration 0304 — reopen SIPs closed by end date alone", () => {
  const tenant = randomUUID();
  const inv = randomUUID();
  const dead = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = async <T = any>(t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(t)).rows as T[]);

  const addSip = (folio: string, o: { remarks?: string | null; investor?: string; amount?: number } = {}) =>
    q(sql`
      INSERT INTO sips (tenant_id, investor_id, folio_number, scheme_code, scheme_name, amount, frequency, status, start_date, end_date, remarks)
      VALUES (${tenant}::uuid, ${o.investor ?? inv}::uuid, ${folio}, 'S1', 'Scheme', ${o.amount ?? 5000}, 'monthly', 'completed',
              '2020-01-05', '2025-01-05', ${o.remarks ?? null})
    `);
  const addInstalment = (folio: string, on: string) =>
    q(sql`
      INSERT INTO transactions (tenant_id, investor_id, folio_number, amc_code, scheme_code, scheme_name, type, direction, amount, units, nav, order_id, order_date, status)
      VALUES (${tenant}::uuid, ${inv}::uuid, ${folio}, 'P', 'S1', 'Scheme', 'sip', 'in', 5000, 10, 500, ${"o-" + randomUUID().slice(0, 8)}, ${on}::date, 'processed')
    `);
  const status = async (folio: string) => (await q<{ status: string; remarks: string | null }>(sql`SELECT status, remarks FROM sips WHERE tenant_id = ${tenant}::uuid AND folio_number = ${folio}`))[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Reopen', 'Reopen', ${"ARN-RO-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan) VALUES (${inv}::uuid, ${tenant}::uuid, 'Live Client', ${"PAN" + inv.slice(0, 7).toUpperCase()}, true)`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, date_of_demise) VALUES (${dead}::uuid, ${tenant}::uuid, 'Late Client', ${"PAN" + dead.slice(0, 7).toUpperCase()}, true, '2025-06-01')`);

    await addSip("F-NOHIST");                                                     // closed on the date alone, no instalment history
    await addSip("F-RECENT"); await addInstalment("F-RECENT", new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10)); // still collecting
    await addSip("F-STOPPED"); await addInstalment("F-STOPPED", "2024-06-05");   // history, nothing for far over 120 days: evidence
    await addSip("F-MARK", { remarks: "CAMS: SIP term ended 5 Jan 2025" });      // the backfill's own marker
    await addSip("F-TERM", { remarks: "KFintech: Terminated by Investor" });     // the registrar said so
    await addSip("F-EXPIRED", { remarks: "KFintech: Expired" });                 // the registrar said so
    await addSip("F-DEAD", { investor: dead });                                  // a deceased client's

    const file = readFileSync(join(process.cwd(), "drizzle/migrations/0304_reopen_sips_closed_by_end_date.sql"), "utf8");
    await withSystem(async (tx) => { await tx.execute(sql.raw(file)); });
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["transactions", "sips", "investors"]) await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("reopens a SIP closed on its end date with no evidence that it stopped", async () => {
    expect((await status("F-NOHIST")).status).toBe("active");
    expect((await status("F-RECENT")).status).toBe("active");
  });

  it("removes the backfill's own marker when it reopens", async () => {
    const r = await status("F-MARK");
    expect(r.status).toBe("active");
    expect(r.remarks).toBeNull();
  });

  it("leaves alone a SIP with positive evidence that it stopped", async () => {
    expect((await status("F-STOPPED")).status).toBe("completed");
  });

  it("leaves alone what the registrar said ended, and a deceased client's SIP", async () => {
    expect((await status("F-TERM")).status).toBe("completed");
    expect((await status("F-EXPIRED")).status).toBe("completed");
    expect((await status("F-DEAD")).status).toBe("completed");
  });

  it("brings the client's cached SIP amount back with it", async () => {
    const [c] = await q<{ active_sip_amount: string }>(sql`SELECT active_sip_amount FROM investors WHERE id = ${inv}::uuid`);
    expect(Number(c.active_sip_amount)).toBe(15000); // F-NOHIST + F-RECENT + F-MARK
  });
});
