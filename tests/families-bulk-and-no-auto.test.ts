/**
 * Families: "Update a field" on many families, and the per-firm switch that stops
 * the CRM making families on its own (Shah Financial Services, 2026-11-23).
 *
 * Pure part: the field registry and the switch rule. DB part (TEST_DATABASE_URL):
 * the bulk update's rules and the RTA import leaving families alone when the
 * firm switched them off.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoFamiliesAllowedFor, NO_AUTO_FAMILIES_FLAG } from "@/lib/families/auto";
import { FAMILY_BULK_FIELDS, FAMILY_BULK_FIELD_BY_KEY, FAMILY_BULK_GROUPS, FAMILY_BULK_MAX } from "@/lib/families/bulk-fields";
import { FEATURE_FLAGS } from "@/config/feature-flags";
import type { RtaFolioRecord } from "@/lib/rta/types";

describe("autoFamiliesAllowedFor", () => {
  it("allows automatic families unless the firm's flag is exactly true", () => {
    expect(autoFamiliesAllowedFor({})).toBe(true);
    expect(autoFamiliesAllowedFor(null)).toBe(true);
    expect(autoFamiliesAllowedFor(undefined)).toBe(true);
    expect(autoFamiliesAllowedFor({ [NO_AUTO_FAMILIES_FLAG]: false })).toBe(true);
    expect(autoFamiliesAllowedFor({ [NO_AUTO_FAMILIES_FLAG]: "true" })).toBe(true); // only a real boolean switches it off
    expect(autoFamiliesAllowedFor({ [NO_AUTO_FAMILIES_FLAG]: true })).toBe(false);
  });

  it("is a registered firm switch, off for everyone by default", () => {
    const def = (FEATURE_FLAGS as unknown as Array<{ key: string; default?: unknown }>).find((f) => f.key === NO_AUTO_FAMILIES_FLAG);
    expect(def).toBeTruthy();
    expect(def?.default ?? false).toBe(false);
  });
});

describe("the family bulk-field registry", () => {
  it("every field has a unique key, a known group and, for enums, options", () => {
    const keys = FAMILY_BULK_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FAMILY_BULK_FIELDS) {
      expect(FAMILY_BULK_GROUPS).toContain(f.group);
      if (f.kind === "enum") expect(f.options?.length).toBeGreaterThan(0);
      expect(FAMILY_BULK_FIELD_BY_KEY.get(f.key)).toBe(f);
    }
  });

  it("offers nothing that copies identity or a derived figure onto many households", () => {
    for (const bad of ["name", "familyName", "code", "head", "aum", "sip", "health", "members", "lastReview"]) {
      expect(FAMILY_BULK_FIELD_BY_KEY.has(bad)).toBe(false);
    }
  });

  it("a tag cannot be cleared, and one request is capped", () => {
    expect(FAMILY_BULK_FIELD_BY_KEY.get("tagAdd")?.nullable).toBe(false);
    expect(FAMILY_BULK_FIELD_BY_KEY.get("tagRemove")?.nullable).toBe(false);
    expect(FAMILY_BULK_MAX).toBe(2000);
  });
});

describe("migration 0283 switches automatic families off for ARN 173086 only", () => {
  const sqlText = readFileSync(join(__dirname, "../drizzle/migrations/0283_no_auto_families_shah.sql"), "utf8");
  it("names the flag and the ARN, and sets the platform-admin context the RLS needs", () => {
    expect(sqlText).toContain(`"${NO_AUTO_FAMILIES_FLAG}": true`);
    expect(sqlText).toContain("173086");
    expect(sqlText).toContain("app.is_platform_admin");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("Families bulk update + no automatic families (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let applyFamilyBulkField: typeof import("@/lib/families/bulk-update").applyFamilyBulkField;
  let FamilyBulkError: typeof import("@/lib/families/bulk-update").FamilyBulkError;
  let importRtaFolios: typeof import("@/lib/rta/import").importRtaFolios;

  const tenant = randomUUID();
  const other = randomUUID();
  const manual = randomUUID(); // a firm that keeps families by hand
  const actor = randomUUID();
  const rmA = randomUUID();
  const f1 = randomUUID();
  const f2 = randomUUID();
  const foreign = randomUUID();
  const head1 = randomUUID();
  const mem1 = randomUUID();
  const pkg = randomUUID();

  const q = async <T = any>(t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem(async (tx) => (await tx.execute(t)).rows as T[]);
  const bulk = (field: string, value: unknown, ids = [f1, f2], tenantId = tenant) =>
    withSystem((tx) => applyFamilyBulkField(tx, { tenantId, actorUserId: actor, ids, field, value }));
  const fam = async (id: string) =>
    (await q<any>(sql`SELECT family_category, notes, tags, rm_id, review_frequency, to_char(next_review_at,'YYYY-MM-DD') AS nr FROM families WHERE id = ${id}::uuid`))[0];

  const rec = (pan: string, name: string, folio: string, extra: Partial<RtaFolioRecord["investor"]> = {}): RtaFolioRecord =>
    ({
      rta: "cams", folioNumber: folio, amcCode: "P", amcName: "ICICI Prudential",
      investor: { pan, name, category: "individual", ...extra },
      nominees: [], bank: {},
      schemes: [{ schemeCode: "P1746", schemeName: "Test Fund", units: 10, nav: 100, value: 1000 }],
      aum: 1000,
    }) as unknown as RtaFolioRecord;
  const minorFile = (suffix: string): RtaFolioRecord[] => [
    rec(`GU${suffix}A1111A`.slice(0, 10), "Guardian Person", `G-${suffix}`),
    rec("", "Little Minor", `M-${suffix}`, { category: "minor", isMinor: true, guardianPan: `GU${suffix}A1111A`.slice(0, 10), guardianName: "Guardian Person" }),
  ];
  const familiesOf = async (t: string) => Number((await q<{ n: string }>(sql`SELECT count(*) AS n FROM families WHERE tenant_id = ${t}::uuid`))[0].n);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ applyFamilyBulkField, FamilyBulkError } = await import("@/lib/families/bulk-update"));
    ({ importRtaFolios } = await import("@/lib/rta/import"));

    for (const [id, tag] of [[tenant, "FB"], [other, "FO"], [manual, "FM"]] as const) {
      await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, ${tag}, ${tag}, ${"ARN-" + tag + "-" + id.slice(0, 6)})`);
    }
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rmA}::uuid, ${tenant}::uuid, ${"rm-" + rmA + "@x.in"}, 'RM A', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO families (id, tenant_id, head_name, family_category, tags) VALUES
      (${f1}::uuid, ${tenant}::uuid, 'One Family', 'Retail', '["old"]'::jsonb),
      (${f2}::uuid, ${tenant}::uuid, 'Two Family', 'HNI', '[]'::jsonb)`);
    await q(sql`INSERT INTO families (id, tenant_id, head_name, family_category) VALUES (${foreign}::uuid, ${other}::uuid, 'Foreign Family', 'Retail')`);
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, family_id) VALUES
      (${head1}::uuid, ${tenant}::uuid, 'Head One', 'HHHHH1111H', true, ${f1}::uuid),
      (${mem1}::uuid, ${tenant}::uuid, 'Member One', 'MMMMM1111M', true, ${f1}::uuid)`);
    await q(sql`UPDATE families SET primary_investor_id = ${head1}::uuid WHERE id = ${f1}::uuid`);

    // The firm that switched automatic families off.
    await q(sql`INSERT INTO packages (id, key, name) VALUES (${pkg}::uuid, ${"pk-" + pkg.slice(0, 6)}, 'Pk')`);
    await q(sql`INSERT INTO subscriptions (tenant_id, package_id, package_key, status, feature_flags_override)
                VALUES (${manual}::uuid, ${pkg}::uuid, ${"pk-" + pkg.slice(0, 6)}, 'active', ${JSON.stringify({ [NO_AUTO_FAMILIES_FLAG]: true })}::jsonb)`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["audit_log", "folios", "transactions", "sips"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id IN (${tenant}::uuid, ${other}::uuid, ${manual}::uuid)`).catch(() => {});
    }
    await q(sql`UPDATE investors SET family_id = NULL, guardian_investor_id = NULL WHERE tenant_id IN (${tenant}::uuid, ${other}::uuid, ${manual}::uuid)`).catch(() => {});
    for (const t of ["families", "investors", "users", "subscriptions"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id IN (${tenant}::uuid, ${other}::uuid, ${manual}::uuid)`).catch(() => {});
    }
    await q(sql`DELETE FROM packages WHERE id = ${pkg}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id IN (${tenant}::uuid, ${other}::uuid, ${manual}::uuid)`).catch(() => {});
  });

  it("sets a category on every family, counts the one that already had it as unchanged, writes one audit row each", async () => {
    const r = await bulk("category", "HNI");
    expect(r).toMatchObject({ updated: 1, unchanged: 1, value: "HNI" });
    expect((await fam(f1)).family_category).toBe("HNI");
    const audit = await q(sql`SELECT entity_id FROM audit_log WHERE tenant_id = ${tenant}::uuid AND action = 'family.bulk_field'`);
    expect(audit.map((a: any) => a.entity_id)).toEqual([f1]); // the no-op wrote nothing
  });

  it("another firm's family id is never touched, even when sent", async () => {
    const r = await bulk("category", "NRI", [f2, foreign]);
    expect(r.updated).toBe(1);
    expect((await fam(foreign)).family_category).toBe("Retail");
  });

  it("adds a tag once, removes it, and notes replace", async () => {
    expect((await bulk("tagAdd", "vip")).updated).toBe(2);
    expect((await bulk("tagAdd", "vip")).updated).toBe(0); // already there
    expect((await fam(f1)).tags).toEqual(["old", "vip"]);
    expect((await bulk("tagRemove", "old")).updated).toBe(1);
    expect((await fam(f1)).tags).toEqual(["vip"]);
    await bulk("notes", "Review in March");
    expect((await fam(f2)).notes).toBe("Review in March");
    await bulk("notes", null);
    expect((await fam(f2)).notes).toBeNull();
  });

  it("refuses what the form would: an unknown field, a bad enum, a tag left blank, a stranger as RM, a date that is not one", async () => {
    await expect(bulk("name", "x")).rejects.toBeInstanceOf(FamilyBulkError);
    await expect(bulk("category", "Platinum")).rejects.toBeInstanceOf(FamilyBulkError);
    await expect(bulk("tagAdd", "")).rejects.toBeInstanceOf(FamilyBulkError);
    await expect(bulk("tagAdd", null)).rejects.toBeInstanceOf(FamilyBulkError);
    await expect(bulk("rm", randomUUID())).rejects.toBeInstanceOf(FamilyBulkError);
    await expect(bulk("nextReview", "someday")).rejects.toBeInstanceOf(FamilyBulkError);
  });

  it("the RM moves the whole family — head and members — as editing it alone does", async () => {
    const r = await bulk("rm", rmA, [f1]);
    expect(r.updated).toBe(1);
    expect((await fam(f1)).rm_id).toBe(rmA);
    const rms = await q<{ rm_id: string | null }>(sql`SELECT rm_id FROM investors WHERE family_id = ${f1}::uuid`);
    expect(rms.every((m) => m.rm_id === rmA)).toBe(true);
    // Clearing removes only the family's own RM.
    await bulk("rm", null, [f1]);
    expect((await fam(f1)).rm_id).toBeNull();
    expect((await q<{ rm_id: string | null }>(sql`SELECT rm_id FROM investors WHERE id = ${head1}::uuid`))[0].rm_id).toBe(rmA);
  });

  it("a review frequency works the next review out again and reaches the members", async () => {
    const r = await bulk("reviewFrequency", "quarterly", [f1]);
    expect(r.updated).toBe(1);
    const f = await fam(f1);
    expect(f.review_frequency).toBe("quarterly");
    expect(f.nr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const m = await q<{ review_frequency: string | null }>(sql`SELECT review_frequency FROM investors WHERE id = ${mem1}::uuid`);
    expect(m[0].review_frequency).toBe("quarterly");
  });

  it("an RTA import creates the household family for a minor's guardian when the firm has not switched it off", async () => {
    const before = await familiesOf(tenant);
    await withSystem((tx) => importRtaFolios(tx, tenant, minorFile("A1"), { kind: "master" }));
    expect(await familiesOf(tenant)).toBe(before + 1);
  });

  it("…and creates none for the firm that has, while still linking the minor to the guardian", async () => {
    await withSystem((tx) => importRtaFolios(tx, manual, minorFile("B2"), { kind: "master" }));
    expect(await familiesOf(manual)).toBe(0);
    const minors = await q<{ guardian_investor_id: string | null; family_id: string | null }>(
      sql`SELECT guardian_investor_id, family_id FROM investors WHERE tenant_id = ${manual}::uuid AND is_minor`,
    );
    expect(minors).toHaveLength(1);
    expect(minors[0].guardian_investor_id).not.toBeNull();
    expect(minors[0].family_id).toBeNull();
  });

  it("migration 0283 sets the flag on the firm with that ARN and on no other", async () => {
    const shah = randomUUID();
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${shah}::uuid, 'Shah T', 'Shah T', ${"ARN-173086-" + shah.slice(0, 4)})`);
    await q(sql`INSERT INTO subscriptions (tenant_id, package_id, package_key, status) VALUES (${shah}::uuid, ${pkg}::uuid, 'x', 'active')`);
    try {
      const migration = readFileSync(join(__dirname, "../drizzle/migrations/0283_no_auto_families_shah.sql"), "utf8");
      await withSystem(async (tx) => {
        await tx.execute(sql.raw(migration));
      });
      const flags = await q<{ tenant_id: string; f: any }>(sql`SELECT tenant_id, feature_flags_override AS f FROM subscriptions WHERE tenant_id IN (${shah}::uuid, ${tenant}::uuid)`);
      expect(flags.find((r) => r.tenant_id === shah)?.f?.[NO_AUTO_FAMILIES_FLAG]).toBe(true);
      expect(flags.find((r) => r.tenant_id === tenant)).toBeUndefined();
    } finally {
      await q(sql`DELETE FROM subscriptions WHERE tenant_id = ${shah}::uuid`).catch(() => {});
      await q(sql`DELETE FROM tenants WHERE id = ${shah}::uuid`).catch(() => {});
    }
  });
});
