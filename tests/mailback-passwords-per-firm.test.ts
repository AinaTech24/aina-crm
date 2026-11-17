/**
 * A firm's CAMS / KFintech ZIP passwords belong to that firm alone: they are
 * stored per tenant, and every path that opens an archive (the mail poller,
 * upload, re-import, the rejected-file rescan) loads the passwords of the
 * firm the file belongs to — never another firm's.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("mailback ZIP passwords are per firm", () => {
  const a = randomUUID();
  const b = randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let cfg: typeof import("@/lib/rta/mailback-config");
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    cfg = await import("@/lib/rta/mailback-config");
    for (const [id, n] of [[a, "A"], [b, "B"]]) {
      await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${"Firm " + n}, ${"Firm " + n}, ${"ARN-PW-" + id.slice(0, 6)})`);
    }
    await withSystem(async (tx) => {
      await cfg.saveMailbackPasswords(tx, a, { camsPassword: "alpha-cams", kfintechPassword: "alpha-kfin" });
      await cfg.saveMailbackPasswords(tx, b, { camsPassword: "beta-cams" });
    });
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM tenant_integrations WHERE tenant_id IN (${a}::uuid, ${b}::uuid)`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id IN (${a}::uuid, ${b}::uuid)`).catch(() => {});
  });

  it("each firm's passwords to try are its own and no one else's", async () => {
    const pa = await withSystem(async (tx) => cfg.passwordsToTry(await cfg.getMailbackPasswords(tx, a), "cams"));
    const pb = await withSystem(async (tx) => cfg.passwordsToTry(await cfg.getMailbackPasswords(tx, b), "kfintech"));
    expect([...pa].sort()).toEqual(["alpha-cams", "alpha-kfin"]);
    expect(pb).toEqual(["beta-cams"]);
    expect(pb).not.toContain("alpha-cams");
    expect(pa).not.toContain("beta-cams");
  });

  it("adding a password for one firm leaves the other firm's list alone", async () => {
    await withSystem((tx) => cfg.appendMailbackPassword(tx, b, "kfintech", { label: "Added", password: "beta-kfin" }));
    const pa = await withSystem(async (tx) => cfg.passwordsToTry(await cfg.getMailbackPasswords(tx, a), "kfintech"));
    const pb = await withSystem(async (tx) => cfg.passwordsToTry(await cfg.getMailbackPasswords(tx, b), "kfintech"));
    expect([...pb].sort()).toEqual(["beta-cams", "beta-kfin"]);
    expect(pa).not.toContain("beta-kfin");
  });

  it("a firm with nothing saved has nothing to try (never a neighbour's password)", async () => {
    const c = randomUUID();
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${c}::uuid, 'Firm C', 'Firm C', ${"ARN-PW-" + c.slice(0, 6)})`);
    try {
      const pc = await withSystem(async (tx) => cfg.passwordsToTry(await cfg.getMailbackPasswords(tx, c), "cams"));
      expect(pc).toEqual([]);
    } finally {
      await q(sql`DELETE FROM tenants WHERE id = ${c}::uuid`).catch(() => {});
    }
  });
});
