/** A minor needs no risk profile of their own (the firm's rule of 2026-10-30) — and nobody else is let off. */
import { describe, expect, it } from "vitest";
import { isMinorClient } from "@/lib/investors/type-rules";

describe("isMinorClient", () => {
  it("is true for the minor type, or when is_minor is set", () => {
    expect(isMinorClient({ investorCategory: "minor" })).toBe(true);
    expect(isMinorClient({ investorCategory: "individual", isMinor: true })).toBe(true);
  });

  it("is false for every other type, and for a record with nothing said", () => {
    for (const t of ["individual", "nri", "huf", "company", "llp", "partnership", "trust", "society", "sole_proprietor", "other", "corporate"]) {
      expect(isMinorClient({ investorCategory: t, isMinor: false })).toBe(false);
      expect(isMinorClient({ investorCategory: t })).toBe(false);
    }
    expect(isMinorClient({})).toBe(false);
    expect(isMinorClient({ investorCategory: null, isMinor: null })).toBe(false);
  });
});
