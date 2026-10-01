/**
 * A review meeting with one family member reviews the whole family.
 *
 * MFDs serve households: one sitting covers the father's portfolio, the
 * spouse's SIPs and the child's goal plan. The CRM only ever stamped the one
 * client the meeting row pointed at, so every other member stayed "review
 * overdue" and the only way to clear the list was a fake meeting each.
 *
 * What is guarded here is mostly what must NOT happen — the propagation is
 * easy, the restraint is the part a later change could quietly break.
 *
 * Needs a migrated Postgres: set TEST_DATABASE_URL (CI sets it after
 * migrate:all). Skipped otherwise so the suite stays green on a laptop.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("review propagates across the family", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let schema: typeof import("@/db/schema");
  let eq: typeof import("drizzle-orm").eq;
  let propagateReviewToFamily: typeof import("@/lib/reviews/family-propagation").propagateReviewToFamily;
  let familyMembersFor: typeof import("@/lib/reviews/family-propagation").familyMembersFor;

  const tenant = randomUUID();
  const family = randomUUID();
  const father = randomUUID();   // quarterly — the one actually met
  const spouse = randomUUID();   // annual
  const child = randomUUID();    // no cadence configured
  const gone = randomUUID();     // soft-deleted member
  const solo = randomUUID();     // no family at all

  const REVIEWED = new Date("2026-07-01T00:00:00Z");
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  const load = async (id: string) =>
    withSystem(async (tx) => {
      const [r] = await tx
        .select({
          lastReviewAt: schema.investors.lastReviewAt,
          nextReviewAt: schema.investors.nextReviewAt,
          lastContactAt: schema.investors.lastContactAt,
        })
        .from(schema.investors)
        .where(eq(schema.investors.id, id));
      return r;
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ eq } = await import("drizzle-orm"));
    ({ propagateReviewToFamily, familyMembersFor } = await import("@/lib/reviews/family-propagation"));

    const base = {
      tenantId: tenant,
      lastReviewAt: new Date("2026-01-01T00:00:00Z"),
      nextReviewAt: new Date("2026-04-01T00:00:00Z"),
      lastContactAt: new Date("2026-01-01T00:00:00Z"),
    };
    await withSystem(async (tx) => {
      await tx.insert(schema.tenants).values({
        id: tenant, legalName: "Fam Test", displayName: "Fam Test", arn: `ARN-FT-${tenant.slice(0, 6)}`,
      } as any);
      await tx.insert(schema.families).values({ id: family, tenantId: tenant, headName: "Sharma Family" } as any);
      await tx.insert(schema.investors).values([
        { ...base, id: father, name: "Ramesh Sharma", familyId: family, reviewFrequency: "quarterly" },
        { ...base, id: spouse, name: "Sunita Sharma", familyId: family, reviewFrequency: "annual" },
        { ...base, id: child, name: "Aarav Sharma", familyId: family },
        { ...base, id: gone, name: "Gone Sharma", familyId: family, deletedAt: new Date() },
        { ...base, id: solo, name: "No Family" },
      ] as any);
    });
  });

  afterAll(async () => {
    try {
      await withSystem(async (tx) => {
        for (const id of [father, spouse, child, gone, solo]) {
          await tx.delete(schema.investors).where(eq(schema.investors.id, id));
        }
        await tx.delete(schema.families).where(eq(schema.families.id, family));
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant));
      });
    } catch {
      /* best effort */
    }
  });

  it("previews the household without the attendee or deleted members", async () => {
    const seen = await withSystem((tx) => familyMembersFor(tx, tenant, father));
    expect(seen.familyId).toBe(family);
    expect(seen.others.map((o) => o.name).sort()).toEqual(["Aarav Sharma", "Sunita Sharma"]);
  });

  it("stamps the review on the rest of the family, each on their OWN cadence", async () => {
    const res = await withSystem((tx) =>
      propagateReviewToFamily(tx, { tenantId: tenant, investorId: father, reviewedAt: REVIEWED })
    );
    expect(res.updated).toBe(2);

    const s = await load(spouse);
    expect(day(s.lastReviewAt)).toBe("2026-07-01");
    expect(day(s.nextReviewAt)).toBe("2027-07-01"); // annual, not the father's quarterly

    const c = await load(child);
    expect(day(c.nextReviewAt)).toBe("2026-12-28"); // no cadence → the 180-day fallback
  });

  it("does NOT touch last_contact_at — meeting one person is not contacting all", async () => {
    // It drives dormancy. Propagating it would silence a genuine "nobody has
    // spoken to this client in a year".
    expect(day((await load(spouse)).lastContactAt)).toBe("2026-01-01");
    expect(day((await load(child)).lastContactAt)).toBe("2026-01-01");
  });

  it("leaves deleted members, the attendee and unrelated clients alone", async () => {
    expect(day((await load(gone)).lastReviewAt)).toBe("2026-01-01");
    // The caller updates the attendee; the helper must not double-handle them.
    expect(day((await load(father)).lastReviewAt)).toBe("2026-01-01");
    expect(day((await load(solo)).lastReviewAt)).toBe("2026-01-01");
  });

  it("lets an explicit next-review date from the form win for everyone", async () => {
    await withSystem((tx) =>
      propagateReviewToFamily(tx, {
        tenantId: tenant, investorId: father, reviewedAt: REVIEWED, explicitNextReview: "2026-10-15",
      })
    );
    expect(day((await load(spouse)).nextReviewAt)).toBe("2026-10-15");
    expect(day((await load(child)).nextReviewAt)).toBe("2026-10-15");
  });

  it("is a clean no-op for a client with no family", async () => {
    const res = await withSystem((tx) =>
      propagateReviewToFamily(tx, { tenantId: tenant, investorId: solo, reviewedAt: REVIEWED })
    );
    expect(res).toMatchObject({ familyId: null, updated: 0 });
  });
});
