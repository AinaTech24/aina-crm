/**
 * An email never opens a service request (the firm's decision of 2026-10-16),
 * and "Close email requests" clears the ones it once opened.
 *
 * The first half needs no database: it reads the source. An incoming email
 * reaches the CRM through the mailbox poller; nothing it calls may create a
 * ticket, and the only code that does create one from a message (the WhatsApp
 * intake) cannot be told the channel is "email".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "src");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(f);
  }
  return out;
}

describe("incoming email does not open a service request", () => {
  it("the mailbox poller touches no ticket code", () => {
    const src = read("workers/imap-poller.ts");
    expect(src).not.toMatch(/createServiceRequest|openServiceRequest|from "@\/lib\/service\/|from "@\/lib\/service-requests\//);
    expect(src).not.toMatch(/INSERT INTO service_requests|insert\(serviceRequests\)/i);
  });

  it("only the WhatsApp intake uses createServiceRequest", () => {
    const users = walk(root)
      .filter((f) => /createServiceRequest\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1).replace(/\\/g, "/"))
      .sort();
    expect(users).toEqual(["lib/comms/auto-responder.ts", "lib/service/create-request.ts"]);
  });

  it("the WhatsApp intake is not offered the email channel", () => {
    const src = read("lib/service/create-request.ts");
    const channel = src.match(/channel\?: ([^;]+);/)?.[1] ?? "";
    expect(channel).toContain("whatsapp");
    expect(channel).not.toContain("email");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("closeEmailIntakeTickets", () => {
  const tenant = randomUUID();
  const owner = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let count: typeof import("@/lib/service-requests/email-intake").countEmailIntakeTickets;
  let close: typeof import("@/lib/service-requests/email-intake").closeEmailIntakeTickets;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  const ticket = (no: string, o: { channel?: string; note?: string; assignee?: string | null; by?: string; status?: string } = {}) =>
    q(sql`INSERT INTO service_requests (tenant_id, ticket_no, type, channel, subject, description, priority, status, assigned_to_user_id, timeline)
          VALUES (${tenant}::uuid, ${no}, 'statement_request', ${o.channel ?? "email"}, 'Please send', 'Please send', 'normal', ${o.status ?? "escalated"},
                  ${o.assignee ?? null}::uuid,
                  ${JSON.stringify([{ at: new Date().toISOString(), by: "system", event: "created", note: o.note ?? "Created by Email intake" }, ...(o.by ? [{ at: new Date().toISOString(), by: o.by, event: "note", note: "called" }] : [])])}::jsonb)`);

  const statusOf = async (no: string) =>
    ((await q(sql`SELECT status FROM service_requests WHERE tenant_id = ${tenant}::uuid AND ticket_no = ${no}`)).rows[0] as { status: string }).status;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ countEmailIntakeTickets: count, closeEmailIntakeTickets: close } = await import("@/lib/service-requests/email-intake"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Close Test', 'Close Test', ${"ARN-CE-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, 'o@firm.example', 'Owner', ARRAY['owner']::text[], 'active')`);
    await ticket("T-1"); // untouched email intake → closed
    await ticket("T-2", { status: "open" }); // open one too
    await ticket("T-3", { assignee: owner }); // someone owns it → kept
    await ticket("T-4", { by: owner }); // a person added to the timeline → kept
    await ticket("T-5", { channel: "form", note: "Created by the service request form" }); // a client's own form → kept
    await ticket("T-6", { channel: "email", note: "Logged by the RM" }); // an RM logged an emailed request → kept
    await ticket("T-7", { status: "closed" }); // already closed
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["audit_log", "service_requests", "users"]) await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("counts only open, untouched tickets the email intake opened", async () => {
    expect(await withSystem((tx) => count(tx, tenant))).toBe(2);
  });

  it("closes those and nothing else", async () => {
    const n = await withSystem((tx) => close(tx, { tenantId: tenant, actorUserId: owner, actorName: "Owner" }));
    expect(n).toBe(2);
    expect(await statusOf("T-1")).toBe("closed");
    expect(await statusOf("T-2")).toBe("closed");
    for (const no of ["T-3", "T-4", "T-5", "T-6"]) expect(await statusOf(no)).toBe("escalated");
    expect(await withSystem((tx) => count(tx, tenant))).toBe(0);
    // A second press closes nothing.
    expect(await withSystem((tx) => close(tx, { tenantId: tenant, actorUserId: owner }))).toBe(0);
  });
});
