/**
 * The escalation ladder for overdue tasks (CEO review S4, 2026-10-24).
 *
 * Two halves: the rule picking (pure), and one scanner pass over a real
 * database (needs a migrated Postgres in TEST_DATABASE_URL) — each level is
 * told once, the assignee never, and a task due before the ladder was
 * switched on never climbs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { LadderSchema, levelsReached, ruleFor } from "@/lib/tasks/escalation-ladder";

describe("ruleFor / levelsReached", () => {
  const ladder = LadderSchema.parse({
    enabled: true,
    rules: [
      { department: "operations", l1Hours: 4, l2Hours: 8, l3Hours: null },
      { department: "operations", priority: "urgent", l1Hours: 1, l2Hours: 2, l3Hours: 4 },
      { type: "kyc_renewal", l1Hours: 12 },
    ],
  });

  it("uses the most specific matching rule", () => {
    expect(ruleFor(ladder, { department: "operations", priority: "urgent" }).l1Hours).toBe(1);
    expect(ruleFor(ladder, { department: "operations", priority: "normal" }).l1Hours).toBe(4);
    expect(ruleFor(ladder, { department: "sales", type: "kyc_renewal" }).l1Hours).toBe(12);
  });

  it("falls back to 24 / 48 / 72 hours", () => {
    const r = ruleFor(ladder, { department: "sales", type: "follow_up", priority: "high" });
    expect([r.l1Hours, r.l2Hours, r.l3Hours]).toEqual([24, 48, 72]);
  });

  it("reaches a level at its hour, and skips a blank one", () => {
    const ops = ruleFor(ladder, { department: "operations" });
    expect(levelsReached(ops, 3.9)).toEqual([]);
    expect(levelsReached(ops, 4)).toEqual([1]);
    expect(levelsReached(ops, 500)).toEqual([1, 2]);
  });

  it("is off until switched on", () => {
    expect(LadderSchema.parse({}).enabled).toBe(false);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("runEscalationLadder", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let run: typeof import("@/lib/tasks/escalation-run").runEscalationLadder;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const branch = randomUUID();
  const u = { owner: randomUUID(), head: randomUUID(), manager: randomUUID(), rm: randomUUID() };
  const t = { old: randomUUID(), late: randomUUID(), fresh: randomUUID() };

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const user = (id: string, name: string, roles: string[], manager: string | null = null) =>
    q(sql`INSERT INTO users (id, tenant_id, email, name, roles, branch_id, reporting_manager_id, status)
          VALUES (${id}::uuid, ${tenant}::uuid, ${name.toLowerCase().replace(/ /g, ".") + "@" + tenant.slice(0, 8) + ".test"}, ${name},
                  ${`{${roles.join(",")}}`}::text[], ${branch}::uuid, ${manager}::uuid, 'active')`);
  const task = (id: string, title: string, dueHoursAgo: number) =>
    q(sql`INSERT INTO tasks (id, tenant_id, subject_type, subject_id, type, title, status, priority, assignee_id, due_at)
          VALUES (${id}::uuid, ${tenant}::uuid, 'user', ${u.rm}::uuid, 'follow_up', ${title}, 'open', 'normal', ${u.rm}::uuid, now() - make_interval(hours => ${dueHoursAgo}::int))`);
  const escalation = async (id: string) =>
    ((await q(sql`SELECT meta -> 'escalation' AS e FROM tasks WHERE id = ${id}::uuid`)).rows[0] as { e: Record<string, any> | null }).e;
  const notified = async () =>
    ((await q(sql`SELECT user_id::text AS u, count(*)::int AS n FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'task.escalated' GROUP BY 1`)).rows as Array<{ u: string; n: number }>);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ runEscalationLadder: run } = await import("@/lib/tasks/escalation-run"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Ladder Test', 'Ladder Test', ${"ARN-LD-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'HQ', 'HQ')`);
    await user(u.owner, "Olga Owner", ["owner"]);
    await user(u.head, "Hari Head", ["branch_head"]);
    await user(u.manager, "Mira Manager", ["rm"]);
    await user(u.rm, "Ravi Rm", ["rm"], u.manager);
    // Switched on 100 hours ago: 24 / 48 / 72 by default.
    const ladder = { enabled: true, activeSince: new Date(Date.now() - 100 * 3600_000).toISOString() };
    await q(sql`INSERT INTO dashboard_settings (tenant_id, settings) VALUES (${tenant}::uuid, jsonb_build_object('escalationLadder', ${JSON.stringify(ladder)}::jsonb))`);
    await task(t.old, "Due before the ladder", 150);
    await task(t.late, "Fifty hours late", 50);
    await task(t.fresh, "Due an hour ago", 1);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of ["notifications", "audit_log", "tasks", "dashboard_settings", "users", "branches"]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`);
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("climbs a task 50 hours overdue to the manager and the branch head, once", async () => {
    await withSystem((tx) => run(tx, tenant));
    const e = await escalation(t.late);
    expect(e?.l1?.to).toEqual([u.manager]);
    expect(e?.l2?.to).toEqual([u.head]);
    expect(e?.l3).toBeUndefined();
    expect(e?.done).toBeUndefined();

    await withSystem((tx) => run(tx, tenant)); // a second pass tells nobody again
    const n = await notified();
    expect(n.find((x) => x.u === u.manager)?.n).toBe(1);
    expect(n.find((x) => x.u === u.head)?.n).toBe(1);
    expect(n.find((x) => x.u === u.owner)).toBeUndefined();
    expect(n.find((x) => x.u === u.rm)).toBeUndefined();
  });

  it("reaches the owner at 72 hours and is then done", async () => {
    await q(sql`UPDATE tasks SET due_at = now() - interval '80 hours' WHERE id = ${t.late}::uuid`);
    await withSystem((tx) => run(tx, tenant));
    const e = await escalation(t.late);
    expect(e?.l3?.to).toEqual([u.owner]);
    expect(e?.done).toBe(true);
    expect(e?.to?.sort()).toEqual([u.manager, u.head, u.owner].sort());
  });

  it("leaves alone a task due before it was switched on, and one not yet late enough", async () => {
    expect(await escalation(t.old)).toBeNull();
    expect(await escalation(t.fresh)).toBeNull();
  });

  it("audits each level", async () => {
    const r = (await q(sql`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${tenant}::uuid AND action = 'task.escalated' AND entity_id = ${t.late}::uuid`)).rows[0] as { n: number };
    expect(r.n).toBe(3);
  });
});
