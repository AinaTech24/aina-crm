/**
 * Client master and servicing fixes (journey audit C5, C6, C9, C11, C15,
 * C16, malformed ids), exercised through the real route handlers on a real
 * database. Only the session and the licence gate are stubbed.
 *
 *   C5   a risk category picked by staff is PROVISIONAL, signed by nobody
 *   C6   minor → major: own PAN replaces the MINOR: key, guardian unlinked,
 *        fresh KYC, audited
 *   C9   the client's branch follows its RM (create, edit, bulk); an explicit
 *        branch wins
 *   C11  review reminders cover active + redemption_risk, soonest first, paged
 *   C15  client-type rules enforced by the API, field by field
 *   C16  health uses the chosen KYC status; Add client into a family maps it
 *        in the same transaction
 *
 * Needs a migrated Postgres in TEST_DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/auth/license", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/license")>()),
  assertActiveLicense: vi.fn(async () => undefined),
  assertModuleEnabled: vi.fn(async () => undefined),
  assertInvestorQuota: vi.fn(async () => undefined),
}));

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("client master journey (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let POST_INV: typeof import("@/app/api/investors/route").POST;
  let ONE: typeof import("@/app/api/investors/[id]/route");
  let BULK: typeof import("@/app/api/investors/bulk/route").POST;
  let reviewDueQuery: typeof import("@/workers/review-due-reminder").reviewDueQuery;
  let applyRiskCategory: typeof import("@/lib/risk-profile/apply").applyRiskCategory;

  const tenant = randomUUID();
  const b1 = randomUUID();
  const b2 = randomUUID();
  const owner = randomUUID();
  const rm1 = randomUUID();
  const rm2 = randomUUID();
  const family = randomUUID();
  const head = randomUUID();
  const panSeq = { n: 1000 };
  const nextPan = (prefix = "ABCDE") => `${prefix}${String(panSeq.n++).padStart(4, "0")}F`;

  const q = (text: any) => withSystem((tx) => tx.execute(text));
  const row = async (id: string) =>
    (await q(sql`SELECT * FROM investors WHERE id = ${id}::uuid`)).rows[0] as Record<string, any>;
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const create = async (body: Record<string, unknown>) => {
    const res = await POST_INV(new NextRequest("https://crm.test/api/investors", json(body)) as any);
    return { status: res.status, body: await res.json() };
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await ONE.PATCH(
      new NextRequest(`https://crm.test/api/investors/${id}`, { ...json(body), method: "PATCH" }) as any,
      { params: Promise.resolve({ id }) },
    );
    return { status: res.status, body: await res.json() };
  };
  const adultDob = "1980-05-10";
  const childDob = `${new Date().getFullYear() - 10}-03-15`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ POST: POST_INV } = await import("@/app/api/investors/route"));
    ONE = await import("@/app/api/investors/[id]/route");
    ({ POST: BULK } = await import("@/app/api/investors/bulk/route"));
    ({ reviewDueQuery } = await import("@/workers/review-due-reminder"));
    ({ applyRiskCategory } = await import("@/lib/risk-profile/apply"));

    mocks.session.mockResolvedValue({ tenantId: tenant, userId: owner, branchId: b1, roles: ["owner"] });

    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'CM Test', 'CM Test', ${"ARN-CM-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${b1}::uuid, ${tenant}::uuid, 'North', 'N'), (${b2}::uuid, ${tenant}::uuid, 'South', 'S')`);
    const user = (id: string, name: string, roles: string[], branch: string | null) =>
      q(sql`INSERT INTO users (id, tenant_id, email, name, roles, branch_id, status)
            VALUES (${id}::uuid, ${tenant}::uuid, ${name.toLowerCase() + "@" + tenant.slice(0, 8) + ".test"}, ${name},
                    ${`{${roles.join(",")}}`}::text[], ${branch}::uuid, 'active')`);
    await user(owner, "Owner", ["owner"], null);
    await user(rm1, "Rmone", ["rm"], b1);
    await user(rm2, "Rmtwo", ["rm"], b2);
    // A family whose head is served by RM 2 (South).
    await q(sql`INSERT INTO families (id, tenant_id, head_name) VALUES (${family}::uuid, ${tenant}::uuid, 'Head Family')`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, rm_id, branch_id, family_id, family_role, status)
                VALUES (${head}::uuid, ${tenant}::uuid, 'Hema Head', ${nextPan("HEADP")}, ${rm2}::uuid, ${b2}::uuid, ${family}::uuid, 'head', 'active')`);
    await q(sql`UPDATE families SET primary_investor_id = ${head}::uuid WHERE id = ${family}::uuid`);
  });

  afterAll(async () => {
    try {
      for (const t of ["risk_profile_responses", "audit_log", "events_outbox", "tasks", "notifications", "investors", "families", "users", "branches"]) {
        await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`);
      }
      await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
    } catch {
      /* best effort */
    }
  });

  /* ───────────────────────── C5 ───────────────────────── */

  it("C5: a risk category chosen on Add client is provisional and signed by nobody", async () => {
    const r = await create({ name: "Priya Provisional", pan: nextPan(), dob: adultDob, riskProfile: "aggressive" });
    expect(r.status).toBe(201);
    const inv = await row(r.body.id);
    expect(inv.risk_profile).toBe("aggressive");
    expect(inv.risk_profile_provisional).toBe(true);
    const hist = (await q(sql`SELECT provisional, signed_by_name, basis FROM risk_profile_responses WHERE investor_id = ${r.body.id}::uuid`)).rows as any[];
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ provisional: true, signed_by_name: null, basis: "staff_entry" });
  });

  it("C5: the edit form records only a CHANGED category, and provisionally", async () => {
    const r = await create({ name: "Esha Edit", pan: nextPan(), dob: adultDob });
    const id = r.body.id;
    // A client-confirmed profile on file (questionnaire), then the form saves.
    await withSystem((tx) => applyRiskCategory({ tx: tx as any, tenantId: tenant, investorId: id, category: "moderate", signedByName: "Esha Edit" }));
    expect((await row(id)).risk_profile_provisional).toBe(false);

    expect((await patch(id, { riskProfile: "moderate", phone: "+919800000001" })).status).toBe(200);
    expect((await row(id)).risk_profile_provisional).toBe(false); // unchanged → untouched

    const changed = await patch(id, { riskProfile: "very_aggressive" });
    expect(changed.status).toBe(200);
    expect(changed.body.riskProfile).toBe("very_aggressive");
    const inv = await row(id);
    expect(inv.risk_profile).toBe("very_aggressive");
    expect(inv.risk_profile_provisional).toBe(true);
    const n = (await q(sql`SELECT count(*)::int AS n FROM risk_profile_responses WHERE investor_id = ${id}::uuid`)).rows[0] as any;
    expect(n.n).toBe(2);
  });

  /* ───────────────────────── C15 ───────────────────────── */

  it("C15: the API enforces the client-type rules with the field at fault", async () => {
    const gp = nextPan("GUARD");
    const noDob = await create({ name: "Mini Nodob", investorCategory: "minor", typeDetails: { guardian: { name: "Papa", pan: gp } } });
    expect(noDob).toMatchObject({ status: 400, body: { field: "dob" } });

    const grown = await create({ name: "Mini Grown", investorCategory: "minor", dob: adultDob, typeDetails: { guardian: { name: "Papa", pan: gp } } });
    expect(grown).toMatchObject({ status: 400, body: { field: "dob" } });

    const noGuardian = await create({ name: "Mini Alone", investorCategory: "minor", dob: childDob, typeDetails: { guardian: { pan: gp } } });
    expect(noGuardian).toMatchObject({ status: 400, body: { field: "typeDetails.guardian.name" } });

    const huf = await create({ name: "Sharma HUF", pan: nextPan("SHRMH"), investorCategory: "huf" });
    expect(huf).toMatchObject({ status: 400, body: { field: "typeDetails.karta.name" } });

    const ok = await create({ name: "Gupta HUF", pan: nextPan("GUPTH"), investorCategory: "huf", typeDetails: { karta: { name: "Raj Gupta" } } });
    expect(ok.status).toBe(201);
    // Re-typing an individual as an HUF needs a Karta too.
    const ind = await create({ name: "Ira Individual", pan: nextPan(), dob: adultDob });
    expect(await patch(ind.body.id, { investorCategory: "huf" })).toMatchObject({ status: 400, body: { field: "typeDetails.karta.name" } });
  });

  it("C15: an unrelated edit of an old record is not refused for a gap it already had", async () => {
    const id = randomUUID();
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, investor_category, is_minor, rm_id, status)
                VALUES (${id}::uuid, ${tenant}::uuid, 'Legacy Minor', ${"MINOR:" + nextPan("LEGCY")}, 'minor', true, ${rm1}::uuid, 'active')`);
    expect((await patch(id, { phone: "+919800000002" })).status).toBe(200);
  });

  /* ───────────────────────── C6 ───────────────────────── */

  it("C6: minor → major takes the client's own PAN, unlinks the guardian and restarts KYC", async () => {
    const gp = nextPan("GPANX");
    const g = await create({ name: "Guru Guardian", pan: gp, dob: adultDob, kycStatus: "verified" });
    await withSystem((tx) => applyRiskCategory({ tx: tx as any, tenantId: tenant, investorId: g.body.id, category: "aggressive", signedByName: "Guru Guardian" }));

    const m = await create({
      name: "Kiran Kid", investorCategory: "minor", dob: childDob, kycStatus: "verified",
      typeDetails: { guardian: { name: "Guru Guardian", pan: gp } },
    });
    expect(m.status).toBe(201);
    const id = m.body.id;
    let inv = await row(id);
    expect(inv.pan).toMatch(/^MINOR:/);
    expect(inv.guardian_investor_id).toBe(g.body.id);
    expect(inv.risk_profile).toBe("aggressive"); // the guardian's (migration 0234)

    // Still a minor: the guardian-keyed PAN stays locked.
    expect(await patch(id, { pan: nextPan("KIRAN") })).toMatchObject({ status: 400, body: { field: "pan" } });
    // An adult needs a PAN of their own …
    expect(await patch(id, { investorCategory: "individual" })).toMatchObject({ status: 400, body: { field: "pan" } });
    // … which may not be another client's (here: the guardian's).
    expect((await patch(id, { investorCategory: "individual", pan: gp })).status).toBe(409);

    const own = nextPan("KIRAN");
    const done = await patch(id, { investorCategory: "individual", pan: own });
    expect(done.status).toBe(200);
    inv = await row(id);
    expect(inv.pan).toBe(own); // no MINOR: prefix
    expect(inv.investor_category).toBe("individual");
    expect(inv.is_minor).toBe(false);
    expect(inv.guardian_investor_id).toBeNull();
    expect(inv.kyc_status).toBe("pending");
    expect(inv.risk_profile).toBeNull(); // the guardian's copy is not the adult's
    const audit = (await q(sql`SELECT before, after FROM audit_log WHERE entity_id = ${id}::uuid AND action = 'investor.minor_to_major'`)).rows as any[];
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toMatchObject({ investorCategory: "minor", panKey: "guardian_pan", guardianInvestorId: g.body.id });
    expect(JSON.stringify(audit[0])).not.toContain(own);
    // The guardian keeps their own record.
    expect((await row(g.body.id)).pan).toBe(gp);
  });

  it("C6: a minor keyed on their own PAN drops the prefix on becoming an Individual", async () => {
    const own = nextPan("OWNMN");
    const m = await create({ name: "Mira Minor", pan: own, investorCategory: "minor", dob: childDob, typeDetails: { guardian: { name: "Ma" } } });
    expect((await row(m.body.id)).pan).toBe(`MINOR:${own}`);
    expect((await patch(m.body.id, { investorCategory: "individual" })).status).toBe(200);
    expect((await row(m.body.id)).pan).toBe(own);
  });

  /* ───────────────────────── C9 ───────────────────────── */

  it("C9: the branch follows the RM on create, on edit and in bulk; an explicit branch wins", async () => {
    const c = await create({ name: "Bina Branch", pan: nextPan(), dob: adultDob, rmId: rm2 });
    const id = c.body.id;
    expect((await row(id)).branch_id).toBe(b2);

    expect((await patch(id, { rmId: rm1 })).status).toBe(200);
    expect((await row(id)).branch_id).toBe(b1);

    expect((await patch(id, { rmId: rm2, branchId: b1 })).status).toBe(200);
    expect(await row(id)).toMatchObject({ rm_id: rm2, branch_id: b1 });

    expect((await patch(id, { branchId: randomUUID() })).status).toBe(400);

    const res = await BULK(new NextRequest("https://crm.test/api/investors/bulk", json({ action: "assign", ids: [id], value: rm1 })) as any);
    expect(res.status).toBe(200);
    expect(await row(id)).toMatchObject({ rm_id: rm1, branch_id: b1 });
    await BULK(new NextRequest("https://crm.test/api/investors/bulk", json({ action: "assign", ids: [id], value: rm2 })) as any);
    expect(await row(id)).toMatchObject({ rm_id: rm2, branch_id: b2 });
  });

  it("C9: an assigned-only RM cannot move a client to another branch", async () => {
    const c = await create({ name: "Rita Rmclient", pan: nextPan(), dob: adultDob, rmId: rm1 });
    mocks.session.mockResolvedValueOnce({ tenantId: tenant, userId: rm1, branchId: b1, roles: ["rm"] });
    const r = await patch(c.body.id, { branchId: b2 });
    expect(r).toMatchObject({ status: 403, body: { field: "branchId" } });
    expect((await row(c.body.id)).branch_id).toBe(b1);
  });

  /* ───────────────────────── C16 ───────────────────────── */

  it("C16: the initial health score reads the KYC status chosen on the form", async () => {
    const pending = await create({ name: "Pia Pending", pan: nextPan(), dob: adultDob, kycStatus: "pending" });
    const rejected = await create({ name: "Raj Rejected", pan: nextPan(), dob: adultDob, kycStatus: "rejected" });
    const p = await row(pending.body.id);
    const r = await row(rejected.body.id);
    expect(r.kyc_status).toBe("rejected");
    // A rejected KYC costs health; it used to be scored as "pending".
    expect(Number(r.health_score)).toBeLessThan(Number(p.health_score));
  });

  it("C16: Add client into a family maps it in the create transaction", async () => {
    const c = await create({ name: "Fia Familymember", pan: nextPan(), dob: adultDob, familyId: family, familyRole: "spouse" });
    expect(c.status).toBe(201);
    const inv = await row(c.body.id);
    expect(inv).toMatchObject({ family_id: family, family_role: "spouse", rm_id: rm2, branch_id: b2 });
    const audit = (await q(sql`SELECT 1 FROM audit_log WHERE entity_id = ${family}::uuid AND action = 'family.member.add'`)).rows;
    expect(audit.length).toBeGreaterThan(0);

    // An RM chosen on the form is kept.
    const chosen = await create({ name: "Cho Chosen", pan: nextPan(), dob: adultDob, familyId: family, rmId: rm1 });
    expect(await row(chosen.body.id)).toMatchObject({ family_id: family, rm_id: rm1 });

    // A family that cannot be mapped refuses the create — nothing half-made.
    const pan = nextPan();
    const bad = await create({ name: "Nob Nofamily", pan, dob: adultDob, familyId: randomUUID() });
    expect(bad.status).toBe(404);
    const left = (await q(sql`SELECT 1 FROM investors WHERE tenant_id = ${tenant}::uuid AND pan = ${pan}`)).rows;
    expect(left).toHaveLength(0);
  });

  /* ───────────────────────── C11 ───────────────────────── */

  it("C11: review reminders cover active and redemption-risk clients, soonest first, every page", async () => {
    const mk = async (name: string, status: string, daysFromNow: number, extra?: ReturnType<typeof sql>) => {
      const id = randomUUID();
      await q(sql`INSERT INTO investors (id, tenant_id, name, pan, status, rm_id, next_review_at)
                  VALUES (${id}::uuid, ${tenant}::uuid, ${name}, ${nextPan("REVWX")}, ${status}, ${rm1}::uuid,
                          now() + make_interval(days => ${daysFromNow}::int))`);
      if (extra) await q(sql`UPDATE investors SET ${extra} WHERE id = ${id}::uuid`);
      return id;
    };
    const a = await mk("Rev Active", "active", 3);
    const r = await mk("Rev Risk", "redemption_risk", -5);
    const o = await mk("Rev Overdue", "active", -20);
    await mk("Rev Dormant", "dormant", 1);
    await mk("Rev Closed", "closed", 1);
    await mk("Rev Later", "active", 40);
    await mk("Rev Deleted", "active", 2, sql`deleted_at = now()`);

    const seen: string[] = [];
    let cursor: { at: string; id: string } | null = null;
    for (let i = 0; i < 10; i++) {
      const page = (await withTenant(tenant, (tx) => tx.execute(reviewDueQuery(tenant, cursor, 2)))).rows as any[];
      seen.push(...page.map((p) => String(p.id)));
      if (page.length < 2) break;
      cursor = { at: String(page[page.length - 1].at), id: String(page[page.length - 1].id) };
    }
    expect(seen).toEqual([o, r, a]);
  });

  /* ───────────────────────── malformed ids ───────────────────────── */

  it("answers 404, not 500, for a malformed client id", async () => {
    const ctx = { params: Promise.resolve({ id: "not-a-uuid" }) };
    expect((await ONE.GET(new NextRequest("https://crm.test/api/investors/not-a-uuid") as any, ctx)).status).toBe(404);
    expect((await ONE.PATCH(new NextRequest("https://crm.test/api/investors/not-a-uuid", { ...json({ name: "X" }), method: "PATCH" }) as any, ctx)).status).toBe(404);
    expect((await ONE.DELETE(new NextRequest("https://crm.test/api/investors/not-a-uuid", { method: "DELETE" }) as any, ctx)).status).toBe(404);
  });
});
