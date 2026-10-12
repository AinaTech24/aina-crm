/**
 * Phase 3I — applying an AMFI NAVAll file (download or an authentic export
 * supplied as a file): provenance recorded, refusals write nothing, an older
 * file never overwrites a newer NAV or identity, a scheme listed without a NAV
 * stays listed, and the firms' registrar codes are re-decided against it.
 * Synthetic rows in AMFI's published eight-column layout.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cleanupSchemeMap } from "./scheme-map-cleanup";
import { GLOBAL_AMFI_LOCK_TIMEOUT_MS, lockGlobalAmfi } from "./helpers/global-amfi-lock";

const TEST_DB = process.env.TEST_DATABASE_URL;
const H8 = "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date";
const C = { a: "990000101", b: "990000102", c: "990000103" }; // numeric, as AMFI prints them; outside the real range
const feed = (date: string, navA: string, extra: string[] = []) => [H8, "", "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)", "", "Jota Mutual Fund", "",
  `${C.a};INF9J0A01AA1;;Jota Flexi Cap Fund;Regular Plan;Growth;${navA};${date}`,
  `${C.b};INF9J0A01BB2;INF9J0A01CC3;Jota Flexi Cap Fund;Regular Plan;IDCW;12.5;${date}`,
  ...extra].join("\r\n");

describe.skipIf(!TEST_DB)("AMFI NAVAll import (DB)", () => {
  // Global AMFI reference state: one such file at a time (tests/helpers/global-amfi-lock.ts).
  let unlockAmfi: (() => Promise<void>) | null = null;
  beforeAll(async () => { unlockAmfi = await lockGlobalAmfi(TEST_DB!); }, GLOBAL_AMFI_LOCK_TIMEOUT_MS);
  afterAll(async () => { await unlockAmfi?.(); });
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let F: typeof import("@/lib/finance/nav-feed");
  const t = randomUUID();
  const ids: string[] = [];
  const nav = async (code: string) => withSystem(async (tx) => (await tx.execute(sql`SELECT nav::float8 AS nav, nav_date::text AS nav_date, plan, option_name, isin_payout_growth, isin_reinvest, last_seen_feed::text AS last_seen FROM scheme_nav WHERE scheme_code = ${code}`)).rows[0] as any);
  const apply = async (body: string, o: Partial<Parameters<typeof F.importNavAll>[1]> = {}) => {
    const r = await F.importNavAll(body, { source: "file", sourceRef: "synthetic.txt", note: "Phase 3I test", today: "2026-10-08", ...o });
    ids.push(r.id);
    return r;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.NAV_FEED_MIN_RECORDS = "2"; // a synthetic file of two schemes
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    F = await import("@/lib/finance/nav-feed");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Feed firm', 'Feed firm', ${"ARN-FJ" + t.slice(0, 6)})`);
      // A registrar code seen before the feed carried its ISIN.
      await tx.execute(sql`INSERT INTO scheme_rta_codes (tenant_id, rta, rta_amc_code, rta_scheme_code, observed_isins, observed_name, status)
        VALUES (${t}::uuid, 'kfintech', '197', '197FCRG', ARRAY['INF9J0A01AA1'], 'Jota Flexi Cap Fund - Regular Growth', 'unresolved')`);
    });
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    await tryRun(sql`DELETE FROM scheme_rta_codes WHERE tenant_id = ${t}::uuid`);
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
    await cleanupSchemeMap(withSystem as any, sql, Object.values(C));
    await tryRun(sql`DELETE FROM scheme_nav WHERE scheme_code IN (${C.a}, ${C.b}, ${C.c})`);
    if (ids.length) await tryRun(sql`DELETE FROM amfi_feed_imports WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    delete process.env.NAV_FEED_MIN_RECORDS;
  });

  it("a current file is applied as printed — both ISIN columns, plan, option, NAV and its own date — with its SHA-256 recorded; registrar codes are re-decided", async () => {
    const body = feed("07-Oct-2026", "100.5", [`${C.c};INF9J0A01DD4;;Jota Unpriced Fund;Regular Plan;Growth;N.A.;07-Oct-2026`]);
    const r = await apply(body);
    expect(r).toMatchObject({ status: "applied", layout: "current8", feedDate: "2026-10-07", withNav: 2, withoutNav: 1, stale: false });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await nav(C.a)).toMatchObject({ nav: 100.5, nav_date: "2026-10-07", plan: "Regular Plan", option_name: "Growth", isin_payout_growth: "INF9J0A01AA1", isin_reinvest: null, last_seen: "2026-10-07" });
    expect(await nav(C.b)).toMatchObject({ isin_payout_growth: "INF9J0A01BB2", isin_reinvest: "INF9J0A01CC3" });
    expect(await nav(C.c)).toBeUndefined(); // no NAV, no priced row — identity kept in the import record
    const rec = await withSystem(async (tx) => (await tx.execute(sql`SELECT sha256, status, unpriced FROM amfi_feed_imports WHERE id = ${r.id}::uuid`)).rows[0] as any);
    expect(rec).toMatchObject({ sha256: r.sha256, status: "applied" });
    expect(rec.unpriced).toEqual([expect.objectContaining({ code: C.c, isinPayoutGrowth: "INF9J0A01DD4" })]);
    const code = await withTenant(t, async (tx) => (await tx.execute(sql`SELECT status, reason_code, amfi_scheme_code FROM scheme_rta_codes WHERE tenant_id = ${t}::uuid`)).rows[0]);
    expect(code).toMatchObject({ status: "resolved_isin", reason_code: "isin_verified", amfi_scheme_code: C.a });
  });

  it("an OLDER file — even allowed as historical — never overwrites a newer NAV; a stale file is refused unless allowed", async () => {
    const stale = await apply(feed("20-Sep-2026", "90"));
    expect(stale).toMatchObject({ status: "rejected", reason: expect.stringMatching(/older than/) });
    const old = await apply(feed("20-Sep-2026", "90"), { allowStale: true });
    expect(old).toMatchObject({ status: "applied", written: 0, keptNewer: 2 });
    expect(await nav(C.a)).toMatchObject({ nav: 100.5, nav_date: "2026-10-07" });
  });

  it("refused, nothing written: a future date, a reordered header, too few schemes, a code printed twice differently", async () => {
    expect(await apply(feed("10-Oct-2026", "1"))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/future/) });
    expect(await apply(feed("07-Oct-2026", "1").replace("Plan;Option", "Option;Plan"))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/unrecognised header/) });
    expect(await apply([H8, "Jota Mutual Fund", `${C.a};INF9J0A01AA1;;Jota Flexi Cap Fund;Regular Plan;Growth;1;07-Oct-2026`].join("\n"))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/only 1 schemes/) });
    expect(await apply(feed("07-Oct-2026", "100.5", [`${C.a};INF9J0A01AA1;;Jota Flexi Cap Fund;Regular Plan;Growth;101;07-Oct-2026`]))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/listed twice/) });
    expect(await nav(C.a)).toMatchObject({ nav: 100.5 });
    const rejected = await withSystem(async (tx) => (await tx.execute(sql`SELECT count(*)::int AS n FROM amfi_feed_imports WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND status = 'rejected'`)).rows[0] as any);
    expect(rejected.n).toBe(5);
  });

  it("a scheme the newest feed lists without a NAV stays listed (not inactive); its old NAV keeps its own date", async () => {
    const r = await apply(feed("08-Oct-2026", "N.A.", [`${C.c};INF9J0A01DD4;;Jota Unpriced Fund;Regular Plan;Growth;10;08-Oct-2026`]));
    expect(r.status).toBe("applied");
    expect(await nav(C.a)).toMatchObject({ nav: 100.5, nav_date: "2026-10-07", last_seen: "2026-10-08" });
  });
});
