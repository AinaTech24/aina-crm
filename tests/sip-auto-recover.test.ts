/**
 * Auto-Recover on a rejected SIP. The route once built its inserts from column
 * names that do not exist (eventKind, taskType, investorId, status "todo"), so
 * the database refused every click and the screen said "internal". This runs the
 * real inserts. DB-backed (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("autoRecoverRejection", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let recover: typeof import("@/lib/sip-rejections/auto-recover").autoRecoverRejection;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const rm = randomUUID();
  const actor = randomUUID();
  const investor = randomUUID();
  const rejection = randomUUID();
  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));

  const input = () => ({
    tenantId: tenant,
    userId: actor,
    rejection: {
      id: rejection,
      investorId: investor,
      assignedRmId: rm,
      reasonCategory: "mandate_expired",
      rejectionReason: "Mandate expired",
      rejectionAmount: "1000.00",
      rejectionDate: "2026-10-26",
      schemeName: "Helios Mid Cap Fund",
      remarks: null,
    },
    investor: { name: "Aditya Panchal", rmId: rm },
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ autoRecoverRejection: recover } = await import("@/lib/sip-rejections/auto-recover"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Recover Test', 'Recover Test', ${"ARN-RC-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES
      (${rm}::uuid, ${tenant}::uuid, ${"rm-" + rm.slice(0, 6) + "@example.com"}, 'RM', '{rm}', 'active'),
      (${actor}::uuid, ${tenant}::uuid, ${"ac-" + actor.slice(0, 6) + "@example.com"}, 'Actor', '{owner}', 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, status) VALUES (${investor}::uuid, ${tenant}::uuid, 'Aditya Panchal', 'active')`);
    await q(sql`INSERT INTO sip_rejections (id, tenant_id, investor_id, rejection_date, rejection_amount, scheme_name, recovery_status)
                VALUES (${rejection}::uuid, ${tenant}::uuid, ${investor}::uuid, '2026-10-26', 1000, 'Helios Mid Cap Fund', 'pending')`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of ["events_outbox", "tasks", "sip_rejections", "investors", "users"]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`);
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("raises the event, creates the RM's task and moves the rejection on", async () => {
    const r = await withSystem((tx) => recover(tx, input()));
    expect(r).toEqual({ taskCreated: true, eventRaised: true });

    const ev = (await q(sql`SELECT kind, entity_type, entity_id::text AS entity_id, after FROM events_outbox WHERE tenant_id = ${tenant}::uuid`)).rows as Array<any>;
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe("transaction.failed.sip_rejection");
    expect(ev[0].entity_type).toBe("investor");
    expect(ev[0].entity_id).toBe(investor);
    expect(ev[0].after.scheme_name).toBe("Helios Mid Cap Fund");
    expect(ev[0].after.reason).toBe("Mandate expired");

    const tk = (await q(sql`SELECT type, priority, status, assignee_id::text AS a, subject_type FROM tasks WHERE tenant_id = ${tenant}::uuid`)).rows as Array<any>;
    expect(tk).toHaveLength(1);
    expect(tk[0]).toMatchObject({ type: "sip_rejection_followup", priority: "high", status: "open", a: rm, subject_type: "investor" });

    const rej = (await q(sql`SELECT recovery_status, follow_up_date, remarks FROM sip_rejections WHERE id = ${rejection}::uuid`)).rows[0] as any;
    expect(rej.recovery_status).toBe("client_contacted");
    expect(rej.follow_up_date).toBeTruthy();
    expect(rej.remarks).toMatch(/Auto-Recover/);
  });

  it("a second click adds no second event and no second open task", async () => {
    const r = await withSystem((tx) => recover(tx, input()));
    expect(r).toEqual({ taskCreated: false, eventRaised: false });
    expect(((await q(sql`SELECT 1 FROM events_outbox WHERE tenant_id = ${tenant}::uuid`)).rows as unknown[]).length).toBe(1);
    expect(((await q(sql`SELECT 1 FROM tasks WHERE tenant_id = ${tenant}::uuid`)).rows as unknown[]).length).toBe(1);
  });

  it("makes a new task once the first is done", async () => {
    await q(sql`UPDATE tasks SET status = 'completed' WHERE tenant_id = ${tenant}::uuid`);
    const r = await withSystem((tx) => recover(tx, input()));
    expect(r.taskCreated).toBe(true);
    expect(((await q(sql`SELECT 1 FROM tasks WHERE tenant_id = ${tenant}::uuid`)).rows as unknown[]).length).toBe(2);
  });
});
