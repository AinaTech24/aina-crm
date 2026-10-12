/**
 * Final pilot patch, P1 — the Operations dashboard counts a rejected STP as
 * ONE instruction with two legs (lib/dashboard/ops: rejectedInstructionKey).
 * The pilot sample: one failed SIP instalment (₹2,000) and one refused STP
 * reported as two legs (₹5,000 out, ₹5,000 in) → 2 instructions / ₹7,000 and
 * 3 legs / ₹12,000. Both legs keep their own rows and the shared reference.
 * Synthetic rows, real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => h.session) }));
vi.mock("@/lib/dashboards/open-system", async (orig) => ({ ...(await orig<typeof import("@/lib/dashboards/open-system")>()), mayUseRoleDashboard: vi.fn(async () => true) }));

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("Operations dashboard — rejected instructions vs legs (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let X: typeof import("@/lib/dashboard/ops/exceptions");
  let F: typeof import("@/lib/dashboard/ops/flow");
  const t = randomUUID();
  const a = randomUUID();
  const b = randomUUID();
  const window = async () => {
    const { getDashboardThresholds } = await import("@/lib/dashboard/thresholds");
    return { tenantId: t, userId: randomUUID(), scope: { kind: "firm" as const }, filter: {}, from: "2026-05-01", to: "2026-05-31", today: "2026-05-31", periodLabel: "May 2026", t: getDashboardThresholds() };
  };
  const rejected = (inv: string, type: string, direction: string, amount: number, date: string, ref: string | null, folio: string) =>
    sql`(${t}::uuid, ${inv}::uuid, ${folio}, '120', ${"120EQGP"}, 'Example Fund', ${type}, ${direction}, ${amount}, 0, ${randomUUID().slice(0, 8)}, ${date}::date, 'rejected',
         'Required amount not available', ${JSON.stringify({ switchRef: ref })}::jsonb)`;
  const insert = (rows: ReturnType<typeof rejected>[]) => withTenant(t, (tx) => tx.execute(sql`
    INSERT INTO transactions (tenant_id, investor_id, folio_number, amc_code, scheme_code, scheme_name, type, direction, amount, units, order_id, order_date, status, reason_description, raw_feed_row)
    VALUES ${sql.join(rows, sql`, `)}`));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    X = await import("@/lib/dashboard/ops/exceptions");
    F = await import("@/lib/dashboard/ops/flow");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Ops rejections', 'Ops rejections', ${"ARN-OR" + t.slice(0, 6)})`));
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, name) VALUES (${a}::uuid, ${t}::uuid, 'Client A'), (${b}::uuid, ${t}::uuid, 'Client B')`));
    // The pilot sample: a failed SIP instalment and one STP refused as two legs sharing the registrar's reference.
    await insert([
      rejected(a, "sip", "inflow", 2000, "2026-05-11", null, "F-A1"),
      rejected(a, "stp", "outflow", 5000, "2026-05-04", "1", "F-A2"),
      rejected(a, "stp", "inflow", 5000, "2026-05-04", "1", "F-A2"),
    ]);
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`DELETE FROM transactions WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM investors WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("the sample: 2 unique instructions / ₹7,000 and 3 rejected legs / ₹12,000; each leg row is kept with its reference", async () => {
    const w = await window();
    const d = (await withTenant(t, (tx) => X.loadRejected(tx, w as any)))!;
    expect({ instructions: d.instructions, instructionValue: d.instructionValue, legs: d.total, legValue: d.value }).toEqual({ instructions: 2, instructionValue: 7000, legs: 3, legValue: 12000 });
    expect(d.rows).toHaveLength(3);
    const stp = d.rows.filter((r) => r.legsInInstruction === 2);
    expect(stp).toHaveLength(2);
    expect(new Set(stp.map((r) => r.instructionRef)).size).toBe(1); // both legs → one instruction
    expect(stp.map((r) => r.direction).sort()).toEqual(["inflow", "outflow"]);
    const refs = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${t}::uuid AND type = 'stp' AND raw_feed_row->>'switchRef' = '1'`)).rows[0] as any);
    expect(refs.n).toBe(2);
  });

  it("the trend, the per-kind and the value table count instructions too — the STP once", async () => {
    const w = await window();
    const value = await withTenant(t, (tx) => F.loadFeedValue(tx, w as any, w.from, w.to));
    const stp = value.rows.find((r) => r.key === "stp")!;
    expect(stp.rejected).toEqual({ n: 1, v: 5000 });
    expect(value.rows.find((r) => r.key === "sip")!.rejected).toEqual({ n: 1, v: 2000 });
  });

  it("the export API carries every leg with its instruction, so a spreadsheet can count either", async () => {
    h.session = { userId: randomUUID(), tenantId: t, roles: ["owner"], permissions: [], branchId: null };
    const route = await import("@/app/api/ops/export/route");
    const res = await route.GET(new NextRequest("http://localhost/api/ops/export?kind=rejected&period=custom&from=2026-05-01&to=2026-05-31"));
    expect(res.status).toBe(200);
    const lines = (await res.text()).replace(/^\uFEFF/, "").trim().split(/\r\n/);
    const head = lines[0].split(",");
    const col = (name: string) => head.indexOf(name);
    const rows = lines.slice(1).map((l) => l.split(","));
    expect(rows).toHaveLength(3); // three legs
    expect(new Set(rows.map((r) => r[col("Instruction")])).size).toBe(2); // two instructions
    expect(rows.filter((r) => r[col("Legs in instruction")] === "2").map((r) => r[col("Leg")]).sort()).toEqual(["destination", "source"]);
  });

  it("the registrar's short reference is not an identity on its own: another client's STP with the same reference is another instruction", async () => {
    await insert([
      rejected(b, "stp", "outflow", 3000, "2026-05-04", "1", "F-B1"),
      rejected(b, "stp", "inflow", 3000, "2026-05-04", "1", "F-B1"),
    ]);
    const w = await window();
    const d = (await withTenant(t, (tx) => X.loadRejected(tx, w as any)))!;
    expect({ instructions: d.instructions, instructionValue: d.instructionValue, legs: d.total, legValue: d.value }).toEqual({ instructions: 3, instructionValue: 10000, legs: 5, legValue: 18000 });
  });
});
