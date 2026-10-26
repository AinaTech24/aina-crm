/**
 * The daily discipline loop (CEO review S8) — lib/team/daily-discipline.ts
 * and lib/daily-tracker.ts.
 *
 * Pure: when a reminder is due, and the week's Monday. DB-backed
 * (TEST_DATABASE_URL): the tracker's "yesterday" is the INDIA day, meetings
 * and follow-ups fill in, the team view says who has filled in, a reminder
 * goes out once, and the weekly pack counts the week.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mondayOf, reminderDue } from "@/lib/team/daily-discipline";

describe("reminderDue", () => {
  // Monday 26 Oct 2026.
  it("is due once the firm's India time has passed", () => {
    expect(reminderDue("10:30", new Date("2026-10-26T04:59:00Z"))).toBe(false); // 10:29 IST
    expect(reminderDue("10:30", new Date("2026-10-26T05:00:00Z"))).toBe(true); // 10:30 IST
  });
  it("is never due on a Sunday or with no time set", () => {
    expect(reminderDue("10:30", new Date("2026-10-25T08:00:00Z"))).toBe(false);
    expect(reminderDue(null, new Date("2026-10-26T08:00:00Z"))).toBe(false);
  });
});

describe("mondayOf", () => {
  it("finds the Monday of the week", () => {
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // Sunday
    expect(mondayOf("2026-10-31")).toBe("2026-10-26");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("tracker, team day, reminders, weekly pack", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let dd: typeof import("@/lib/team/daily-discipline");
  let tracker: typeof import("@/lib/daily-tracker");
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const branch = randomUUID();
  const u = { owner: randomUUID(), rm: randomUUID(), ops: randomUUID() };
  const firm = { kind: "firm" } as const;
  const client = randomUUID();

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const user = (id: string, name: string, roles: string[]) =>
    q(sql`INSERT INTO users (id, tenant_id, email, name, roles, branch_id, status)
          VALUES (${id}::uuid, ${tenant}::uuid, ${name.toLowerCase().replace(/ /g, ".") + "@" + tenant.slice(0, 8) + ".test"}, ${name},
                  ${`{${roles.join(",")}}`}::text[], ${branch}::uuid, 'active')`);
  const task = (title: string, o: { status?: string; completedAt?: string; dueAt?: string; meta?: object } = {}) =>
    q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, type, title, status, priority, assignee_id, completed_at, due_at, meta)
          VALUES (${tenant}::uuid, 'user', ${u.rm}::uuid, 'follow_up', ${title}, ${o.status ?? "completed"}, 'normal', ${u.rm}::uuid,
                  ${o.completedAt ?? null}::timestamptz, ${o.dueAt ?? null}::timestamptz, ${JSON.stringify(o.meta ?? {})}::jsonb)`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    dd = await import("@/lib/team/daily-discipline");
    tracker = await import("@/lib/daily-tracker");
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'DJT Test', 'DJT Test', ${"ARN-DJ-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'HQ', 'HQ')`);
    await user(u.owner, "Olga Owner", ["owner"]);
    await user(u.rm, "Ravi Rm", ["rm"]);
    await user(u.ops, "Opal Ops", ["ops"]);
    // Sunday 25 Oct in India: 00:30 IST is 24 Oct 19:00 UTC; 23:30 IST is 25 Oct 18:00 UTC.
    await task("Early Sunday IST", { completedAt: "2026-10-24T19:00:00Z", dueAt: "2026-10-25T12:00:00Z" });
    await task("Late Sunday IST", { completedAt: "2026-10-25T18:00:00Z", dueAt: "2026-10-25T12:00:00Z" });
    await task("Monday", { completedAt: "2026-10-26T05:00:00Z" });
    await task("Still open", { status: "open", dueAt: "2026-10-23T05:00:00Z" });
    await task("Escalated", { status: "open", dueAt: "2026-10-20T05:00:00Z", meta: { escalation: { l1: { at: "2026-10-21T06:00:00Z", to: [] } } } });
    await q(sql`INSERT INTO investors (id, tenant_id, name, rm_id) VALUES (${client}::uuid, ${tenant}::uuid, 'Mehta', ${u.rm}::uuid)`);
    await q(sql`INSERT INTO review_meetings (tenant_id, investor_id, rm_id, meeting_date, status, meeting_type, meeting_mode, subject)
                VALUES (${tenant}::uuid, ${client}::uuid, ${u.rm}::uuid, '2026-10-25T06:00:00Z', 'completed', 'review', 'office', 'Quarterly review')`);
    await q(sql`INSERT INTO activities (tenant_id, subject_type, subject_id, kind, subject, occurred_at, owner_user_id)
                VALUES (${tenant}::uuid, 'lead', ${randomUUID()}::uuid, 'call', 'Called about SIP', '2026-10-25T07:00:00Z', ${u.rm}::uuid)`);
    // The RM filled in Monday's tracker; ops did not.
    await q(sql`INSERT INTO daily_trackers (tenant_id, user_id, tracker_date, today_focus)
                VALUES (${tenant}::uuid, ${u.rm}::uuid, '2026-10-26', '[{"text": "Call Mehta"}]'::jsonb)
                ON CONFLICT (tenant_id, user_id, tracker_date) DO UPDATE SET today_focus = EXCLUDED.today_focus`);
    await q(sql`INSERT INTO dashboard_settings (tenant_id, settings) VALUES (${tenant}::uuid, '{"dailyTracker": {"remindAt": "10:30"}}'::jsonb)`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of ["notifications", "activities", "review_meetings", "investors", "daily_trackers", "tasks", "dashboard_settings", "users", "branches"]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`);
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("Monday's tracker takes Sunday as the India day, with meetings and follow-ups", async () => {
    const d = await withSystem((tx) => tracker.loadDailyTracker(tx as any, tenant, u.rm, "2026-10-26"));
    expect(d.completedYesterday.map((t) => t.title).sort()).toEqual(["Early Sunday IST", "Late Sunday IST"]);
    expect(d.meetingsHeld).toEqual([expect.objectContaining({ title: "Quarterly review" })]);
    expect(d.followUpsLogged).toEqual([expect.objectContaining({ title: "Called about SIP" })]);
    expect(d.incompleteCarried.map((t) => t.title).sort()).toEqual(["Escalated", "Still open"]);
    expect(d.submittedAt).not.toBeNull();
  });

  it("the team day lists who has not filled in first, and leaves the owner out", async () => {
    const rows = await withSystem((tx) => dd.teamDay(tx, tenant, firm, "2026-10-26"));
    expect(rows.map((r) => r.name)).toEqual(["Opal Ops", "Ravi Rm"]);
    expect(rows[0].submittedAt).toBeNull();
    expect(rows[1]).toMatchObject({ focus: 1, doneYesterday: 2, meetingsYesterday: 1, followUpsYesterday: 1, overdueNow: 2 });
  });

  it("reminds the one person who has not filled in, once", async () => {
    const at = new Date("2026-10-26T06:00:00Z"); // 11:30 IST Monday
    expect(await withSystem((tx) => dd.runTrackerReminders(tx, tenant, at))).toBe(1);
    expect(await withSystem((tx) => dd.runTrackerReminders(tx, tenant, at))).toBe(0);
    const n = (await q(sql`SELECT user_id::text AS u FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'djt.reminder'`)).rows as Array<{ u: string }>;
    expect(n.map((x) => x.u)).toEqual([u.ops]);
  });

  it("not before the time, and not on a holiday", async () => {
    expect(await withSystem((tx) => dd.runTrackerReminders(tx, tenant, new Date("2026-10-27T04:00:00Z")))).toBe(0); // 09:30 IST
    await q(sql`INSERT INTO holidays (tenant_id, holiday_date, name) VALUES (${tenant}::uuid, '2026-10-27', 'Test holiday')`);
    expect(await withSystem((tx) => dd.runTrackerReminders(tx, tenant, new Date("2026-10-27T07:00:00Z")))).toBe(0);
    await q(sql`DELETE FROM holidays WHERE tenant_id = ${tenant}::uuid`);
  });

  it("the weekly pack counts the week of 19 Oct", async () => {
    const rows = await withSystem((tx) => dd.weeklyPack(tx, tenant, firm, "2026-10-19"));
    const rm = rows.find((r) => r.id === u.rm)!;
    // Both Sunday tasks finished in the week; the late one after its due time.
    expect(rm).toMatchObject({ done: 2, doneWithDue: 2, onTime: 1, escalated: 1, meetings: 1, followUps: 1, trackerDays: 0 });
  });
});
