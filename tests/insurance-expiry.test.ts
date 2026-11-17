import { describe, expect, it } from "vitest";
import { expiryFromTerm } from "@/lib/insurance/term";

describe("policy expiry from start + term", () => {
  it("ends the day before the anniversary", () => {
    expect(expiryFromTerm("2026-11-17", 30)).toBe("2056-11-16");
    expect(expiryFromTerm("2026-01-01", 1)).toBe("2026-12-31");
    expect(expiryFromTerm("2026-11-17", "20")).toBe("2046-11-16");
  });
  it("handles a leap-day start and a part-year term", () => {
    expect(expiryFromTerm("2028-02-29", 1)).toBe("2029-02-28");
    expect(expiryFromTerm("2026-11-17", 1.5)).toBe("2028-05-16");
    expect(expiryFromTerm("2026-08-31", 0.5)).toBe("2027-02-27");
  });
  it("is blank until both are there", () => {
    expect(expiryFromTerm("", 30)).toBe("");
    expect(expiryFromTerm("2026-11-17", "")).toBe("");
    expect(expiryFromTerm("2026-11-17", 0)).toBe("");
  });
});
