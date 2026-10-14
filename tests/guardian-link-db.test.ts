/**
 * G-1 (2026-10-14) — a minor's guardian link, end to end against a real
 * PostgreSQL (RLS on, the restricted app role) through the real route handlers.
 *
 *   - who may be linked: a live, non-merged adult individual the user can open,
 *     found by an unambiguous PAN or picked by id — the same checks either way;
 *   - every refusal answers the same, and no response names a hidden guardian;
 *   - every link change is audited; existing links keep working;
 *   - a merged guardian's minors follow the survivor and un-merge restores them;
 *   - suitability never rests on the guardian's copied profile (migration 0234).
 * Session and licence are mocked; everything else is real.
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

const L = "ABCDEFGHJKLMNQRSTUVWXYZ";
const r = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join("");
/** A syntactically valid PAN with the given holder-type letter (P person, H HUF). */
const pan = (type = "P") => `${r(3)}${type}${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;

describe.skipIf(!TEST_DB)("G-1 guardian link — security regression (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let G: typeof import("@/lib/investors/guardian-link");
  const t = randomUUID(), t2 = randomUUID();
  const owner = randomUUID(), rmA = randomUUID(), rmB = randomUUID(), owner2 = randomUUID();
  const ids = {
    gA: randomUUID(),      // adult individual, RM A's book
    gB: randomUUID(),      // adult individual, RM B's book (outside RM A's)
    twinA: randomUUID(),   // shares a PAN with twinB (RM A)
    twinB: randomUUID(),   // (RM B)
    loser: randomUUID(),   // merged into gA's twin-free survivor below
    huf: randomUUID(),     // an HUF with an H-type PAN, RM A
    minorG: randomUUID(),  // a minor, RM A — never a guardian
    teen: randomUUID(),    // "individual" with a DOB under 18, RM A
    other: randomUUID(),   // another firm's client
  };
  const P = { gA: pan(), gB: pan(), twin: pan(), loser: pan(), huf: pan("H"), teen: pan(), other: pan() };
  const sess = (userId: string, roles: string[], tenantId = t) => ({ userId, tenantId, roles, permissions: [], branchId: null, sid: "s" });
  const one = async (q: any, tenant = t) => withTenant(tenant, async (tx) => (await tx.execute(q)).rows[0] as any);
  const call = async (method: "POST" | "PATCH" | "GET", path: string, body?: any) => {
    const req = new NextRequest(`http://x${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    let res: Response;
    if (path === "/api/investors") res = await (await import("@/app/api/investors/route")).POST(req);
    else if (path === "/api/investors/unmerge") res = await (await import("@/app/api/investors/unmerge/route")).POST(req);
    else {
      const id = path.split("/").pop()!;
      const m = await import("@/app/api/investors/[id]/route");
      res = method === "PATCH" ? await m.PATCH(req, { params: Promise.resolve({ id }) }) : await m.GET(req, { params: Promise.resolve({ id }) });
    }
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : null };
  };
  const minor = (extra: any = {}) => ({
    name: `Minor ${randomUUID().slice(0, 6)}`, investorCategory: "minor", dob: "2015-05-05", segmentTag: "Retail",
    // A minor needs their own PAN or a guardian PAN; an unrelated one by default.
    typeDetails: { guardian: { name: "Typed Guardian", pan: extra.gpan ?? pan(), relation: "father" } }, ...extra,
  });
  const linkOf = async (id: string) => (await one(sql`SELECT guardian_investor_id::text AS g, risk_profile, risk_profile_signed_at FROM investors WHERE id = ${id}::uuid`));
  const audits = async (id: string) => Number((await one(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${id}::uuid AND action LIKE 'investor.guardian_%'`)).n);

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
      // The firm's data wall ON: an RM sees only their own book.
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn, restrict_user_data_scope) VALUES (${t}::uuid, 'G1 firm', 'G1 firm', ${"ARN-G1" + t.slice(0, 5)}, true), (${t2}::uuid, 'Other firm', 'Other firm', ${"ARN-G2" + t2.slice(0, 5)}, true)`);
      for (const [id, role, nm, tn] of [[owner, "owner", "Owner", t], [rmA, "rm", "RM A", t], [rmB, "rm", "RM B", t], [owner2, "owner", "Owner2", t2]] as const) {
        await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${tn}::uuid, ${`${nm.replace(" ", "")}-${id.slice(0, 8)}@example.test`}, ${nm}, ARRAY[${role}]::text[], 'active')`);
      }
    });
    await withTenant(t, async (tx) => {
      const ins = (id: string, p: string | null, name: string, rm: string, o: { cat?: string; dob?: string | null; minor?: boolean; dedup?: boolean; risk?: string } = {}) => tx.execute(sql`
        INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, is_minor, dedup_pan, risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional, status)
        VALUES (${id}::uuid, ${t}::uuid, ${p}, ${name}, ${rm}::uuid, ${o.cat ?? "individual"}, ${o.dob ?? "1980-01-01"}, ${o.minor ?? false}, ${o.dedup ?? true},
                ${o.risk ?? "aggressive"}, 42, now() - interval '10 days', false, 'active')`);
      await ins(ids.gA, P.gA, "Guardian In Book", rmA, { risk: "moderate" });
      await ins(ids.gB, P.gB, "Guardian Other Book", rmB, { risk: "very_aggressive" });
      await ins(ids.twinA, P.twin, "Twin A", rmA, { dedup: false });
      await ins(ids.twinB, P.twin, "Twin B", rmB);
      await ins(ids.loser, P.loser, "Retired Record", rmA);
      await ins(ids.huf, P.huf, "Some HUF", rmA, { cat: "huf", dob: null });
      await ins(ids.minorG, "MINOR:" + pan(), "A Minor", rmA, { cat: "minor", dob: "2014-01-01", minor: true });
      await ins(ids.teen, P.teen, "Teen Individual", rmA, { dob: new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10) });
      await tx.execute(sql`UPDATE investors SET merged_into_id = ${ids.gA}::uuid, status = 'inactive' WHERE id = ${ids.loser}::uuid`);
    });
    await withTenant(t2, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob) VALUES (${ids.other}::uuid, ${t2}::uuid, ${P.other}, 'Other Firm Client', ${owner2}::uuid, 'individual', '1975-01-01')`));
  });

  afterAll(async () => {
    const tryRun = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    for (const tn of [t, t2]) {
      for (const table of ["investor_merges", "client_opportunities", "risk_profile_responses", "events_outbox", "audit_log", "idempotency_keys", "investors", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${tn}'`));
      await tryRun(sql`DELETE FROM tenants WHERE id = ${tn}::uuid`);
    }
  });

  /* ── eligibility (pure) ─────────────────────────────────────────────── */
  it("eligibility: a live adult individual only", () => {
    const base = { investor_category: "individual", is_minor: false, dob: "1980-01-01", pan: "ABCPE1234F", status: "active", deleted_at: null, merged_into_id: null };
    expect(G.isEligibleGuardian(base)).toBe(true);
    expect(G.isEligibleGuardian({ ...base, investor_category: "nri" })).toBe(true);
    expect(G.isEligibleGuardian({ ...base, investor_category: "sole_proprietor" })).toBe(true);
    expect(G.isEligibleGuardian({ ...base, dob: null })).toBe(true);
    for (const bad of [
      { investor_category: "minor" }, { investor_category: "huf" }, { investor_category: "company" }, { investor_category: "trust" },
      { is_minor: true }, { pan: "ABCHE1234F" }, { pan: "ABCCE1234F" }, { merged_into_id: randomUUID() },
      { deleted_at: new Date().toISOString() }, { status: "closed" }, { dob: new Date(Date.now() - 17 * 365 * 864e5).toISOString() },
    ]) expect(G.isEligibleGuardian({ ...base, ...bad } as any)).toBe(false);
  });

  /* ── Create (POST) ──────────────────────────────────────────────────── */
  it("create: a unique PAN in the RM's book links, is audited, and the minor takes the guardian's risk", async () => {
    h.session = sess(rmA, ["rm"]);
    const res = await call("POST", "/api/investors", minor({ gpan: P.gA }));
    expect(res.status).toBe(201);
    expect(res.body.guardianLinked).toBe(true);
    const m = await linkOf(res.body.id);
    expect(m.g).toBe(ids.gA);
    expect(m.risk_profile).toBe("moderate");
    expect(await audits(res.body.id)).toBe(1);
  });

  it("create: a picked guardian in the RM's book links", async () => {
    h.session = sess(rmA, ["rm"]);
    const res = await call("POST", "/api/investors", minor({ guardianInvestorId: ids.gA }));
    expect(res.status).toBe(201);
    expect((await linkOf(res.body.id)).g).toBe(ids.gA);
  });

  it("create: a PAN outside the RM's book does not link, and the answer reveals nothing", async () => {
    h.session = sess(rmA, ["rm"]);
    const res = await call("POST", "/api/investors", minor({ gpan: P.gB }));
    expect(res.status).toBe(201);
    // Not linked — and said so (G-1 Task 4), in words that never say why.
    expect(res.body).toEqual({ id: res.body.id, guardianLinked: false, guardianNotice: G.GUARDIAN_PAN_NOT_LINKED });
    expect((await linkOf(res.body.id)).g).toBeNull();
    expect(res.text).not.toContain("Guardian Other Book");
    expect(res.text).not.toContain("very_aggressive");
  });

  it("create: refused picks (other book, HUF, minor, under 18, merged, unknown id, other firm) all answer the same 400 and write nothing", async () => {
    h.session = sess(rmA, ["rm"]);
    const before = Number((await one(sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${t}::uuid`)).n);
    const answers = new Set<string>();
    for (const gid of [ids.gB, ids.huf, ids.minorG, ids.teen, ids.loser, randomUUID(), ids.other]) {
      const res = await call("POST", "/api/investors", minor({ guardianInvestorId: gid }));
      expect(res.status).toBe(400);
      answers.add(res.text);
      for (const leak of ["Guardian Other Book", "Some HUF", "A Minor", "Teen Individual", "Retired Record", "Other Firm Client", "very_aggressive"]) expect(res.text).not.toContain(leak);
    }
    expect(answers.size).toBe(1); // one indistinguishable answer
    expect(Number((await one(sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${t}::uuid`)).n)).toBe(before);
  });

  it("create: two live records sharing a PAN never link — not even for the owner, not even when one is the RM's", async () => {
    for (const s of [sess(owner, ["owner"]), sess(rmA, ["rm"])]) {
      h.session = s;
      const res = await call("POST", "/api/investors", minor({ gpan: P.twin }));
      expect(res.status).toBe(201);
      expect(res.body.guardianLinked).toBe(false);
      expect((await linkOf(res.body.id)).g).toBeNull();
    }
  });

  it("create: an HUF PAN, a teenager's PAN, another firm's PAN and a merged record's PAN never link", async () => {
    h.session = sess(owner, ["owner"]);
    for (const p of [P.huf, P.teen, P.other, P.loser]) {
      const res = await call("POST", "/api/investors", minor({ gpan: p }));
      expect(res.status).toBe(201);
      expect((await linkOf(res.body.id)).g).toBeNull();
    }
  });

  it("create: the owner (whole book) links a guardian in any RM's book", async () => {
    h.session = sess(owner, ["owner"]);
    const res = await call("POST", "/api/investors", minor({ gpan: P.gB }));
    expect((await linkOf(res.body.id)).g).toBe(ids.gB);
  });

  /* ── Edit (PATCH) ───────────────────────────────────────────────────── */
  const ownMinor = async (rm = rmA, guardian: string | null = null) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, is_minor, dob, guardian_investor_id)
      VALUES (${id}::uuid, ${t}::uuid, ${"MINOR:" + pan()}, 'Edited Minor', ${rm}::uuid, 'minor', true, '2014-01-01', ${guardian}::uuid)`));
    return id;
  };

  it("edit: typed PAN outside the book does not link; refused pick answers the same 400 as create", async () => {
    h.session = sess(rmA, ["rm"]);
    const id = await ownMinor();
    expect((await call("PATCH", `/api/investors/${id}`, { typeDetails: { guardian: { name: "x", pan: P.gB, relation: "mother" } } })).status).toBe(200);
    expect((await linkOf(id)).g).toBeNull();
    const createAnswer = (await call("POST", "/api/investors", minor({ guardianInvestorId: ids.gB }))).body.error;
    for (const gid of [ids.gB, ids.huf, ids.minorG, ids.loser, ids.other, id /* itself */]) {
      const res = await call("PATCH", `/api/investors/${id}`, { guardianInvestorId: gid });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(createAnswer);
    }
    expect((await linkOf(id)).g).toBeNull();
    // No link was made; the typed PAN that linked nobody is recorded once, with no reason.
    const acts = (await withTenant(t, async (tx) => (await tx.execute(sql`SELECT action, after FROM audit_log WHERE entity_id = ${id}::uuid AND action LIKE 'investor.guardian_%'`)).rows)) as any[];
    expect(acts.map((x) => x.action)).toEqual(["investor.guardian_not_linked"]);
    expect(acts[0].after).toEqual({ via: "pan" });
  });

  it("edit: links in the book by PAN or pick, unlinks with null — each change audited", async () => {
    h.session = sess(rmA, ["rm"]);
    const id = await ownMinor();
    expect((await call("PATCH", `/api/investors/${id}`, { typeDetails: { guardian: { name: "x", pan: P.gA, relation: "mother" } } })).status).toBe(200);
    expect((await linkOf(id)).g).toBe(ids.gA);
    expect((await call("PATCH", `/api/investors/${id}`, { guardianInvestorId: null })).status).toBe(200);
    expect((await linkOf(id)).g).toBeNull();
    expect((await call("PATCH", `/api/investors/${id}`, { guardianInvestorId: ids.gA })).status).toBe(200);
    expect((await linkOf(id)).g).toBe(ids.gA);
    const rows = (await withTenant(t, async (tx) => (await tx.execute(sql`SELECT action, before, after FROM audit_log WHERE entity_id = ${id}::uuid AND action LIKE 'investor.guardian_%' ORDER BY at`)).rows)) as any[];
    expect(rows.map((x) => x.action)).toEqual(["investor.guardian_linked", "investor.guardian_unlinked", "investor.guardian_linked"]);
    expect(JSON.stringify(rows)).not.toMatch(/[A-Z]{5}[0-9]{4}[A-Z]/); // ids only, never a PAN
  });

  /* ── An existing link to a guardian the viewer cannot open ──────────── */
  it("existing cross-book link: GET / PATCH never show the guardian's name or risk — to anyone the minor's risk is its own assessment; saving other fields keeps the link", async () => {
    const id = await ownMinor(rmA, ids.gB); // legacy data: linked before the fix
    expect((await linkOf(id)).risk_profile).toBe("very_aggressive"); // 0234 copied it
    h.session = sess(rmA, ["rm"]);
    const got = await call("GET", `/api/investors/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.investor.riskProfile).toBeNull();
    expect(got.body.investor.riskProfileSignedAt).toBeNull();
    expect(got.text).not.toContain("very_aggressive");
    expect(got.text).not.toContain("Guardian Other Book");
    const saved = await call("PATCH", `/api/investors/${id}`, { notes: "updated", guardianInvestorId: ids.gB });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain("very_aggressive");
    expect((await linkOf(id)).g).toBe(ids.gB); // re-sent link unchanged, not re-checked
    const view = await withTenant(t, (tx) => G.guardianForViewer(tx, sess(rmA, ["rm"]) as any, ids.gB));
    expect(view).toEqual({ id: ids.gB, name: null, riskProfile: null, hidden: true });
    // RM B (the guardian's RM) and the owner see it.
    const vb = await withTenant(t, (tx) => G.guardianForViewer(tx, sess(rmB, ["rm"]) as any, ids.gB));
    expect(vb?.name).toBe("Guardian Other Book");
    // The owner may open the guardian — and still the MINOR's risk is the
    // minor's own assessment (none yet), never the guardian's copy; the
    // guardian's own profile is shown only through the link.
    h.session = sess(owner, ["owner"]);
    expect((await call("GET", `/api/investors/${id}`)).body.investor.riskProfile).toBeNull();
    expect((await withTenant(t, (tx) => G.guardianForViewer(tx, sess(owner, ["owner"]) as any, ids.gB)))?.riskProfile).toBe("very_aggressive");
  });

  it("risk-profiles export: a hidden guardian is never named and the minor's copied risk is blank; the guardian's RM sees both", async () => {
    const id = await ownMinor(rmA, ids.gB);
    const { runExport } = await import("@/lib/export/run");
    const { riskProfilesExport } = await import("@/lib/export/modules/relationships");
    const csvFor = async (s: any) => {
      try {
        const f = await runExport(s, riskProfilesExport, ["name", "guardian", "guardian_risk", "category", "signed"], "csv", new URLSearchParams("filter=current,not_profiled,due,expired,awaiting"));
        return f.body.toString("utf8");
      } catch (e: any) { return `REFUSED:${e?.status ?? e?.message}`; }
    };
    const a = await csvFor({ ...sess(rmA, ["rm"]), permissions: ["data.export", "investor.view.assigned"] });
    expect(a).toContain("Edited Minor"); // the export ran and holds the minor
    expect(a).not.toContain("Guardian Other Book");
    const row = a.split("\n").find((l) => l.includes("Edited Minor") && true) ?? "";
    expect(row).not.toMatch(/Very Aggressive/i);
    const o = await csvFor(sess(owner, ["owner"]));
    expect(o).toContain("Guardian Other Book");
    // For the owner the guardian's own category appears in its own, labelled
    // column; the minor's risk category column stays the minor's (empty).
    const orows = o.split("\n").filter((l) => l.includes("Edited Minor") && l.includes("Guardian Other Book"));
    expect(orows.length).toBeGreaterThan(0);
    for (const l of orows) expect(l.split(",").filter((c) => /Very Aggressive/i.test(c)).length).toBe(1);
    void id;
  });

  /* ── Cross-firm ─────────────────────────────────────────────────────── */
  it("cross-firm: another firm's owner can neither link nor read this firm's guardian", async () => {
    h.session = sess(owner2, ["owner"], t2);
    const res = await call("POST", "/api/investors", minor({ guardianInvestorId: ids.gA }));
    expect(res.status).toBe(400);
    const res2 = await call("POST", "/api/investors", minor({ gpan: P.gA }));
    expect(res2.body.guardianLinked).toBe(false);
    expect(await withTenant(t2, (tx) => G.guardianForViewer(tx, sess(owner2, ["owner"], t2) as any, ids.gA))).toEqual({ id: ids.gA, name: null, riskProfile: null, hidden: true });
  });

  /* ── Existing legitimate links keep working ─────────────────────────── */
  it("an in-book link keeps the 0234 behaviour: the guardian's later change reaches the minor; edits don't disturb it", async () => {
    h.session = sess(rmA, ["rm"]);
    const id = (await call("POST", "/api/investors", minor({ guardianInvestorId: ids.gA }))).body.id;
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET risk_profile = 'conservative' WHERE id = ${ids.gA}::uuid`));
    expect((await linkOf(id)).risk_profile).toBe("conservative");
    expect((await call("PATCH", `/api/investors/${id}`, { notes: "x" })).status).toBe(200);
    expect((await linkOf(id)).g).toBe(ids.gA);
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET risk_profile = 'moderate' WHERE id = ${ids.gA}::uuid`));
  });

  /* ── Suitability never rests on the guardian's copy ─────────────────── */
  it("suitability: a linked minor's copied (signed, confirmed-looking) profile satisfies no gate; the minor's own assessment does", async () => {
    h.session = sess(rmA, ["rm"]);
    const id = (await call("POST", "/api/investors", minor({ guardianInvestorId: ids.gA }))).body.id;
    const m = await linkOf(id);
    expect(m.risk_profile).toBe("moderate");
    expect(m.risk_profile_signed_at).not.toBeNull(); // looks confirmed on the row
    const { suitabilityProfile } = await import("@/lib/risk-profile/own-assessment");
    const { loadFacts, gateFor } = await import("@/lib/opportunities/journey");
    const { loadProposalSnapshot } = await import("@/lib/proposals/snapshot");
    const { loadClientLinkTokens, wantsClientLinkTokens } = await import("@/lib/comms/client-links");
    const opp = { id: randomUUID(), tenantId: t, investorId: id, createdAt: new Date(), product: "mutual_funds", pipeline: "mf" } as any;
    const run = <T,>(f: (tx: any) => Promise<T>) => withTenant(t, f);
    expect((await run((tx) => suitabilityProfile(tx, t, id)))).toMatchObject({ category: null, inheritedIgnored: true });
    expect((await run((tx) => loadFacts(tx, opp))).riskState).toBe("not_profiled");
    expect(gateFor("proposal", opp, await run((tx) => loadFacts(tx, opp))).every((g) => g.satisfied)).toBe(false);
    expect((await run((tx) => loadProposalSnapshot(tx, t, { investorId: id, familyId: null, leadId: null })))!.risk).toMatchObject({ category: null, status: "Not completed" });
    const tok = await run((tx) => loadClientLinkTokens(tx, { tenantId: t, subjectType: "investor", subjectId: id, want: wantsClientLinkTokens("{{risk.category}} {{suitability.status}}") }));
    expect(tok["risk.category"]).toBeUndefined();
    // An assessment recorded for the MINOR'S account counts.
    await run((tx) => tx.execute(sql`INSERT INTO risk_profile_responses (tenant_id, investor_id, final_category, total_score, signed_at, provisional)
      VALUES (${t}::uuid, ${id}::uuid, 'conservative', 12, now() - interval '1 day', false)`));
    expect((await run((tx) => loadFacts(tx, opp))).riskState).toBe("current");
    expect(gateFor("proposal", opp, await run((tx) => loadFacts(tx, opp))).every((g) => g.satisfied)).toBe(true);
    expect((await run((tx) => loadProposalSnapshot(tx, t, { investorId: id, familyId: null, leadId: null })))!.risk).toMatchObject({ category: "conservative", status: "Completed" });
    // Everyone else is read exactly as before (the investor row).
    expect((await run((tx) => suitabilityProfile(tx, t, ids.gA)))).toMatchObject({ category: "moderate", inheritedIgnored: false });
    const adultOpp = { ...opp, investorId: ids.gA };
    expect((await run((tx) => loadFacts(tx, adultOpp))).riskState).toBe("current");
  });

  /* ── Merge and un-merge ─────────────────────────────────────────────── */
  it("merge: a guardian merged into a survivor — minors follow the survivor (audited); un-merge restores; an ineligible survivor unlinks instead", async () => {
    const { mergeInvestors } = await import("@/lib/investors/merge");
    const P2 = pan();
    const gOld = randomUUID(), gNew = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_signed_at, dedup_pan)
      VALUES (${gOld}::uuid, ${t}::uuid, ${P2}, 'Parent Old Record', ${rmA}::uuid, 'individual', '1980-01-01', 'aggressive', now(), false),
             (${gNew}::uuid, ${t}::uuid, ${P2}, 'Parent', ${rmA}::uuid, 'individual', '1980-01-01', 'conservative', now(), true)`));
    const kid = await ownMinor(rmA, gOld);
    expect((await linkOf(kid)).risk_profile).toBe("aggressive");
    const res = await withTenant(t, (tx) => mergeInvestors(tx, { tenantId: t, survivorId: gNew, loserId: gOld, byUserId: owner, source: "manual" as any, reason: "test" }));
    expect((res as any).ok).toBe(true);
    const after = await linkOf(kid);
    expect(after.g).toBe(gNew);
    expect(after.risk_profile).toBe("conservative");
    expect(await audits(kid)).toBe(1);
    const mergeId = (await one(sql`SELECT id::text AS id FROM investor_merges WHERE loser_id = ${gOld}::uuid`)).id;
    h.session = sess(owner, ["owner"]);
    const un = await call("POST", "/api/investors/unmerge", { mergeId });
    expect(un.status).toBe(200);
    expect((await linkOf(kid)).g).toBe(gOld);
    expect(await audits(kid)).toBe(2);

    // A survivor that cannot be a guardian (an HUF): the minor is unlinked, never pointed at it.
    const hufOld = randomUUID(), hufNew = randomUUID(), P3 = pan("H");
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, dedup_pan)
      VALUES (${hufOld}::uuid, ${t}::uuid, ${P3}, 'HUF Old', ${rmA}::uuid, 'individual', NULL, false),
             (${hufNew}::uuid, ${t}::uuid, ${P3}, 'HUF', ${rmA}::uuid, 'huf', NULL, true)`));
    const kid2 = await ownMinor(rmA, hufOld);
    await withTenant(t, (tx) => mergeInvestors(tx, { tenantId: t, survivorId: hufNew, loserId: hufOld, byUserId: owner, source: "manual" as any, reason: "test" }));
    expect((await linkOf(kid2)).g).toBeNull();
    const mergeId2 = (await one(sql`SELECT id::text AS id FROM investor_merges WHERE loser_id = ${hufOld}::uuid`)).id;
    expect((await call("POST", "/api/investors/unmerge", { mergeId: mergeId2 })).status).toBe(200);
    expect((await linkOf(kid2)).g).toBe(hufOld);
  });
});
