/**
 * A risk profile the client already holds, recorded from its PDF with its own
 * "Expire On" date — and that date honoured everywhere a profile's life is
 * judged (lib/risk-profile/expiry.ts).
 *
 * Two halves: the pure rules, and the database behaviour (needs a migrated
 * Postgres in TEST_DATABASE_URL; skipped otherwise).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { riskExpiresOn, riskProfileLapsed } from "@/lib/risk-profile/expiry";
import { UploadFieldsSchema, validateUploadDates } from "@/lib/risk-profile/upload";

describe("riskExpiresOn / riskProfileLapsed", () => {
  const signed = new Date("2026-03-03T12:00:00Z");

  it("no signed profile: nothing to lapse", () => {
    expect(riskExpiresOn({})).toBeNull();
    expect(riskProfileLapsed({})).toBe(false);
  });

  it("without a stated expiry it lapses a year after it was signed", () => {
    expect(riskExpiresOn({ riskProfileSignedAt: signed })?.toISOString().slice(0, 10)).toBe("2027-03-03");
    expect(riskProfileLapsed({ riskProfileSignedAt: signed }, new Date("2027-03-03T10:00:00Z"))).toBe(false);
    expect(riskProfileLapsed({ riskProfileSignedAt: signed }, new Date("2027-03-04T00:00:01Z"))).toBe(true);
  });

  it("a stated expiry counts while it belongs to the signed date", () => {
    const r = { riskProfileSignedAt: signed, riskProfileExpiresOn: "2029-03-03", riskProfileExpiryFor: signed };
    expect(riskExpiresOn(r)?.toISOString().slice(0, 10)).toBe("2029-03-03");
    expect(riskProfileLapsed(r, new Date("2028-01-01T00:00:00Z"))).toBe(false);
  });

  it("a stated expiry stops counting the moment a newer signed date is recorded", () => {
    const newer = new Date("2026-09-01T12:00:00Z");
    const r = { riskProfileSignedAt: newer, riskProfileExpiresOn: "2029-03-03", riskProfileExpiryFor: signed };
    expect(riskExpiresOn(r)?.toISOString().slice(0, 10)).toBe("2027-09-01");
  });
});

describe("upload fields", () => {
  const ok = { investorId: randomUUID(), category: "moderate", score: "22", assessedOn: "2026-03-03", expiresOn: "2027-03-03" };

  it("accepts a profile with its category, score and dates", () => {
    const p = UploadFieldsSchema.safeParse(ok);
    expect(p.success).toBe(true);
    expect(p.success && p.data.score).toBe(22);
  });

  it("refuses an unknown category, a decimal score and a malformed date", () => {
    expect(UploadFieldsSchema.safeParse({ ...ok, category: "bold" }).success).toBe(false);
    expect(UploadFieldsSchema.safeParse({ ...ok, score: "22.5" }).success).toBe(false);
    expect(UploadFieldsSchema.safeParse({ ...ok, expiresOn: "03/03/2027" }).success).toBe(false);
  });

  it("the dates must make sense", () => {
    expect(validateUploadDates("2026-03-03", "2027-03-03", "2026-10-15")).toBeNull();
    expect(validateUploadDates("2026-11-01", "2027-11-01", "2026-10-15")).toContain("future");
    expect(validateUploadDates("2026-03-03", "2026-03-03", "2026-10-15")).toContain("after");
    expect(validateUploadDates("2026-03-03", "2040-03-03", "2026-10-15")).toContain("ten years");
    // An already-expired profile is allowed: it is recorded, and shows as expired.
    expect(validateUploadDates("2024-03-03", "2025-03-03", "2026-10-15")).toBeNull();
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("recordUploadedRiskProfile", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let record: typeof import("@/lib/risk-profile/upload").recordUploadedRiskProfile;
  let riskExpiresOnSql: typeof import("@/lib/risk-profile/expiry").riskExpiresOnSql;
  let riskBucketSql: typeof import("@/lib/risk-profile/buckets").riskBucketSql;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const user = randomUUID();
  const ids = { a: randomUUID(), guardian: randomUUID(), minor: randomUUID(), b: randomUUID() };

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const client = (id: string, name: string, extra = "") =>
    q(sql`INSERT INTO investors (id, tenant_id, name, dedup_pan) VALUES (${id}::uuid, ${tenant}::uuid, ${name}, false)`);
  const row = async (id: string) =>
    (await q(sql`SELECT risk_profile, risk_profile_score, to_char(risk_profile_signed_at,'YYYY-MM-DD') signed,
                        to_char(risk_profile_expires_on,'YYYY-MM-DD') stated,
                        to_char(${riskExpiresOnSql("investors")},'YYYY-MM-DD') expires, risk_profile_provisional prov
                   FROM investors WHERE id = ${id}::uuid`)).rows[0] as any;
  const upload = (investorId: string, f: Record<string, unknown>, inv: Record<string, unknown> = {}) =>
    withSystem(async (tx) => {
      const [cur] = (await tx.execute(sql`SELECT id, name, investor_category AS "investorCategory", guardian_investor_id AS "guardianInvestorId",
                                                 risk_profile_signed_at AS "riskProfileSignedAt", risk_profile_version AS "riskProfileVersion"
                                            FROM investors WHERE id = ${investorId}::uuid`)).rows as any[];
      return record(tx, {
        tenantId: tenant, userId: user, investor: { ...cur, ...inv }, today: "2026-10-15", documentKey: "tenants/x/kyc/profile.pdf",
        fields: { investorId, category: "moderate", score: 22, assessedOn: "2026-03-03", expiresOn: "2029-03-03", ...f } as any,
      });
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ recordUploadedRiskProfile: record } = await import("@/lib/risk-profile/upload"));
    ({ riskExpiresOnSql } = await import("@/lib/risk-profile/expiry"));
    ({ riskBucketSql } = await import("@/lib/risk-profile/buckets"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Risk Upload Test', 'Risk Upload Test', ${"ARN-RU-" + tenant.slice(0, 6)})`);
    await client(ids.a, "Asha Mehta");
    await client(ids.guardian, "Guardian Parent");
    await client(ids.b, "Bhavin Shah");
    await q(sql`INSERT INTO investors (id, tenant_id, name, dedup_pan, investor_category, guardian_investor_id)
                VALUES (${ids.minor}::uuid, ${tenant}::uuid, 'Minor Child', false, 'minor', ${ids.guardian}::uuid)`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["audit_log", "events_outbox", "risk_profile_responses"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("becomes the client's current profile, with its stated expiry", async () => {
    const r = await upload(ids.a, {});
    expect(r.becameCurrent).toBe(true);
    expect(await row(ids.a)).toMatchObject({ risk_profile: "moderate", risk_profile_score: 22, signed: "2026-03-03", stated: "2029-03-03", expires: "2029-03-03", prov: false });
    // And it is in the history, as evidence from a physical form.
    const h = (await q(sql`SELECT verification_method, basis, document_url, next_review_at::text nr FROM risk_profile_responses WHERE investor_id = ${ids.a}::uuid`)).rows as any[];
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ verification_method: "client_physical", basis: "uploaded", document_url: "tenants/x/kyc/profile.pdf", nr: "2029-03-03" });
  });

  it("an older profile uploaded later is kept in the history only", async () => {
    const r = await upload(ids.a, { category: "aggressive", score: 35, assessedOn: "2025-01-10", expiresOn: "2026-01-10" });
    expect(r.becameCurrent).toBe(false);
    expect(r.alreadyExpired).toBe(true);
    expect(await row(ids.a)).toMatchObject({ risk_profile: "moderate", signed: "2026-03-03", expires: "2029-03-03" });
  });

  it("a newer signed date recorded by anything else puts the one-year rule back", async () => {
    await q(sql`UPDATE investors SET risk_profile_signed_at = '2026-09-01T12:00:00Z' WHERE id = ${ids.a}::uuid`);
    expect(await row(ids.a)).toMatchObject({ signed: "2026-09-01", stated: "2029-03-03", expires: "2027-09-01" });
  });

  it("the Risk Profiles tabs follow the stated expiry", async () => {
    await upload(ids.b, { assessedOn: "2026-10-01", expiresOn: "2026-10-30" }); // lapses in 15 days (today 2026-10-15 is the test's clock only for validation)
    const bucket = async (id: string) =>
      (await q(sql`SELECT CASE WHEN ${riskBucketSql("current")} THEN 'current' WHEN ${riskBucketSql("due")} THEN 'due' WHEN ${riskBucketSql("expired")} THEN 'expired' ELSE 'other' END b
                     FROM investors i WHERE i.id = ${id}::uuid`)).rows[0] as any;
    // Stated expiry 3 years out → current; set explicit dates relative to the DB clock for the others.
    await q(sql`UPDATE investors SET risk_profile_signed_at = now() - interval '2 months', risk_profile_expiry_for = now() - interval '2 months', risk_profile_expires_on = (CURRENT_DATE + 20) WHERE id = ${ids.b}::uuid`);
    expect((await bucket(ids.b)).b).toBe("due");
    await q(sql`UPDATE investors SET risk_profile_expires_on = (CURRENT_DATE - 1) WHERE id = ${ids.b}::uuid`);
    expect((await bucket(ids.b)).b).toBe("expired");
    await q(sql`UPDATE investors SET risk_profile_expires_on = (CURRENT_DATE + 400) WHERE id = ${ids.b}::uuid`);
    expect((await bucket(ids.b)).b).toBe("current");
  });

  it("a minor's upload is the MINOR'S OWN assessment (G-1): recorded on the minor with a verified guardian; the guardian's upload never becomes it", async () => {
    const { suitabilityProfile } = await import("@/lib/risk-profile/own-assessment");
    const r = await upload(ids.minor, { assessedOn: "2026-03-03", expiresOn: "2029-03-03", category: "moderate", score: 22 });
    expect(r.becameCurrent).toBe(true);
    const h = (await q(sql`SELECT final_category, next_review_at::text nr, basis, verification_method, rm_remarks FROM risk_profile_responses WHERE investor_id = ${ids.minor}::uuid`)).rows as any[];
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ final_category: "moderate", nr: "2029-03-03", basis: "uploaded", verification_method: "client_physical" });
    expect(h[0].rm_remarks).toMatch(/minor's own account/);
    // The guardian's own upload: 0234 / 0236 still copy it onto the minor's ROW,
    // but the minor's suitability is the minor's own assessment and its expiry.
    await upload(ids.guardian, { assessedOn: "2026-04-01", expiresOn: "2028-04-01", category: "aggressive", score: 33 });
    expect(await row(ids.minor)).toMatchObject({ risk_profile: "aggressive" }); // the copy, which no reader uses
    const own = await withSystem((tx) => suitabilityProfile(tx, tenant, ids.minor));
    expect(own).toMatchObject({ category: "moderate", score: 22, expiresOn: "2029-03-03", inheritedIgnored: true });
    // No guardian on record: refused (the guardian must be verified first), nothing written.
    const orphan = randomUUID();
    await q(sql`INSERT INTO investors (id, tenant_id, name, dedup_pan, investor_category, is_minor) VALUES (${orphan}::uuid, ${tenant}::uuid, 'Unlinked Child', false, 'minor', true)`);
    await expect(upload(orphan, {})).rejects.toMatchObject({ status: 409 });
    expect(((await q(sql`SELECT count(*)::int n FROM risk_profile_responses WHERE investor_id = ${orphan}::uuid`)).rows[0] as any).n).toBe(0);
  });

  it("bad dates are refused and nothing is written", async () => {
    await expect(upload(ids.a, { assessedOn: "2026-12-01", expiresOn: "2027-12-01" })).rejects.toMatchObject({ status: 400 });
    await expect(upload(ids.a, { assessedOn: "2026-03-03", expiresOn: "2026-03-03" })).rejects.toMatchObject({ status: 400 });
    const n = (await q(sql`SELECT count(*)::int n FROM risk_profile_responses WHERE investor_id = ${ids.a}::uuid`)).rows[0] as any;
    expect(n.n).toBe(2); // the two good uploads above
  });
});
