/**
 * Creating a family: the automatic code (lib/families/code), the name taken
 * from the head (lib/families/naming) and the details taken from the head's
 * client record (lib/families/from-head).
 */

import { describe, expect, it } from "vitest";
import { familyCodeNumber, formatFamilyCode } from "@/lib/families/code";
import { familyNameForHead, looksLikeHousehold } from "@/lib/families/naming";
import { familyDetailsFromHead, type FamilyHead } from "@/lib/families/from-head";

describe("family code", () => {
  it("numbers FAM-0001 upwards and grows past four digits", () => {
    expect(formatFamilyCode(1)).toBe("FAM-0001");
    expect(formatFamilyCode(42)).toBe("FAM-0042");
    expect(formatFamilyCode(12345)).toBe("FAM-12345");
  });

  it("reads back only its own shape", () => {
    expect(familyCodeNumber("FAM-0042")).toBe(42);
    expect(familyCodeNumber(" fam-7 ")).toBe(7);
    expect(familyCodeNumber("PATEL-001")).toBeNull();
    expect(familyCodeNumber("FAM-")).toBeNull();
    expect(familyCodeNumber(null)).toBeNull();
  });
});

describe("family name from the head", () => {
  it("wraps a person's name in the firm's pattern", () => {
    expect(familyNameForHead("Adesh Manocha")).toBe("Adesh Manocha Family");
    expect(familyNameForHead("  Adesh   Manocha ", "{head}")).toBe("Adesh Manocha");
    expect(familyNameForHead("Patel", "The {head} Household")).toBe("The Patel Household");
  });

  it("keeps a name that already reads as a household", () => {
    expect(looksLikeHousehold("Sharma Trust")).toBe(true);
    expect(familyNameForHead("Adesh Manocha Family")).toBe("Adesh Manocha Family");
    expect(familyNameForHead("Ramesh Gupta HUF")).toBe("Ramesh Gupta HUF");
  });

  it("falls back when the pattern leaves nothing", () => {
    expect(familyNameForHead("Patel", "")).toBe("Patel Family");
    expect(familyNameForHead("   ")).toBe("");
  });
});

describe("details from the head", () => {
  const now = new Date("2026-10-02T06:00:00Z");
  const creator = { userId: "creator", branchId: "creator-branch" };
  const head: FamilyHead = {
    rmId: "head-rm",
    branchId: "head-branch",
    segmentTag: "HNI",
    reviewFrequency: "quarterly",
    nextReviewAt: new Date("2026-11-15T04:30:00Z"),
  };

  it("takes the head's RM, branch, category and review schedule", () => {
    const d = familyDetailsFromHead({ head, explicit: {}, creator, firmReviewFrequency: "annual", now });
    expect(d).toMatchObject({
      rmId: "head-rm",
      branchId: "head-branch",
      familyCategory: "HNI",
      reviewFrequency: "quarterly",
      firstMeetingDate: null,
    });
    expect(d.nextReviewAt?.toISOString()).toBe("2026-11-15T04:30:00.000Z");
  });

  it("fills what the head lacks from the creator and the firm", () => {
    const bare: FamilyHead = { rmId: null, branchId: null, segmentTag: null, reviewFrequency: null, nextReviewAt: null };
    const d = familyDetailsFromHead({ head: bare, explicit: {}, creator, firmReviewFrequency: "annual", now });
    expect(d).toMatchObject({ rmId: "creator", branchId: "creator-branch", familyCategory: null, reviewFrequency: "annual" });
    // One cadence from today.
    expect(d.nextReviewAt?.toISOString().slice(0, 10)).toBe("2027-10-02");
  });

  it("gives a family with no head what an empty form always gave it", () => {
    const d = familyDetailsFromHead({ head: null, explicit: {}, creator, firmReviewFrequency: null, now });
    expect(d).toMatchObject({ rmId: "creator", branchId: "creator-branch", familyCategory: null, reviewFrequency: null, nextReviewAt: null });
  });

  it("lets an explicit value from an API caller win", () => {
    const d = familyDetailsFromHead({
      head,
      explicit: { rmId: "chosen-rm", familyCategory: "NRI", reviewFrequency: "monthly", firstMeetingDate: "2026-10-20" },
      creator,
      firmReviewFrequency: "annual",
      now,
    });
    expect(d).toMatchObject({ rmId: "chosen-rm", familyCategory: "NRI", reviewFrequency: "monthly", firstMeetingDate: "2026-10-20" });
    // An explicit schedule is computed as asked, not copied from the head.
    expect(d.nextReviewAt?.toISOString().slice(0, 10)).toBe("2026-10-20");
  });
});
