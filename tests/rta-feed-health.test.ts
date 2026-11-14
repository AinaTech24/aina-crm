/**
 * When a firm's registrar data stops updating, the owner is told — the two
 * silent failures of 15 Oct 2026 (Ahpal's reports no saved password opened;
 * We Care's mailbox empty since July).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideFeedAlerts } from "@/lib/rta/feed-health";

const now = new Date("2026-10-15T06:30:00Z");
const on = { forwardingOn: true, lastMailAt: "2026-10-15T04:00:00Z" };

describe("decideFeedAlerts", () => {
  it("reports a registrar whose files keep arriving but cannot be opened", () => {
    const a = decideFeedAlerts([{ source: "kfintech", lastGood: "2026-10-08T05:00:00Z", lockedSince: 37, firstLockedAt: "2026-10-08T10:00:00Z" }], on, now);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "rta.feed_locked", source: "kfintech" });
    expect(a[0].body).toContain("37 KFintech reports");
    expect(a[0].body).toContain("8 Oct");
  });

  it("stays quiet while the registrar still imports, or for a stray foreign file", () => {
    expect(decideFeedAlerts([{ source: "cams", lastGood: "2026-10-14T05:00:00Z", lockedSince: 40, firstLockedAt: "2026-10-13T05:00:00Z" }], on, now)).toEqual([]);
    expect(decideFeedAlerts([{ source: "cams", lastGood: "2026-10-01T05:00:00Z", lockedSince: 1, firstLockedAt: "2026-10-02T05:00:00Z" }], on, now)).toEqual([]);
  });

  it("reports a mailbox that has received nothing for a week", () => {
    const a = decideFeedAlerts([], { forwardingOn: true, lastMailAt: "2026-07-11T06:16:00Z", address: "wecare@in.example" }, now);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("rta.no_mail");
    expect(a[0].body).toContain("11 Jul");
    expect(a[0].body).toContain("wecare@in.example");
  });

  it("does not report a mailbox the firm never switched on", () => {
    expect(decideFeedAlerts([], { forwardingOn: false, lastMailAt: "2026-07-11T06:16:00Z" }, now)).toEqual([]);
  });

  it("says so the day a file is refused, even while the registrar's other reports import", () => {
    // CAMS' AUM statement imported an hour ago, but its transaction feed was refused: a password is set on each request.
    const a = decideFeedAlerts([{ source: "cams", lastGood: "2026-10-15T05:00:00Z", lockedSince: 0, firstLockedAt: null, rejectedRecent: 3 }], on, now);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "rta.password_rejected", source: "cams" });
    expect(a[0].title).toContain("3 CAMS files");
    expect(a[0].body).toContain("key button");
  });

  it("a registrar with nothing but refused files has no good import and is still reported", () => {
    const a = decideFeedAlerts([{ source: "kfintech", lastGood: null, lockedSince: 2, firstLockedAt: "2026-10-14T05:00:00Z", rejectedRecent: 1 }], on, now);
    expect(a.map((x) => x.kind)).toEqual(["rta.password_rejected"]);
    expect(a[0].title).toContain("1 KFintech file ");
  });

  it("the stronger 'not updating' alert replaces it, never both", () => {
    const a = decideFeedAlerts([{ source: "kfintech", lastGood: "2026-10-08T05:00:00Z", lockedSince: 37, firstLockedAt: "2026-10-08T10:00:00Z", rejectedRecent: 5 }], on, now);
    expect(a.map((x) => x.kind)).toEqual(["rta.feed_locked"]);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("checkRtaFeedHealth against the database", () => {
  const tenant = crypto.randomUUID();
  const owner = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let check: typeof import("@/lib/rta/feed-health").checkRtaFeedHealth;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const file = (source: string, status: string, rows: number, ago: string) =>
    q(sql`INSERT INTO rta_file_imports (tenant_id, source, kind, period_start, period_end, file_name, file_key, status, rows_imported, created_at)
          VALUES (${tenant}::uuid, ${source}, 'daily_transaction_feed', current_date, current_date, ${source + "-" + Math.random()}, 'k', ${status}, ${rows}, now() - ${ago}::interval)`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ checkRtaFeedHealth: check } = await import("@/lib/rta/feed-health"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Feed Firm', 'Feed Firm', ${"ARN-FH-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${owner}::uuid, ${tenant}::uuid, ${"fh-" + owner.slice(0, 6) + "@t.in"}, 'Owner', ARRAY['owner']::text[], 'active')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM notifications WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM rta_file_imports WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("a refused CAMS file is reported the same day even though another CAMS file imported, once a day", async () => {
    await file("cams", "completed", 26702, "1 hour");
    await file("cams", "rejected", 0, "2 hours");
    expect(await withTenant(tenant, (tx) => check(tx, tenant))).toBe(1);
    const n = await q(sql`SELECT kind, title FROM notifications WHERE tenant_id = ${tenant}::uuid`);
    expect((n.rows[0] as any).kind).toBe("rta.password_rejected");
    expect((n.rows[0] as any).title).toContain("1 CAMS file");
    // Said once a day, not on every nightly pass.
    expect(await withTenant(tenant, (tx) => check(tx, tenant))).toBe(0);
  });

  it("a registrar whose every file was refused is reported too", async () => {
    await file("kfintech", "rejected", 0, "3 hours");
    expect(await withTenant(tenant, (tx) => check(tx, tenant))).toBe(1);
    const n = await q(sql`SELECT title FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'rta.password_rejected' ORDER BY created_at DESC LIMIT 1`);
    expect((n.rows[0] as any).title).toContain("KFintech file");
  });
});
