/**
 * An email that cannot go anywhere — the firm has no email account connected
 * and the platform has no Resend key — fails with a message that says so. It
 * used to be recorded as "Provider outcome unknown; reconciliation required.
 * RESEND_API_KEY not set", which reads as if the email might have been sent.
 *
 * DB-backed: needs a migrated Postgres in TEST_DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("dispatch: an email with no email account to send from", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let dispatch: typeof import("@/lib/comms/pipeline").dispatch;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const investor = randomUUID();
  const tpl = randomUUID();
  const ver = randomUUID();
  const savedKey = process.env.RESEND_API_KEY;

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    delete process.env.RESEND_API_KEY;
    ({ withSystem } = await import("@/db/client"));
    ({ dispatch } = await import("@/lib/comms/pipeline"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'No Mail Test', 'No Mail Test', ${"ARN-NM-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, email, pan, dedup_pan) VALUES (${investor}::uuid, ${tenant}::uuid, 'Test Client', 'client@example.com', 'AAAPN1234A', true)`);
    await q(sql`INSERT INTO templates (id, tenant_id, key, channel, name, category, locale, status, current_version_id)
                VALUES (${tpl}::uuid, ${tenant}::uuid, 'plain_hello', 'email', 'Plain hello', 'utility', 'en-IN', 'approved', ${ver}::uuid)`);
    await q(sql`INSERT INTO template_versions (id, template_id, tenant_id, version_number, body, variables, attachments, approval_status)
                VALUES (${ver}::uuid, ${tpl}::uuid, ${tenant}::uuid, 1,
                        ${JSON.stringify({ subject: "Hello", text: "Hello from the firm." })}::jsonb, '[]'::jsonb, '[]'::jsonb, 'approved_internal')`);
  }, 120_000);

  afterAll(async () => {
    if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
    if (!withSystem) return;
    for (const t of ["communication_delivery_attempts", "communication_deliveries", "communications", "template_versions", "templates", "investors"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("fails saying no email account is connected — not 'outcome unknown'", async () => {
    const r = await withSystem((tx) =>
      dispatch(tx, { tenantId: tenant, channel: "email", templateKey: "plain_hello", recipient: "client@example.com", category: "transactional", investorId: investor } as any),
    );
    expect(r.status).toBe("failed");
    const reason = String((r as any).error ?? "");
    expect(reason).toContain("No email account is connected");
    expect(reason).not.toContain("outcome unknown");
    expect(reason).not.toContain("reconciliation");
  }, 60_000);
});
