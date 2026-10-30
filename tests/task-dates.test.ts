/**
 * A task's entry date and closed date (migration 0254). Needs a migrated
 * Postgres in TEST_DATABASE_URL; skipped otherwise.
 *
 *   entry_date  defaults to today (India) on insert, or is what the form sent
 *   completed_at is set when status BECOMES completed, kept on a re-save, and
 *               cleared when the task is reopened
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("task entry and closed dates", () => {
  const tenant = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const row = async (id: string) =>
    (await q(sql`SELECT status, entry_date::text AS entry_date, completed_at, (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today FROM tasks WHERE id = ${id}::uuid`))
      .rows[0] as { status: string; entry_date: string; completed_at: string | null; today: string };
  const add = (id: string, status = "open", entry: string | null = null) =>
    q(sql`INSERT INTO tasks (id, tenant_id, subject_type, type, title, status, entry_date) VALUES (${id}::uuid, ${tenant}::uuid, 'internal', 'follow_up', 'Call', ${status}, ${entry}::date)`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Task Dates', 'Task Dates', ${"ARN-TD-" + tenant.slice(0, 6)})`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM tasks WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("the entry date is today unless the form sent one", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await add(a);
    await add(b, "open", "2026-10-01");
    const ra = await row(a);
    expect(ra.entry_date).toBe(ra.today);
    expect((await row(b)).entry_date).toBe("2026-10-01");
  });

  it("completing stamps the closed date; a re-save keeps it; reopening clears it", async () => {
    const id = randomUUID();
    await add(id);
    expect((await row(id)).completed_at).toBeNull();

    await q(sql`UPDATE tasks SET status = 'completed' WHERE id = ${id}::uuid`);
    const first = (await row(id)).completed_at;
    expect(first).not.toBeNull();

    await q(sql`SELECT pg_sleep(0.05)`);
    await q(sql`UPDATE tasks SET status = 'completed', title = 'Call again' WHERE id = ${id}::uuid`);
    expect((await row(id)).completed_at).toEqual(first);

    await q(sql`UPDATE tasks SET status = 'in_progress' WHERE id = ${id}::uuid`);
    expect((await row(id)).completed_at).toBeNull();
  });

  it("a task created already completed is closed at once", async () => {
    const id = randomUUID();
    await add(id, "completed");
    expect((await row(id)).completed_at).not.toBeNull();
  });
});
