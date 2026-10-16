/**
 * G-1 × risk-profile upload and expiry (main 0236, 2026-10-16). Real PostgreSQL,
 * restricted role, RLS on; session mocked. Adults and minors are tested apart.
 *
 *  - a minor's expiry is the minor's OWN assessment's (stated by an upload, else
 *    signed + 1 year) — never the guardian's dates that 0234 / 0236 copy onto the row;
 *  - an expired minor assessment satisfies no gate; a new verified upload renews it;
 *  - a guardian change does not renew or validate the minor's assessment;
 *  - an adult keeps main's rule (the stated expiry while it belongs to the signed date);
 *  - the upload route: only `risk_profile.manage`, only a client in the user's book,
 *    and a minor only with a verified guardian — all refused before anything is stored.
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
  assertModuleEnabled: vi.fn(async () => {}),
}));

const L = "ABCDEFGHJKLMNQRSTUVWXYZ";
const r = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join("");
const pan = (type = "P") => `${r(3)}${type}${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;

describe.skipIf(!TEST_DB)("G-1 × risk-profile upload and expiry (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let OA: typeof import("@/lib/risk-profile/own-assessment");
  const t = randomUUID(), owner = randomUUID(), rmA = randomUUID(), rmB = randomUUID(), mkt = randomUUID();
  const sess = (userId: string, roles: string[]) => ({ userId, tenantId: t, roles, permissions: [], branchId: null, sid: "s", name: "Tester" });
  const one = async (q: any) => withTenant(t, async (tx) => (await tx.execute(q)).rows[0] as any);
  const mf = [{ kind: "mf", schemeName: "Liquid Fund", riskRating: "low" }];
  const guardian = async (rm: string, opts: { expires?: string; signed?: string } = {}) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, status, dedup_pan,
        risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional, risk_profile_expires_on, risk_profile_expiry_for)
      VALUES (${id}::uuid, ${t}::uuid, ${pan()}, 'Parent', ${rm}::uuid, 'individual', '1980-01-01', 'active', true,
              'aggressive', 40, ${opts.signed ?? "2026-10-01T12:00:00Z"}::timestamptz, false, ${opts.expires ?? "2031-10-01"}::date, ${opts.signed ?? "2026-10-01T12:00:00Z"}::timestamptz)`));
    return id;
  };
  const minor = async (rm: string, g: string | null) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, is_minor, dob, guardian_investor_id, status)
      VALUES (${id}::uuid, ${t}::uuid, ${"MINOR:" + pan()}, 'Expiry Kid', ${rm}::uuid, 'minor', true, '2015-01-01', ${g}::uuid, 'active')`));
    return id;
  };
  const ownAssessment = (id: string, signedAgo: string, nextReview: string | null = null) => withTenant(t, (tx) => tx.execute(sql`
    INSERT INTO risk_profile_responses (tenant_id, investor_id, final_category, total_score, signed_at, provisional, next_review_at)
    VALUES (${t}::uuid, ${id}::uuid, 'moderate', 11, now() - ${signedAgo}::interval, false, ${nextReview}::date)`));
  const bucket = async (id: string) => {
    const { riskBucketSql } = await import("@/lib/risk-profile/buckets");
    return (await one(sql`SELECT CASE WHEN ${riskBucketSql("current")} THEN 'current' WHEN ${riskBucketSql("due")} THEN 'due'
                                     WHEN ${riskBucketSql("expired")} THEN 'expired' ELSE 'other' END AS b FROM investors i WHERE i.id = ${id}::uuid`)).b;
  };
  const gate = async (id: string) => {
    const { minorProposalGate } = await import("@/lib/proposals/minor-gate");
    return withTenant(t, (tx) => minorProposalGate(tx, t, { investorId: id, products: mf }));
  };
  const upload = async (investorId: string, f: Record<string, unknown> = {}) => {
    const { recordUploadedRiskProfile } = await import("@/lib/risk-profile/upload");
    return withTenant(t, async (tx) => {
      const [cur] = (await tx.execute(sql`SELECT id, name, investor_category AS "investorCategory", guardian_investor_id AS "guardianInvestorId",
          risk_profile_signed_at AS "riskProfileSignedAt", risk_profile_version AS "riskProfileVersion" FROM investors WHERE id = ${investorId}::uuid`)).rows as any[];
      return recordUploadedRiskProfile(tx as any, { tenantId: t, userId: owner, investor: cur, today: new Date().toISOString().slice(0, 10), documentKey: "k.pdf",
        fields: { investorId, category: "moderate", score: 22, assessedOn: new Date(Date.now() - 864e5).toISOString().slice(0, 10), expiresOn: "2030-01-01", ...f } as any });
    });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    OA = await import("@/lib/risk-profile/own-assessment");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn, restrict_user_data_scope) VALUES (${t}::uuid, 'G1e firm', 'G1e firm', ${"ARN-GE" + t.slice(0, 5)}, true)`);
      for (const [id, role, nm] of [[owner, "owner", "Owner"], [rmA, "rm", "RMA"], [rmB, "rm", "RMB"], [mkt, "marketing", "Mkt"]] as const)
        await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${t}::uuid, ${`${nm}-${id.slice(0, 8)}@example.test`}, ${nm}, ARRAY[${role}]::text[], 'active')`);
    });
  });
  afterAll(async () => {
    const run = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    await run(sql`UPDATE investors SET guardian_investor_id = NULL WHERE tenant_id = ${t}::uuid`);
    for (const table of ["risk_profile_responses", "events_outbox", "audit_log", "investors", "users"]) await run(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await run(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  /* ── minors ─────────────────────────────────────────────────────── */
  it("minor: the expiry is the minor's own (signed 13 months ago → lapsed) even though the row carries the guardian's 2031 expiry; no gate passes", async () => {
    const g = await guardian(rmA);
    const kid = await minor(rmA, g);
    await ownAssessment(kid, "13 months");
    const row = await one(sql`SELECT risk_profile_expires_on::text AS e FROM investors WHERE id = ${kid}::uuid`);
    expect(row.e).toBe("2031-10-01"); // 0236's copy of the guardian's stated expiry, on the row
    const own = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, kid));
    expect(own.inheritedIgnored).toBe(true);
    expect(OA.suitabilityStatus(own)).toBe("Due for review");
    expect(await bucket(kid)).toBe("expired");
    const sqlExp = await one(sql`SELECT ${OA.clientRiskSql("i").expiresOn}::text AS e FROM investors i WHERE i.id = ${kid}::uuid`);
    expect(sqlExp.e).toBe(own.expiresOn);
    expect((await gate(kid))?.kind).toBe("risk");
    const { loadClientSummary } = await import("@/lib/investors/summary");
    expect((await withTenant(t, (tx) => loadClientSummary(tx as any, t, kid)))?.risk).toBe("Due for review");
  });

  it("minor: no own assessment stays not profiled whatever the guardian's dates; a historical record without one stays pending", async () => {
    const g = await guardian(rmA);
    const kid = await minor(rmA, g);
    expect(["not_profiled", "other"]).toContain(await bucket(kid));
    const own = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, kid));
    expect(own).toMatchObject({ category: null, expiresOn: null });
    expect((await gate(kid))?.kind).toBe("risk");
  });

  it("minor: a new verified upload renews the minor's own expiry and the gate passes; the guardian's own profile is untouched", async () => {
    const g = await guardian(rmA, { expires: "2027-01-01" });
    const kid = await minor(rmA, g);
    await ownAssessment(kid, "13 months");
    expect((await gate(kid))?.kind).toBe("risk");
    const res = await upload(kid, { expiresOn: "2029-06-30" });
    expect(res.becameCurrent).toBe(true);
    const own = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, kid));
    expect(own).toMatchObject({ category: "moderate", expiresOn: "2029-06-30" });
    expect(OA.suitabilityStatus(own)).toBe("Completed");
    expect(await gate(kid)).toBeNull();
    expect((await one(sql`SELECT risk_profile, risk_profile_expires_on::text AS e FROM investors WHERE id = ${g}::uuid`))).toMatchObject({ risk_profile: "aggressive", e: "2027-01-01" });
    const audit = await one(sql`SELECT after FROM audit_log WHERE action = 'risk_profile.upload' AND after->>'investorId' = ${kid}`);
    expect(audit.after).toMatchObject({ forMinorAccount: true, guardianInvestorId: g });
  });

  it("minor: an uploaded assessment that states an EARLIER expiry lapses on that date (not a year after signing) — summary, buckets and gate agree", async () => {
    const g = await guardian(rmA);
    const kid = await minor(rmA, g);
    const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    await upload(kid, { assessedOn: d(-30), expiresOn: d(-2) });
    const own = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, kid));
    expect(own.expiresOn).toBe(d(-2));
    expect(OA.suitabilityStatus(own)).toBe("Due for review");
    expect(await bucket(kid)).toBe("expired");
    expect((await gate(kid))?.kind).toBe("risk");
    const { loadClientSummary } = await import("@/lib/investors/summary");
    expect((await withTenant(t, (tx) => loadClientSummary(tx as any, t, kid)))?.risk).toBe("Due for review");
  });

  it("minor: changing the guardian to one with a fresh profile does not renew or validate the minor's assessment", async () => {
    const g1 = await guardian(rmA, { expires: "2026-11-01" });
    const kid = await minor(rmA, g1);
    await ownAssessment(kid, "13 months");
    const before = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, kid));
    const g2 = await guardian(rmA, { signed: new Date().toISOString(), expires: "2032-01-01" });
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET guardian_investor_id = ${g2}::uuid WHERE id = ${kid}::uuid`));
    const after = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, kid));
    expect(after).toEqual(before);
    expect(OA.suitabilityStatus(after)).toBe("Due for review");
    expect((await gate(kid))?.kind).toBe("risk");
  });

  it("minor: no upload without a verified guardian — none on record, or a link to an HUF-PAN record", async () => {
    const orphan = await minor(rmA, null);
    await expect(upload(orphan)).rejects.toMatchObject({ status: 409 });
    const huf = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, status, dedup_pan)
      VALUES (${huf}::uuid, ${t}::uuid, ${pan("H")}, 'HUF', ${rmA}::uuid, 'individual', '1980-01-01', 'active', true)`));
    const kid = await minor(rmA, huf);
    await expect(upload(kid)).rejects.toMatchObject({ status: 409 });
    expect((await one(sql`SELECT count(*)::int AS n FROM risk_profile_responses WHERE investor_id IN (${orphan}::uuid, ${kid}::uuid)`)).n).toBe(0);
  });

  it("minor: the list helper gives the minor's own expiry pair, so the client page's lapsed check reads the minor's own", async () => {
    const { riskProfileLapsed } = await import("@/lib/risk-profile/expiry");
    const g = await guardian(rmA, { expires: "2035-01-01" });
    const kid = await minor(rmA, g);
    await ownAssessment(kid, "13 months");
    const [row] = await withTenant(t, async (tx) => OA.withOwnRiskForMinors(tx, t, (await tx.execute(sql`SELECT id, risk_profile_signed_at AS "riskProfileSignedAt",
        risk_profile_expires_on AS "riskProfileExpiresOn", risk_profile_expiry_for AS "riskProfileExpiryFor" FROM investors WHERE id = ${kid}::uuid`)).rows as any[]));
    expect(riskProfileLapsed(row)).toBe(true);
  });

  /* ── adults ─────────────────────────────────────────────────────── */
  it("adult: main's rule is unchanged — the stated expiry counts while it belongs to the signed date", async () => {
    const a = await guardian(rmA, { signed: new Date(Date.now() - 400 * 864e5).toISOString(), expires: "2030-01-01" });
    expect(await bucket(a)).toBe("current");
    const own = await withTenant(t, (tx) => OA.suitabilityProfile(tx, t, a));
    expect(own).toMatchObject({ inheritedIgnored: false, expiresOn: "2030-01-01" });
    await withTenant(t, (tx) => tx.execute(sql`UPDATE investors SET risk_profile_expires_on = (CURRENT_DATE - 1) WHERE id = ${a}::uuid`));
    expect(await bucket(a)).toBe("expired");
    expect(await gate(a)).toBeNull(); // the minor gate never applies to an adult
  });

  /* ── the upload route ───────────────────────────────────────────── */
  it("upload route: no capability → 403; outside the book → 404; minor without a verified guardian → 409 — before anything is stored", async () => {
    const { POST, GET } = await import("@/app/api/risk-profiles/upload/route");
    const form = (investorId: string) => {
      const fd = new FormData();
      fd.set("file", new File([Buffer.from("%PDF-1.4 test")], "rp.pdf", { type: "application/pdf" }));
      for (const [k, v] of Object.entries({ investorId, category: "moderate", score: "20", assessedOn: "2026-10-01", expiresOn: "2027-10-01" })) fd.set(k, v);
      return new NextRequest("http://x/api/risk-profiles/upload", { method: "POST", body: fd });
    };
    const gB = await guardian(rmB);
    const kidB = await minor(rmB, gB);
    const orphan = await minor(rmA, null);
    h.session = sess(mkt, ["marketing"]);
    expect((await POST(form(orphan))).status).toBe(403);
    h.session = sess(rmA, ["rm"]);
    expect((await POST(form(kidB))).status).toBe(404);
    const res = await POST(form(orphan));
    expect(res.status).toBe(409);
    expect(await res.text()).not.toMatch(/Parent|aggressive/);
    expect((await one(sql`SELECT count(*)::int AS n FROM risk_profile_responses WHERE investor_id = ${orphan}::uuid`)).n).toBe(0);
    // GET for a linked minor shows the minor's OWN current profile and never the guardian's copy or identity.
    const kid = await minor(rmA, await guardian(rmA));
    const g = await GET(new NextRequest(`http://x/api/risk-profiles/upload?investorId=${kid}`));
    const body = await g.json();
    expect(body).toMatchObject({ minor: { guardianVerified: true }, current: null });
    expect(JSON.stringify(body)).not.toMatch(/aggressive|Parent/);
  });
});
