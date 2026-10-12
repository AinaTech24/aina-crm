/**
 * B-1 stabilisation — the owner's decisions I-1 to I-3 (2026-10-12), end to end
 * on the legacy importer (the path production firms use today):
 *
 *   I-1  a folio filed under a PAN-less import placeholder is HELD, never moved;
 *   I-2  a PAN that two live client records carry is HELD, never guessed;
 *   I-3  a folio filed under another verified client is HELD, never reassigned.
 *
 * Each hold leaves current ownership and history untouched, says why in an
 * actionable Exceptions category with no PAN in it, and is resolved only by an
 * audited person (Merge Clients); the same file then imports exactly once, and
 * a further re-run changes nothing. Synthetic data, real Postgres (RLS on).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("ownership holds I-1 – I-3: held, visible, resolved by an audited person, then imported once (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let processRtaFile: typeof import("@/lib/rta/process").processRtaFile;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;
  let mergeInvestors: typeof import("@/lib/investors/merge").mergeInvestors;
  let EXCEPTION_REASONS: typeof import("@/lib/rta/exceptions").EXCEPTION_REASONS;

  const t = randomUUID();
  const user = randomUUID();
  const id = { placeholder: randomUUID(), client: randomUUID(), twinA: randomUUID(), twinB: randomUUID(), owner: randomUUID(), other: randomUUID() };
  const PAN = { client: "QQQPQ1111Q", twin: "QQQPR2222R", owner: "QQQPS3333S", other: "QQQPT4444T" };

  const H = "FOLIO_NO|PAN|AMC_CODE|SCH_CODE|SCH_NAME|TRXN_TYPE|TRXN_NATURE|TRADDATE|AMOUNT|UNITS|NAV|TRXNNO";
  const feed = (folio: string, pan: string, ref: string) => [H, `${folio}|${pan}|X|S01|Example Scheme - Growth|PURCHASE||02/10/2024|1,000.00|12.3456|81.00|${ref}`].join("\n");
  const run = (text: string) => withTenant(t, (tx) => processRtaFile(tx, { tenantId: t, source: "cams", kind: "daily_transaction_feed", text }));
  const master = (folio: string, pan: string, name: string) => withTenant(t, (tx) => importRtaFolios(tx, t, [{
    rta: "cams", amcCode: "X", amcName: "X Mutual Fund", folioNumber: folio, schemes: [],
    investor: { pan, name, category: "individual" }, nominees: [], bank: {},
  }], { kind: "master" }));
  const q = async <T = any>(s: ReturnType<typeof import("drizzle-orm").sql>) => withTenant(t, async (tx) => (await tx.execute(s)).rows as T[]);
  const category = (reason: string) => EXCEPTION_REASONS.find((c) => c.pattern && new RegExp(c.pattern, "i").test(reason))?.key ?? "technical";
  const merge = (survivorId: string, loserId: string, reason: string) =>
    withTenant(t, (tx) => mergeInvestors(tx, { tenantId: t, survivorId, loserId, byUserId: user, source: "manual", reason }));
  const audited = async (loserId: string) => (await q(sql`SELECT count(*)::int n FROM investor_merges WHERE tenant_id = ${t}::uuid AND loser_id = ${loserId}::uuid`))[0].n;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ processRtaFile } = await import("@/lib/rta/process"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));
    ({ mergeInvestors } = await import("@/lib/investors/merge"));
    ({ EXCEPTION_REASONS } = await import("@/lib/rta/exceptions"));
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Ownership holds', 'Ownership holds', ${"ARN-OH" + t.slice(0, 6)})`);
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${user}::uuid, ${t}::uuid, ${`oh-${t.slice(0, 8)}@example.test`}, 'Reviewer', ARRAY['owner']::text[], 'active')`);
      const inv = (i: string, pan: string | null, name: string, extra = sql``) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan ${extra}) VALUES (${i}::uuid, ${t}::uuid, ${pan}, ${name}, ${pan ? sql`true` : sql`false`})`);
      // I-1: a PAN-less placeholder an earlier report created, holding folio 7100001/11 and its history.
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rta_nopan_key) VALUES (${id.placeholder}::uuid, ${t}::uuid, NULL, 'Placeholder Person', 'NOPAN:FOLIO:7100001/11')`);
      await inv(id.client, PAN.client, "Placeholder Person");
      // I-2: two live records carrying one PAN (an Excel twin beside a registrar record).
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan) VALUES (${id.twinA}::uuid, ${t}::uuid, ${PAN.twin}, 'Twin Person', true)`);
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan) VALUES (${id.twinB}::uuid, ${t}::uuid, ${PAN.twin}, 'Twin Person', false)`);
      // I-3: folio 7300003/33 belongs to one verified client; a row names another.
      await inv(id.owner, PAN.owner, "Folio Owner");
      await inv(id.other, PAN.other, "Other Client");
    });
    // History: the placeholder's folio and a transaction on it; the owner's folio and a transaction on it.
    expect((await run(feed("7100001/11", "", "OH-PH-1"))).rowsImported).toBe(1);
    expect((await run(feed("7300003/33", PAN.owner, "OH-OW-1"))).rowsImported).toBe(1);
  });

  afterAll(async () => {
    const tryRun = async (s: ReturnType<typeof sql>) => { try { await withSystem((tx) => tx.execute(s)); } catch { /* best effort */ } };
    for (const table of ["investor_merges", "audit_log", "sips", "transactions", "folios"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`UPDATE investors SET merged_into_id = NULL WHERE tenant_id = ${t}::uuid`);
    for (const table of ["investors", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("I-1: a placeholder's folio is held — not moved, history kept, actionable, no PAN — and imports once after an audited merge", async () => {
    const before = await q(sql`SELECT f.investor_id::text f, (SELECT investor_id::text FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-PH-1') tx FROM folios f WHERE f.tenant_id = ${t}::uuid AND f.folio_number = '7100001/11'`);
    const s = await master("7100001/11", PAN.client, "Placeholder Person");
    const held = s.exceptions.find((e) => /import placeholder/.test(e.reason))!;
    expect(held).toBeTruthy();
    expect(category(held.reason)).toBe("identity_review");
    expect(held.reason).not.toMatch(new RegExp(PAN.client));
    expect(await q(sql`SELECT f.investor_id::text f, (SELECT investor_id::text FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-PH-1') tx FROM folios f WHERE f.tenant_id = ${t}::uuid AND f.folio_number = '7100001/11'`)).toEqual(before);
    expect(before[0]).toEqual({ f: id.placeholder, tx: id.placeholder });
    expect(await audited(id.placeholder)).toBe(0);

    // A person decides: the placeholder IS the PAN client. The merge is audited and moves the folio with its history.
    expect("ok" in (await merge(id.client, id.placeholder, "placeholder is the PAN client — checked against the registrar statement"))).toBe(true);
    expect(await audited(id.placeholder)).toBe(1);
    const again = await master("7100001/11", PAN.client, "Placeholder Person");
    expect(again.exceptions.filter((e) => /7100001\/11/.test(e.reason))).toEqual([]);
    expect(await q(sql`SELECT investor_id::text i FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '7100001/11'`)).toEqual([{ i: id.client }]);
    expect(await q(sql`SELECT investor_id::text i FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-PH-1'`)).toEqual([{ i: id.client }]);
    // Retry is safe: the same history row re-reported is not a second transaction.
    const rerun = await run(feed("7100001/11", PAN.client, "OH-PH-1"));
    expect(rerun.rowsImported).toBe(0);
    expect((await q(sql`SELECT count(*)::int n FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-PH-1'`))[0].n).toBe(1);
  });

  it("I-2: a PAN two live records carry is held — neither is chosen, nothing merged — and imports once after an audited merge", async () => {
    const out = await run(feed("7200002/22", PAN.twin, "OH-TW-1"));
    expect(out.rowsImported).toBe(0);
    const reason = out.errors.map((e) => e.reason).join(" | ");
    expect(reason).toMatch(/2 different clients/);
    expect(category(out.errors[0].reason)).toBe("identity_review");
    expect(reason).not.toMatch(new RegExp(PAN.twin));
    expect((await q(sql`SELECT count(*)::int n FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-TW-1'`))[0].n).toBe(0);
    expect((await q(sql`SELECT count(*)::int n FROM investors WHERE tenant_id = ${t}::uuid AND pan = ${PAN.twin} AND merged_into_id IS NULL`))[0].n).toBe(2);

    expect("ok" in (await merge(id.twinA, id.twinB, "same person: one PAN, an Excel row beside the registrar record"))).toBe(true);
    expect(await audited(id.twinB)).toBe(1);
    const retry = await run(feed("7200002/22", PAN.twin, "OH-TW-1"));
    expect(retry.rowsImported).toBe(1);
    expect(await q(sql`SELECT investor_id::text i FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-TW-1'`)).toEqual([{ i: id.twinA }]);
    expect((await run(feed("7200002/22", PAN.twin, "OH-TW-1"))).rowsImported).toBe(0);
    expect((await q(sql`SELECT count(*)::int n FROM transactions WHERE tenant_id = ${t}::uuid AND order_id = 'OH-TW-1'`))[0].n).toBe(1);
  });

  it("I-3: a folio of another verified client is never reassigned; the hold repeats on every re-run with nothing written", async () => {
    for (let i = 0; i < 2; i++) {
      const out = await run(feed("7300003/33", PAN.other, `OH-OT-${i}`));
      expect(out.rowsImported).toBe(0);
      expect(out.errors[0].reason).toMatch(/different (client|PAN)/);
      expect(category(out.errors[0].reason)).toBe("identity_review");
      expect(out.errors[0].reason).not.toMatch(new RegExp(`${PAN.other}|${PAN.owner}`));
      const m = await master("7300003/33", PAN.other, "Other Client");
      expect(m.exceptions.some((e) => /different client/.test(e.reason))).toBe(true);
    }
    expect(await q(sql`SELECT investor_id::text i FROM folios WHERE tenant_id = ${t}::uuid AND folio_number = '7300003/33'`)).toEqual([{ i: id.owner }]);
    expect(await q(sql`SELECT order_id, investor_id::text i FROM transactions WHERE tenant_id = ${t}::uuid AND folio_number = '7300003/33' ORDER BY 1`)).toEqual([{ order_id: "OH-OW-1", i: id.owner }]);
    expect((await q(sql`SELECT count(*)::int n FROM folios WHERE tenant_id = ${t}::uuid AND investor_id = ${id.other}::uuid`))[0].n).toBe(0);
  });
});
