/**
 * G-1 final corrections (2026-10-15, owner decisions 1–4). Real PostgreSQL,
 * restricted role, RLS on, real route handlers; session and licence mocked.
 *
 *  1/2. No guardian "confirmation": a guardian is verified only by linking a
 *       CRM client; any minor saved without a link is pending; the date-of-birth
 *       rule closes the "switch the type away and back" route.
 *  3.   MF proposals: every minor an individual or FAMILY proposal covers needs a
 *       verified guardian and the minor's own assessment — at send AND when the
 *       status is changed in the CRM.
 *  4.   Hard delete, un-merge, outbox events, the registrar import and bulk
 *       age-based assignment no longer expose or bypass anything; the export
 *       keeps its column order; a dedup refusal names nobody.
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
const pan = (type = "P") => `${r(3)}${type}${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;

describe("export column order (pure)", () => {
  it("the Risk Profiles export keeps every existing column in place and adds the guardian's category LAST", async () => {
    const { riskProfilesExport } = await import("@/lib/export/modules/relationships");
    const keys = riskProfilesExport.columns.map((c: any) => c.key);
    expect(keys[keys.length - 1]).toBe("guardian_risk");
    expect(keys.indexOf("guardian")).toBeLessThan(keys.indexOf("rm"));
    expect(keys.indexOf("guardian") + 1).toBe(keys.indexOf("rm"));
    expect(keys.filter((k: string) => k === "guardian_risk").length).toBe(1);
  });
});

describe.skipIf(!TEST_DB)("G-1 final corrections (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let V: typeof import("@/lib/investors/guardian-verification");
  const t = randomUUID();
  const owner = randomUUID(), rmA = randomUUID(), rmB = randomUUID();
  const sess = (userId: string, roles: string[]) => ({ userId, tenantId: t, roles, permissions: [], branchId: null, sid: "s" });
  const one = async (q: any) => withTenant(t, async (tx) => (await tx.execute(q)).rows[0] as any);
  const req = (method: string, url: string, body?: any) =>
    new NextRequest(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const json = async (res: Response) => { const text = await res.text(); return { status: res.status, text, body: text ? JSON.parse(text) : null }; };
  const post = async (body: any) => json(await (await import("@/app/api/investors/route")).POST(req("POST", "/api/investors", body)));
  const status = (id: string) => withTenant(t, (tx) => V.guardianVerification(tx, t, id));
  const send = async (id: string) => json(await (await import("@/app/api/proposals/[id]/send/route")).POST(req("POST", `/api/proposals/${id}/send`, { channel: "link", preview: true }), { params: Promise.resolve({ id }) }));
  const patchProposal = async (id: string, body: any) => json(await (await import("@/app/api/proposals/[id]/route")).PATCH(req("PATCH", `/api/proposals/${id}`, body), { params: Promise.resolve({ id }) }));
  const adult = async (rm: string, name: string, risk = true, p = pan()) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional, status, dedup_pan)
      VALUES (${id}::uuid, ${t}::uuid, ${p}, ${name}, ${rm}::uuid, 'individual', '1980-01-01', ${risk ? "moderate" : null}, ${risk ? 50 : null}, ${risk ? sql`now() - interval '10 days'` : null}, false, 'active', true)`));
    return id;
  };
  const minorRow = async (rm: string, opts: { guardian?: string | null; event?: "not_linked" | null; family?: string | null; dob?: string; name?: string } = {}) => {
    const id = randomUUID();
    await withTenant(t, async (tx) => {
      await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, is_minor, dob, guardian_investor_id, family_id, status)
        VALUES (${id}::uuid, ${t}::uuid, ${"MINOR:" + pan()}, ${opts.name ?? "Corr Kid"}, ${rm}::uuid, 'minor', true, ${opts.dob ?? "2015-01-01"}, ${opts.guardian ?? null}::uuid, ${opts.family ?? null}::uuid, 'active')`);
      if (opts.event === "not_linked") await tx.execute(sql`INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type, entity_id, after) VALUES (gen_random_uuid(), ${t}::uuid, 'user', 'investor.guardian_not_linked', 'investor', ${id}::uuid, '{"via":"pan"}')`);
    });
    return id;
  };
  const ownAssessment = (id: string) => withTenant(t, (tx) => tx.execute(sql`
    INSERT INTO risk_profile_responses (tenant_id, investor_id, final_category, total_score, signed_at, provisional)
    VALUES (${t}::uuid, ${id}::uuid, 'moderate', 11, now() - interval '1 day', false)`));
  const proposal = async (by: string, w: { investorId?: string; familyId?: string }) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO proposals (id, tenant_id, proposal_number, recipient_type, recipient_name, title, investor_id, family_id, prepared_by_user_id, products, suitability_note, status)
      VALUES (${id}::uuid, ${t}::uuid, ${"P-" + id.slice(0, 8)}, ${w.familyId ? "family" : "investor"}, 'R', 'MF plan', ${w.investorId ?? null}::uuid, ${w.familyId ?? null}::uuid, ${by}::uuid,
              ${JSON.stringify([{ kind: "mf", schemeName: "Liquid Fund", riskRating: "low" }])}::jsonb, 'Low risk, short horizon.', 'draft')`));
    return id;
  };
  const family = async (head: string) => {
    const id = randomUUID();
    await withTenant(t, async (tx) => {
      await tx.execute(sql`INSERT INTO families (id, tenant_id, head_name, family_name, primary_investor_id) VALUES (${id}::uuid, ${t}::uuid, 'Head', 'Head Family', ${head}::uuid)`);
      await tx.execute(sql`UPDATE investors SET family_id = ${id}::uuid WHERE id = ${head}::uuid`);
    });
    return id;
  };
  const auditCount = async (id: string, action: string) => (await one(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${id}::uuid AND action = ${action}`)).n;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    V = await import("@/lib/investors/guardian-verification");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn, restrict_user_data_scope) VALUES (${t}::uuid, 'G1c firm', 'G1c firm', ${"ARN-GC" + t.slice(0, 5)}, true)`);
      for (const [id, role, nm] of [[owner, "owner", "Owner"], [rmA, "rm", "RMA"], [rmB, "rm", "RMB"]] as const)
        await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${t}::uuid, ${`${nm}-${id.slice(0, 8)}@example.test`}, ${nm}, ARRAY[${role}]::text[], 'active')`);
    });
  });
  afterAll(async () => {
    const run = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    await run(sql`UPDATE investors SET family_id = NULL, guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
    for (const table of ["proposals", "families", "risk_profile_responses", "folios", "events_outbox", "audit_log", "investor_merges", "investors", "users"]) await run(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await run(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  /* ── 1 / 2 ─────────────────────────────────────────────────────────── */
  it("there is no way to mark a guardian verified by note: the route has no POST and no confirmed state exists", async () => {
    const m = await import("@/app/api/investors/[id]/guardian-verification/route");
    expect((m as any).POST).toBeUndefined();
    expect(typeof (m as any).GET).toBe("function");
    expect(V.GUARDIAN_EVENTS as readonly string[]).not.toContain("investor.guardian_verified");
    // A stray audit row with that action means nothing.
    const kid = await minorRow(rmA, { event: "not_linked" });
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type, entity_id, after) VALUES (gen_random_uuid(), ${t}::uuid, 'user', 'investor.guardian_verified', 'investor', ${kid}::uuid, '{}')`));
    expect(await status(kid)).toBe("pending");
  });

  it("a minor created with NO guardian PAN is pending too (audited, warned) and cannot get an MF proposal", async () => {
    h.session = sess(rmA, ["rm"]);
    const res = await post({ name: `NoGuardian ${r(4)}`, investorCategory: "minor", dob: "2016-03-03", pan: pan(), segmentTag: "Retail" });
    expect(res.status).toBe(201);
    expect(res.body.guardianLinked).toBe(false);
    expect(res.body.guardianNotice).toMatch(/NOT VERIFIED/);
    expect(await status(res.body.id)).toBe("pending");
    const a = await one(sql`SELECT after FROM audit_log WHERE entity_id = ${res.body.id}::uuid AND action = 'investor.guardian_not_linked'`);
    expect(a.after).toEqual({ via: "none" });
    await ownAssessment(res.body.id);
    const prop = await proposal(rmA, { investorId: res.body.id });
    const s = await send(prop);
    expect(s.status).toBe(412); expect(s.body.field).toBe("guardian");
  });

  it("switching the type away from Minor does not clear it: a client under 18 by date of birth keeps the pending status", async () => {
    const id = await minorRow(rmA, { event: "not_linked" });
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET investor_category = 'individual', is_minor = false, dob = (current_date - interval '10 years')::date WHERE id = ${id}::uuid`));
    expect(await status(id)).toBe("pending");
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET dob = '1980-01-01' WHERE id = ${id}::uuid`));
    expect(await status(id)).toBe("not_applicable");
  });

  /* ── 3 ─────────────────────────────────────────────────────────────── */
  it("family proposal: a minor member with an unverified guardian blocks the MF proposal; so does a missing own assessment; a verified, assessed minor passes the gate", async () => {
    h.session = sess(owner, ["owner"]);
    const head = await adult(rmA, "Family Head");
    const fam = await family(head);
    const kid = await minorRow(rmA, { family: fam, event: "not_linked" });
    const prop = await proposal(rmA, { familyId: fam });
    const s1 = await send(prop);
    expect(s1.status).toBe(412); expect(s1.body.field).toBe("guardian");
    // Linked guardian, but no assessment of the minor's own account.
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET guardian_investor_id = ${head}::uuid WHERE id = ${kid}::uuid`));
    const s2 = await send(prop);
    expect(s2.status).toBe(412); expect(s2.body.field).toBe("riskProfile");
    expect(s2.body.error).toMatch(/minor/i);
    // Verified + assessed: the minor gate is satisfied (the rest of the send flow is unchanged).
    await ownAssessment(kid);
    const { minorProposalGate } = await import("@/lib/proposals/minor-gate");
    const gate = await withTenant(t, (tx) => minorProposalGate(tx, t, { familyId: fam, products: [{ kind: "mf", schemeName: "Liquid Fund", riskRating: "low" }] }));
    expect(gate).toBeNull();
    const s3 = await send(prop);
    expect(["guardian", "riskProfile"]).not.toContain(s3.body?.field);
    // No MF lines: the gate does not apply.
    const none = await withTenant(t, (tx) => minorProposalGate(tx, t, { familyId: fam, products: [{ kind: "insurance" }] }));
    expect(none).toBeNull();
  });

  it("marking a proposal sent / accepted in the CRM clears the same minor rules (the status change was a way round the send gate)", async () => {
    h.session = sess(rmA, ["rm"]);
    const kid = await minorRow(rmA, { event: "not_linked" });
    const prop = await proposal(rmA, { investorId: kid });
    for (const st of ["sent", "accepted"]) {
      const res = await patchProposal(prop, { status: st });
      expect(res.status, st).toBe(412);
      expect((await one(sql`SELECT status, sent_at FROM proposals WHERE id = ${prop}::uuid`))).toMatchObject({ status: "draft", sent_at: null });
    }
    // An adult's proposal is unaffected.
    const adultId = await adult(rmA, "Adult Client");
    const p2 = await proposal(rmA, { investorId: adultId });
    expect((await patchProposal(p2, { status: "sent" })).status).toBe(200);
  });

  /* ── 4 ─────────────────────────────────────────────────────────────── */
  it("hard delete of a guardian: the minor is unlinked, the guardian's copied risk goes, the removal is audited, the minor is pending", async () => {
    const g = await adult(rmA, "Erased Parent");
    const kid = await minorRow(rmA, { guardian: g });
    expect((await one(sql`SELECT risk_profile FROM investors WHERE id = ${kid}::uuid`)).risk_profile).toBe("moderate"); // 0234's copy
    h.session = sess(owner, ["owner"]);
    const res = await json(await (await import("@/app/api/investors/[id]/route")).DELETE(req("DELETE", `/api/investors/${g}?purge=1`), { params: Promise.resolve({ id: g }) }));
    expect(res.status).toBe(200);
    const row = await one(sql`SELECT guardian_investor_id, risk_profile, risk_profile_signed_at FROM investors WHERE id = ${kid}::uuid`);
    expect(row).toMatchObject({ guardian_investor_id: null, risk_profile: null, risk_profile_signed_at: null });
    expect(await auditCount(kid, "investor.guardian_unlinked")).toBe(1);
    expect(await status(kid)).toBe("pending");
  });

  it("un-merge: a minor who is no longer a minor is not relinked to the restored guardian", async () => {
    const { mergeInvestors } = await import("@/lib/investors/merge");
    const P = pan();
    const gOld = randomUUID(), gNew = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, status, dedup_pan)
      VALUES (${gOld}::uuid, ${t}::uuid, ${P}, 'Old Parent', ${rmA}::uuid, 'individual', '1980-01-01', 'active', false),
             (${gNew}::uuid, ${t}::uuid, ${P}, 'New Parent', ${rmA}::uuid, 'individual', '1980-01-01', 'active', true)`));
    const kid = await minorRow(rmA, { guardian: gOld });
    await withTenant(t, (tx) => mergeInvestors(tx, { tenantId: t, survivorId: gNew, loserId: gOld, byUserId: owner, source: "manual" as any, reason: "test" }));
    expect((await one(sql`SELECT guardian_investor_id::text AS g FROM investors WHERE id = ${kid}::uuid`)).g).toBe(gNew);
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET investor_category = 'individual', is_minor = false WHERE id = ${kid}::uuid`));
    const mergeId = (await one(sql`SELECT id::text AS id FROM investor_merges WHERE loser_id = ${gOld}::uuid`)).id;
    h.session = sess(owner, ["owner"]);
    const un = await json(await (await import("@/app/api/investors/unmerge/route")).POST(req("POST", "/api/investors/unmerge", { mergeId })));
    expect(un.status).toBe(200);
    expect((await one(sql`SELECT guardian_investor_id::text AS g FROM investors WHERE id = ${kid}::uuid`)).g).toBe(gNew); // not moved back
  });

  it("outbox: an event for a purged minor loses the guardian's copied risk; an adult's event is untouched", async () => {
    const poller = await import("@/workers/outbox-poller");
    const fn = (poller as any).withOwnRiskForMinorEvent as (t: string, e: any) => Promise<any>;
    expect(typeof fn).toBe("function");
    const gone = randomUUID();
    const ev = (after: any) => ({ tenant_id: t, entity_type: "investor", entity_id: gone, before: null, after });
    const minor = await fn(t, ev({ investorCategory: "minor", riskProfile: "very_aggressive", risk_profile_score: 77, name: "Kid" }));
    expect(minor.after).toEqual({ investorCategory: "minor", name: "Kid" });
    const adultEv = await fn(t, ev({ investorCategory: "individual", riskProfile: "moderate" }));
    expect(adultEv.after).toEqual({ investorCategory: "individual", riskProfile: "moderate" });
  });

  it("registrar import: a stated guardian is linked only when it passes the manual-link rules (HUF PAN and shared PAN never link); each outcome is audited", async () => {
    const { importRtaFolios } = await import("@/lib/rta/import");
    const good = `AAAP${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;
    const hufPan = pan("H");
    const shared = pan();
    // Two live records already hold `shared`.
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, status, dedup_pan)
      VALUES (gen_random_uuid(), ${t}::uuid, ${shared}, 'Shared One', ${rmA}::uuid, 'individual', '1980-01-01', 'active', true),
             (gen_random_uuid(), ${t}::uuid, ${shared}, 'Shared Two', ${rmA}::uuid, 'individual', '1980-01-01', 'active', false)`));
    const rec = (minorName: string, gp: string, folio: string) => ({
      rta: "cams", folioNumber: folio, amcCode: "P", amcName: "ICICI Prudential",
      investor: { name: minorName, category: "minor", isMinor: true, guardianPan: gp, guardianName: "Stated Guardian", dob: "2015-04-04" },
      nominees: [], bank: {},
      schemes: [{ schemeCode: "P1746", schemeName: "Test Fund", units: 10, nav: 100, value: 1000 }], aum: 1000,
    }) as any;
    await withSystem((tx) => importRtaFolios(tx, t, [rec("Kid Good", good, "F-G1"), rec("Kid Huf", hufPan, "F-H1"), rec("Kid Shared", shared, "F-S1")], { kind: "master" }));
    const byName = async (n: string) => one(sql`SELECT id::text AS id, guardian_investor_id::text AS g FROM investors WHERE tenant_id = ${t}::uuid AND name = ${n}`);
    const kg = await byName("Kid Good"), kh = await byName("Kid Huf"), ks = await byName("Kid Shared");
    expect(kg.g).not.toBeNull();
    expect(await auditCount(kg.id, "investor.guardian_linked")).toBe(1);
    expect(kh.g).toBeNull(); expect(ks.g).toBeNull();
    expect(await auditCount(kh.id, "investor.guardian_not_linked")).toBe(1);
    expect(await auditCount(ks.id, "investor.guardian_not_linked")).toBe(1);
    expect(await status(kh.id)).toBe("pending");
    // Re-importing the same file writes no second audit row.
    await withSystem((tx) => importRtaFolios(tx, t, [rec("Kid Good", good, "F-G1"), rec("Kid Huf", hufPan, "F-H1")], { kind: "master" }));
    expect(await auditCount(kg.id, "investor.guardian_linked")).toBe(1);
    expect(await auditCount(kh.id, "investor.guardian_not_linked")).toBe(1);
  });

  it("bulk age-based risk assignment leaves minors out: an age cannot be a minor account's assessment", async () => {
    const { planAgeAssignment } = await import("@/lib/risk-profile/bulk-age-assign");
    const { DEFAULT_AGE_BANDS } = await import("@/lib/risk-profile/age-bands");
    const a = await adult(rmB, "Plan Adult", false);
    const kid = await minorRow(rmB, { name: "Plan Kid" });
    const plan = await withTenant(t, (tx) => planAgeAssignment(tx as any, { tenantId: t, bands: DEFAULT_AGE_BANDS, rmId: rmB }));
    const ids = [...plan.assign, ...plan.skipped].map((x) => x.investorId);
    expect(ids).toContain(a);
    expect(ids).not.toContain(kid);
  });

  it("a retry of a minor, or a key held by a client the user cannot open, is refused with one sentence that names no record, state, PAN or guardian", async () => {
    h.session = sess(rmA, ["rm"]);
    const body = { name: "Dedup Kid", investorCategory: "minor", dob: "2015-05-05", segmentTag: "Retail", typeDetails: { guardian: { name: "G", pan: pan(), relation: "father" } } };
    expect((await post(body)).status).toBe(201);
    const own = await post(body);
    h.session = sess(rmB, ["rm"]); // data wall: RM B cannot open RM A's minor
    const other = await post(body);
    for (const res of [own, other]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("A client with these details is already on record. Search the client list before adding them again.");
      expect(res.body.existing).toBeUndefined();
      expect(res.text).not.toMatch(/Trash|exited|PAN|Dedup Kid/i);
    }
  });
});
