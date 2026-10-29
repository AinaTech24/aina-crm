/**
 * QA sampling of completed work (CEO review S7) — lib/qa/sampling.ts.
 *
 * Pure: the sample size and last week's window. DB-backed (TEST_DATABASE_URL):
 * a week's sample goes to the right checker once, a pass closes the check,
 * a fail also gives the doer a correction task — and the thresholds save
 * keeps the setting.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { previousWeek, sampleSize } from "@/lib/qa/sampling";

describe("sampleSize", () => {
  it("rounds up, so one finished task still gets a check, and never exceeds the count", () => {
    expect(sampleSize(0, 5)).toBe(0);
    expect(sampleSize(1, 5)).toBe(1);
    expect(sampleSize(40, 5)).toBe(2);
    expect(sampleSize(41, 5)).toBe(3);
    expect(sampleSize(3, 100)).toBe(3);
  });
});

describe("previousWeek", () => {
  it("is Monday to Monday in India time, ISO-numbered", () => {
    // Monday 26 Oct 2026, 09:00 IST → the week of Mon 19 Oct.
    const w = previousWeek(new Date("2026-10-26T03:30:00Z"));
    expect(w.from.toISOString()).toBe("2026-10-18T18:30:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-25T18:30:00.000Z");
    expect(w.key).toBe("2026-W43");
  });

  it("treats Sunday night IST as the same week", () => {
    // Sunday 25 Oct 2026, 23:30 IST → still the week before (12–18 Oct).
    expect(previousWeek(new Date("2026-10-25T18:00:00Z")).key).toBe("2026-W42");
  });

  it("numbers the first week of January by its Thursday", () => {
    expect(previousWeek(new Date("2027-01-11T06:00:00Z")).key).toBe("2027-W01");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("runQaSampling / recordQaResult", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let qa: typeof import("@/lib/qa/sampling");
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const branch = randomUUID();
  const u = { owner: randomUUID(), manager: randomUUID(), rm: randomUUID() };
  const NOW = new Date("2026-10-26T06:00:00Z"); // Monday; last week = 19–25 Oct

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const rows = async <T,>(text: ReturnType<typeof import("drizzle-orm").sql>) => (await q(text)).rows as T[];
  const user = (id: string, name: string, roles: string[], manager: string | null = null) =>
    q(sql`INSERT INTO users (id, tenant_id, email, name, roles, branch_id, reporting_manager_id, status)
          VALUES (${id}::uuid, ${tenant}::uuid, ${name.toLowerCase().replace(/ /g, ".") + "@" + tenant.slice(0, 8) + ".test"}, ${name},
                  ${`{${roles.join(",")}}`}::text[], ${branch}::uuid, ${manager}::uuid, 'active')`);
  const done = (title: string, completedAt: string, type = "follow_up") =>
    q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, type, title, status, priority, assignee_id, completed_at)
          VALUES (${tenant}::uuid, 'user', ${u.rm}::uuid, ${type}, ${title}, 'completed', 'normal', ${u.rm}::uuid, ${completedAt}::timestamptz)`);
  const checks = () => rows<{ id: string; assignee_id: string; meta: any; status: string }>(sql`
    SELECT id::text, assignee_id::text, meta, status FROM tasks WHERE tenant_id = ${tenant}::uuid AND type = 'qa_review' AND meta ? 'qaOf' ORDER BY meta ->> 'qaOf'`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    qa = await import("@/lib/qa/sampling");
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'QA Test', 'QA Test', ${"ARN-QA-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'HQ', 'HQ')`);
    await user(u.owner, "Olga Owner", ["owner"]);
    await user(u.manager, "Mira Manager", ["rm"]);
    await user(u.rm, "Ravi Rm", ["rm"], u.manager);
    // Five finished last week, one the week before, one a check itself.
    for (let i = 1; i <= 5; i++) await done(`Call client ${i}`, `2026-10-2${i}T08:00:00Z`);
    await done("Old work", "2026-10-14T08:00:00Z");
    await done("Not sampled: a check", "2026-10-21T08:00:00Z", "qa_review");
    await q(sql`INSERT INTO dashboard_settings (tenant_id, settings) VALUES (${tenant}::uuid,
      jsonb_build_object('qaSampling', '{"enabled": true, "percent": 40, "types": []}'::jsonb, 'leadStaleDays', 9))`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of ["notifications", "audit_log", "tasks", "dashboard_settings", "users", "branches"]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`);
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("samples 40% of last week's work (2 of 5) for the reporting manager, once", async () => {
    expect(await withSystem((tx) => qa.runQaSampling(tx, tenant, NOW))).toBe(2);
    expect(await withSystem((tx) => qa.runQaSampling(tx, tenant, NOW))).toBe(0);
    const c = await checks();
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.assignee_id === u.manager && x.meta.qaDoerId === u.rm && x.meta.qaWeek === "2026-W43")).toBe(true);
    const titles = await rows<{ title: string }>(sql`SELECT title FROM tasks WHERE id = ANY(${`{${c.map((x) => x.meta.qaOf).join(",")}}`}::uuid[])`);
    expect(titles.every((t) => t.title.startsWith("Call client"))).toBe(true);
  });

  it("a pass closes the check and stamps the task checked", async () => {
    const [first] = await checks();
    const r = await withSystem((tx) => qa.recordQaResult(tx, { tenantId: tenant, userId: u.manager, roles: ["rm"] }, first.id, { result: "pass" }));
    expect(r).toEqual({ ok: true, correctionTaskId: null });
    const [orig] = await rows<{ meta: any }>(sql`SELECT meta FROM tasks WHERE id = ${first.meta.qaOf}::uuid`);
    expect(orig.meta.qaResult.result).toBe("pass");
    expect((await checks())[0].status).toBe("completed");
  });

  it("refuses someone who is not the checker, and a second verdict", async () => {
    const [first, second] = await checks();
    const notMine = await withSystem((tx) => qa.recordQaResult(tx, { tenantId: tenant, userId: u.rm, roles: ["rm"] }, second.id, { result: "pass" }));
    expect(notMine).toMatchObject({ status: 403 });
    const again = await withSystem((tx) => qa.recordQaResult(tx, { tenantId: tenant, userId: u.manager, roles: ["rm"] }, first.id, { result: "fail", reason: "Other" }));
    expect(again).toMatchObject({ status: 409 });
  });

  it("a fail gives the doer a correction task and is audited", async () => {
    const [, second] = await checks();
    const r = await withSystem((tx) => qa.recordQaResult(tx, { tenantId: tenant, userId: u.manager, roles: ["rm"] }, second.id, { result: "fail", reason: "Steps skipped", note: "No call notes" }));
    expect("correctionTaskId" in r && r.correctionTaskId).toBeTruthy();
    const [c] = await rows<{ assignee_id: string; type: string; description: string }>(sql`
      SELECT assignee_id::text, type, description FROM tasks WHERE id = ${(r as any).correctionTaskId}::uuid`);
    expect(c).toMatchObject({ assignee_id: u.rm, type: "qa_correction" });
    expect(c.description).toContain("Steps skipped");
    const [a] = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${tenant}::uuid AND action = 'task.qa_reviewed'`);
    expect(a.n).toBe(2);
  });
});
