/**
 * G-1 final hardening (2026-10-14) — no read path hands anyone a guardian's
 * risk information through a minor, and no stale copy can pass for the minor's
 * own. Real PostgreSQL (RLS on, the restricted app role), real route handlers;
 * session and licence are mocked.
 *
 *   - the one rule: a MINOR's risk is the minor's own latest assessment, never
 *     the copy migration 0234 writes onto the row — on every read path (client
 *     list API, exports, history, filters, tab buckets, proposal PDF, AI);
 *   - removing a link removes the copy (edit, turning adult, merge, purge);
 *   - a typed guardian PAN that links nobody is said, never silent — and never
 *     says why;
 *   - a client's history follows the client's own access.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const TEST_DB = process.env.TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => h.session) }));
vi.mock("@/lib/auth/license", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/license")>()),
  assertActiveLicense: vi.fn(async () => {}),
  assertInvestorQuota: vi.fn(async () => {}),
  assertModuleEnabled: vi.fn(async () => {}),
}));
// The AI route must refuse before any model is asked; if it ever got that far
// the test would see this marker instead of a 404.
vi.mock("@/lib/ai/assistant", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/assistant")>()),
  generateQrrCommentary: vi.fn(async () => ({ text: "MODEL WAS CALLED" })),
}));

const L = "ABCDEFGHJKLMNQRSTUVWXYZ";
const r = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join("");
const pan = (type = "P") => `${r(3)}${type}${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;

describe.skipIf(!TEST_DB)("G-1 — guardian-derived risk on every read path (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let G: typeof import("@/lib/investors/guardian-link");
  const t = randomUUID();
  const owner = randomUUID(), rmA = randomUUID(), rmB = randomUUID();
  const gA = randomUUID(), gB = randomUUID();
  const PA = pan(), PB = pan();
  // gB's very_aggressive is the "secret" an RM A must never learn through a minor.
  const SECRET = "very_aggressive";
  const sess = (userId: string, roles: string[], permissions: string[] = []) => ({ userId, tenantId: t, roles, permissions, branchId: null, sid: "s" });
  const one = async (q: any) => withTenant(t, async (tx) => (await tx.execute(q)).rows[0] as any);
  const req = (method: string, url: string, body?: any) =>
    new NextRequest(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const json = async (res: Response) => { const text = await res.text(); return { status: res.status, text, body: text ? JSON.parse(text) : null }; };
  const post = async (body: any) => json(await (await import("@/app/api/investors/route")).POST(req("POST", "/api/investors", body)));
  const patch = async (id: string, body: any) =>
    json(await (await import("@/app/api/investors/[id]/route")).PATCH(req("PATCH", `/api/investors/${id}`, body), { params: Promise.resolve({ id }) }));
  const row = async (id: string) => one(sql`SELECT guardian_investor_id::text AS g, risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional FROM investors WHERE id = ${id}::uuid`);
  const minorBody = (gpan: string, extra: any = {}) => ({
    name: `Kid ${randomUUID().slice(0, 6)}`, investorCategory: "minor", dob: "2015-05-05", segmentTag: "Retail",
    typeDetails: { guardian: { name: "Typed Guardian", pan: gpan, relation: "father" } }, ...extra,
  });
  /** A minor in `rm`'s book linked straight in the database (a link made before the fix). */
  const legacyMinor = async (rm: string, guardian: string | null, name = "Legacy Kid") => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, is_minor, dob, guardian_investor_id, status)
      VALUES (${id}::uuid, ${t}::uuid, ${"MINOR:" + pan()}, ${name}, ${rm}::uuid, 'minor', true, '2014-01-01', ${guardian}::uuid, 'active')`));
    return id;
  };
  const ownAssessment = (id: string, cat: string, daysAgo = 1) => withTenant(t, (tx) => tx.execute(sql`
    INSERT INTO risk_profile_responses (tenant_id, investor_id, final_category, total_score, signed_at, provisional)
    VALUES (${t}::uuid, ${id}::uuid, ${cat}, 11, now() - make_interval(days => ${daysAgo}::int), false)`));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    G = await import("@/lib/investors/guardian-link");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn, restrict_user_data_scope) VALUES (${t}::uuid, 'G1x firm', 'G1x firm', ${"ARN-GX" + t.slice(0, 5)}, true)`);
      for (const [id, role, nm] of [[owner, "owner", "Owner"], [rmA, "rm", "RMA"], [rmB, "rm", "RMB"]] as const) {
        await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${t}::uuid, ${`${nm}-${id.slice(0, 8)}@example.test`}, ${nm}, ARRAY[${role}]::text[], 'active')`);
      }
    });
    await withTenant(t, async (tx) => {
      for (const [id, p, name, rm, risk] of [[gA, PA, "Parent In Book", rmA, "moderate"], [gB, PB, "Parent Other Book", rmB, SECRET]] as const) {
        await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional, status, dedup_pan)
          VALUES (${id}::uuid, ${t}::uuid, ${p}, ${name}, ${rm}::uuid, 'individual', '1980-01-01', ${risk}, 77, now() - interval '20 days', false, 'active', true)`);
      }
    });
  });

  afterAll(async () => {
    const tryRun = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    for (const table of ["investor_merges", "risk_profile_responses", "events_outbox", "audit_log", "idempotency_keys", "investors", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  /* ── Task 4: a refused typed PAN is said, never silent ──────────────── */
  it("refused typed PAN: create and edit answer guardianLinked:false + one notice that never says why; history records it without a reason", async () => {
    h.session = sess(rmA, ["rm"]);
    const notices = new Set<string>();
    // Outside the book, unknown, and an HUF-type PAN: one indistinguishable answer.
    for (const gp of [PB, pan(), pan("H")]) {
      const res = await post(minorBody(gp));
      expect(res.status).toBe(201);
      expect(res.body.guardianLinked).toBe(false);
      notices.add(res.body.guardianNotice);
      expect(res.text).not.toContain("Parent Other Book");
      expect(res.text).not.toContain(SECRET);
      const audit = await one(sql`SELECT count(*)::int AS n, max(after::text) AS after FROM audit_log WHERE entity_id = ${res.body.id}::uuid AND action = 'investor.guardian_not_linked'`);
      expect(audit.n).toBe(1);
      expect(JSON.parse(audit.after)).toEqual({ via: "pan" });
    }
    expect([...notices]).toEqual([G.GUARDIAN_PAN_NOT_LINKED]);
    // A typed PAN that links is not a notice.
    const ok = await post(minorBody(PA));
    expect(ok.body).toEqual({ id: ok.body.id, guardianLinked: true });
    // Edit: typing a PAN that links nobody says so too.
    const kid = await legacyMinor(rmA, null);
    const ed = await patch(kid, { typeDetails: { guardian: { name: "x", pan: PB, relation: "mother" } } });
    expect(ed.status).toBe(200);
    expect(ed.body.guardianNotice).toBe(G.GUARDIAN_PAN_NOT_LINKED);
    expect(ed.text).not.toContain(SECRET);
    // Saving something else does not repeat the notice.
    const again = await patch(kid, { notes: "n" });
    expect(again.body.guardianNotice).toBeUndefined();
  });

  it("typed PAN changed while linked: to an in-book client the link moves; to anyone else the link AND the copied profile go, with the notice", async () => {
    h.session = sess(owner, ["owner"]);
    const g2 = randomUUID(), P2 = pan();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_signed_at, dedup_pan)
      VALUES (${g2}::uuid, ${t}::uuid, ${P2}, 'Second Parent', ${rmA}::uuid, 'individual', '1979-01-01', 'conservative', now(), true)`));
    h.session = sess(rmA, ["rm"]);
    const kid = (await post(minorBody(PA))).body.id;
    expect((await row(kid)).g).toBe(gA);
    expect((await row(kid)).risk_profile).toBe("moderate"); // 0234's copy on the row
    const moved = await patch(kid, { typeDetails: { guardian: { name: "Second Parent", pan: P2, relation: "mother" } } });
    expect(moved.status).toBe(200);
    expect((await row(kid)).g).toBe(g2);
    // Now re-typed to a PAN this RM may not link: the record must not name one
    // guardian and carry another's profile.
    const gone = await patch(kid, { typeDetails: { guardian: { name: "Someone", pan: PB, relation: "mother" } } });
    expect(gone.status).toBe(200);
    expect(gone.body.guardianNotice).toBe(G.GUARDIAN_PAN_NOT_LINKED);
    const after = await row(kid);
    expect(after.g).toBeNull();
    expect(after.risk_profile).toBeNull();
    expect(after.risk_profile_signed_at).toBeNull();
  });

  /* ── Task 2: removing a link removes the copy ───────────────────────── */
  it("unlink puts back the minor's own latest assessment, else nothing; becoming an adult removes the link and the copy", async () => {
    h.session = sess(rmA, ["rm"]);
    const withOwn = (await post(minorBody(PA))).body.id;
    await ownAssessment(withOwn, "conservative");
    expect((await row(withOwn)).risk_profile).toBe("moderate"); // the trigger keeps the copy on the row
    expect((await patch(withOwn, { guardianInvestorId: null })).status).toBe(200);
    expect(await row(withOwn)).toMatchObject({ g: null, risk_profile: "conservative", risk_profile_score: 11, risk_profile_provisional: false });

    const bare = (await post(minorBody(PA))).body.id;
    expect((await patch(bare, { guardianInvestorId: null })).status).toBe(200);
    expect(await row(bare)).toMatchObject({ g: null, risk_profile: null, risk_profile_signed_at: null });

    const grown = (await post(minorBody(PA))).body.id;
    expect((await patch(grown, { investorCategory: "individual", dob: "2000-01-01" })).status).toBe(200);
    expect(await row(grown)).toMatchObject({ g: null, risk_profile: null });
    const acts = (await withTenant(t, async (tx) => (await tx.execute(sql`SELECT action FROM audit_log WHERE entity_id = ${grown}::uuid AND action LIKE 'investor.guardian_%' ORDER BY at`)).rows)) as any[];
    expect(acts.map((x) => x.action)).toEqual(["investor.guardian_linked", "investor.guardian_unlinked"]);
  });

  it("merge into a survivor that cannot be a guardian removes the copy with the link; un-merge brings both back", async () => {
    const { mergeInvestors } = await import("@/lib/investors/merge");
    const hOld = randomUUID(), hNew = randomUUID(), P3 = pan("H");
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_signed_at, dedup_pan)
      VALUES (${hOld}::uuid, ${t}::uuid, ${P3}, 'Was Individual', ${rmA}::uuid, 'individual', NULL, 'aggressive', now(), false),
             (${hNew}::uuid, ${t}::uuid, ${P3}, 'An HUF', ${rmA}::uuid, 'huf', NULL, NULL, NULL, true)`));
    const kid = await legacyMinor(rmA, hOld);
    expect((await row(kid)).risk_profile).toBe("aggressive");
    await withTenant(t, (tx) => mergeInvestors(tx, { tenantId: t, survivorId: hNew, loserId: hOld, byUserId: owner, source: "manual" as any, reason: "test" }));
    expect(await row(kid)).toMatchObject({ g: null, risk_profile: null, risk_profile_signed_at: null });
    const mergeId = (await one(sql`SELECT id::text AS id FROM investor_merges WHERE loser_id = ${hOld}::uuid`)).id;
    h.session = sess(owner, ["owner"]);
    const un = await (await import("@/app/api/investors/unmerge/route")).POST(req("POST", "/api/investors/unmerge", { mergeId }));
    expect(un.status).toBe(200);
    expect(await row(kid)).toMatchObject({ g: hOld, risk_profile: "aggressive" });
  });

  it("erasing a guardian (purge) removes the copy from their minors", async () => {
    const { purgeInvestorsChunk } = await import("@/lib/investors/purge");
    const gp = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_signed_at, deleted_at)
      VALUES (${gp}::uuid, ${t}::uuid, ${pan()}, 'Erased Parent', ${rmA}::uuid, 'individual', '1970-01-01', 'aggressive', now(), now())`));
    const kid = await legacyMinor(rmA, gp);
    expect((await row(kid)).risk_profile).toBe("aggressive");
    await withTenant(t, (tx) => purgeInvestorsChunk(tx, t, [gp]));
    expect(await row(kid)).toMatchObject({ g: null, risk_profile: null });
  });

  /* ── Task 1: every read path ─────────────────────────────────────────── */
  it("history (GET /api/audit): another book's client is not found; a minor's history carries no copied risk; the guardian's own RM reads the guardian", async () => {
    const audit = async (id: string) => json(await (await import("@/app/api/audit/route")).GET(req("GET", `/api/audit?entityType=investor&entityId=${id}`)));
    const kid = await legacyMinor(rmA, gB, "History Kid");
    // An edit records the whole row (with 0234's copy) in before / after.
    h.session = sess(rmA, ["rm"]);
    expect((await patch(kid, { notes: "touch" })).status).toBe(200);
    const raw = await one(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${kid}::uuid AND after::text LIKE ${"%" + SECRET + "%"}`);
    expect(raw.n).toBeGreaterThan(0); // the secret IS in the stored history
    const mine = await audit(kid);
    expect(mine.status).toBe(200);
    expect(mine.body.entries.length).toBeGreaterThan(0);
    expect(mine.text).not.toContain(SECRET);
    // The guardian's own record: not RM A's to read, by any id they learned.
    const theirs = await audit(gB);
    expect(theirs.status).toBe(404);
    expect(theirs.text).not.toContain("Parent Other Book");
    h.session = sess(rmB, ["rm"]);
    expect((await audit(gB)).status).toBe(200);
  });

  it("client list API, the Excel export and the clients export module: a minor's risk is its own, for every viewer (the owner too)", async () => {
    const kid = await legacyMinor(rmA, gB, "Listed Kid");
    for (const s of [sess(rmA, ["rm"]), sess(owner, ["owner"])]) {
      h.session = s;
      const list = await json(await (await import("@/app/api/investors/route")).GET(req("GET", "/api/investors?limit=200")));
      expect(list.status).toBe(200);
      const k = list.body.rows.find((x: any) => x.id === kid);
      expect(k).toBeTruthy();
      expect(k.riskProfile).toBeNull();
      expect(k.riskProfileSignedAt).toBeNull();
      if (s.userId === rmA) expect(list.text).not.toContain(SECRET);
    }
    // Once the minor has its own assessment, that is what everyone sees.
    await ownAssessment(kid, "moderate");
    h.session = sess(rmA, ["rm"]);
    const list2 = await json(await (await import("@/app/api/investors/route")).GET(req("GET", "/api/investors?limit=200")));
    expect(list2.body.rows.find((x: any) => x.id === kid).riskProfile).toBe("moderate");

    const XLSX = await import("xlsx");
    const xres = await (await import("@/app/api/investors/export/route")).GET(req("GET", "/api/investors/export"));
    expect(xres.status).toBe(200);
    const wb = XLSX.read(Buffer.from(await xres.arrayBuffer()));
    const sheet = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]]);
    const xk = sheet.find((x) => Object.values(x).includes("Listed Kid"));
    expect(xk).toBeTruthy();
    expect(JSON.stringify(sheet)).not.toContain(SECRET);

    const { runExport } = await import("@/lib/export/run");
    const { clientsExport } = await import("@/lib/export/modules/clients");
    const f = await runExport(sess(owner, ["owner"]) as any, clientsExport as any, ["name", "risk", "risk_signed"], "csv", new URLSearchParams());
    const csv = f.body.toString("utf8");
    const kidLine = csv.split("\n").find((l) => l.includes("Listed Kid")) ?? "";
    expect(kidLine).toContain("Listed Kid");
    expect(kidLine).not.toContain(SECRET); // the guardian's own row may hold it; the minor's never
    expect(kidLine.toLowerCase()).toContain("moderate"); // its own assessment
  });

  it("Risk Profiles tabs and filters: a minor carrying only a guardian's signed copy is 'not profiled' and matches no risk filter", async () => {
    const kid = await legacyMinor(rmA, gB, "Bucket Kid");
    expect((await row(kid)).risk_profile_signed_at).not.toBeNull(); // looks signed on the row
    const { riskBucketCaseSql } = await import("@/lib/risk-profile/buckets");
    const b = await one(sql`SELECT ${riskBucketCaseSql()} AS bucket FROM investors i WHERE i.id = ${kid}::uuid`);
    expect(b.bucket).toBe("not_profiled");
    const { compileToSelect, bindCompiled } = await import("@/lib/filter/compiler");
    const { and, p } = await import("@/lib/filter/ast");
    const c = compileToSelect(and(p("risk_profile", "eq", SECRET)), "investor", { columns: ["inv.id::text AS id"], tenantId: t });
    const hits = await withTenant(t, async (tx) => (await tx.execute(bindCompiled(c.sql, c.params))).rows as Array<{ id: string }>);
    expect(hits.map((x) => x.id)).toContain(gB);   // the guardian matches on their own profile
    expect(hits.map((x) => x.id)).not.toContain(kid); // the minor does not, on the copy
  });

  it("suitability: a stale copy left on an UNLINKED minor (a link removed by a path that did not clean up) satisfies nothing", async () => {
    const kid = await legacyMinor(rmA, gA, "Stale Kid");
    expect((await row(kid)).risk_profile).toBe("moderate");
    // Unlinked by a writer outside the application (no clean-up): the copy stays on the row.
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET guardian_investor_id = NULL WHERE id = ${kid}::uuid`));
    expect(await row(kid)).toMatchObject({ g: null, risk_profile: "moderate" });
    const { suitabilityProfile } = await import("@/lib/risk-profile/own-assessment");
    const { loadClientSummary } = await import("@/lib/investors/summary");
    expect(await withTenant(t, (tx) => suitabilityProfile(tx, t, kid))).toMatchObject({ category: null, inheritedIgnored: true });
    expect(await withTenant(t, (tx) => loadClientSummary(tx, t, kid))).toMatchObject({ risk: "Not completed", riskCategory: null, riskSigned: null });
  });

  it("proposal PDF: a minor's printed risk line is the minor's own assessment, never the guardian's", async () => {
    const kid = await legacyMinor(rmA, gB, "Pdf Kid");
    const { loadProposalPdfPeople } = await import("@/lib/proposal/pdf-context");
    const before = await withTenant(t, (tx) => loadProposalPdfPeople(tx, { tenantId: t, investorId: kid }));
    expect(before.client).toMatchObject({ riskProfile: null, riskProfileSignedAt: null });
    await ownAssessment(kid, "conservative");
    const after = await withTenant(t, (tx) => loadProposalPdfPeople(tx, { tenantId: t, investorId: kid }));
    expect(after.client?.riskProfile).toBe("conservative");
  });

  it("client messages and automations: merge tokens, workflow subjects and outbox events carry the minor's own risk, never the guardian's", async () => {
    const kid = await legacyMinor(rmA, gB, "Message Kid");
    const { loadInvestor } = await import("@/lib/comms/pipeline");
    const { loadSubject } = await import("@/lib/workflow/runner");
    const inv = await withTenant(t, (tx) => loadInvestor(tx, kid, t));
    expect(inv?.riskProfile ?? null).toBeNull();
    expect(inv?.riskProfileSignedAt ?? null).toBeNull();
    const subj = await withTenant(t, (tx) => loadSubject(tx, "investor", kid, t));
    expect(subj?.riskProfile ?? null).toBeNull();
    expect(JSON.stringify(subj)).not.toContain(SECRET);
    await ownAssessment(kid, "conservative");
    expect((await withTenant(t, (tx) => loadInvestor(tx, kid, t)))?.riskProfile).toBe("conservative");
    expect((await withTenant(t, (tx) => loadSubject(tx, "investor", kid, t)))?.riskProfile).toBe("conservative");
    // The guardian's own record still reads its own profile.
    expect((await withTenant(t, (tx) => loadSubject(tx, "investor", gB, t)))?.riskProfile).toBe(SECRET);
  });

  it("AI QRR commentary: a client outside the caller's book is not found — before any model is asked", async () => {
    h.session = sess(rmA, ["rm"]);
    const route = await import("@/app/api/ai/qrr-commentary/route");
    const res = await json(await route.POST(req("POST", "/api/ai/qrr-commentary", { investorId: gB })));
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("MODEL WAS CALLED");
    expect(res.text).not.toContain(SECRET);
  });
});
