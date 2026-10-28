/**
 * The vendor's starter emails reach a firm the first time they are used, and a
 * workflow that names a template the firm never made gets it installed rather
 * than failing: installEmailStarters / ensureEmailStarter. DB-backed (TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("installEmailStarters", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let mod: typeof import("@/lib/templates/install-client-emails");
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const rows = async (key: string) =>
    (await q(sql`SELECT t.status, v.approval_status FROM templates t JOIN template_versions v ON v.id = t.current_version_id
                  WHERE t.tenant_id = ${tenant}::uuid AND t.key = ${key} AND t.channel = 'email'`)).rows as Array<{ status: string; approval_status: string }>;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    mod = await import("@/lib/templates/install-client-emails");
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Starter Test', 'Starter Test', ${"ARN-ST-" + tenant.slice(0, 6)})`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`UPDATE templates SET current_version_id = NULL WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM template_versions WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM templates WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("installs the two record emails as approved templates, once", async () => {
    const first = await withSystem((tx) => mod.installEmailStarters(tx, tenant, mod.RECORD_EMAIL_TEMPLATE_KEYS));
    expect(first.installed.sort()).toEqual(["sip_rejection", "switch_stp_swp"]);
    const again = await withSystem((tx) => mod.installEmailStarters(tx, tenant, mod.RECORD_EMAIL_TEMPLATE_KEYS));
    expect(again.installed).toEqual([]);
    expect(again.skipped.sort()).toEqual(["sip_rejection", "switch_stp_swp"]);
    expect(await rows("sip_rejection")).toEqual([{ status: "approved", approval_status: "approved_internal" }]);
  });

  it("installs the starter under the old name a published workflow still uses", async () => {
    expect(await rows("sip_rejection_mandate_expired_email")).toHaveLength(0);
    expect(await withSystem((tx) => mod.ensureEmailStarter(tx, tenant, "sip_rejection_mandate_expired_email"))).toBe(true);
    expect(await rows("sip_rejection_mandate_expired_email")).toHaveLength(1);
    // and a second run adds nothing
    await withSystem((tx) => mod.ensureEmailStarter(tx, tenant, "sip_rejection_mandate_expired_email"));
    expect(await rows("sip_rejection_mandate_expired_email")).toHaveLength(1);
  });

  it("installs only the record emails and their old names — not other starters, not firm templates", async () => {
    expect(await withSystem((tx) => mod.ensureEmailStarter(tx, tenant, "a_template_the_firm_never_made"))).toBe(false);
    // A real starter that is not on the list is not installed this way: what is
    // installed here is approved with nobody's sign-off.
    const { STARTER_TEMPLATES } = await import("@/lib/email-designer/starters");
    const other = STARTER_TEMPLATES.find((s) => !(mod.RECORD_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(s.key) && !mod.EMAIL_STARTER_ALIASES[s.key]);
    expect(other).toBeDefined();
    expect(await withSystem((tx) => mod.ensureEmailStarter(tx, tenant, other!.key))).toBe(false);
    expect(await rows(other!.key)).toHaveLength(0);
  });

  it("leaves a template the firm archived alone", async () => {
    await q(sql`UPDATE templates SET status = 'archived' WHERE tenant_id = ${tenant}::uuid AND key = 'switch_stp_swp'`);
    const r = await withSystem((tx) => mod.installEmailStarters(tx, tenant, ["switch_stp_swp"]));
    expect(r.installed).toEqual([]);
    expect((await rows("switch_stp_swp"))[0].status).toBe("archived");
  });
});
