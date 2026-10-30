/** The premium typed is one payment at the chosen frequency; the stored one is annual. */
import { describe, expect, it } from "vitest";
import { annualFrom, eachPeriod, installmentOf, premiumFieldLabel } from "@/lib/insurance/premium";

describe("insurance premium", () => {
  it("a 10,000 premium paid each time becomes the annual figure", () => {
    expect(annualFrom(10000, "monthly")).toBe(120000);
    expect(annualFrom(10000, "quarterly")).toBe(40000);
    expect(annualFrom(10000, "semi_annual")).toBe(20000);
    expect(annualFrom(10000, "annual")).toBe(10000);
    expect(annualFrom(10000, "single")).toBe(10000);
  });

  it("reads back to exactly what was typed", () => {
    for (const f of ["monthly", "quarterly", "semi_annual", "annual", "single"]) {
      expect(installmentOf(annualFrom(10000, f), f)).toBe(10000);
    }
    expect(installmentOf(annualFrom(833.33, "monthly"), "monthly")).toBe(833.33);
  });

  it("an unknown or missing frequency counts as annual", () => {
    expect(annualFrom(500, null)).toBe(500);
    expect(annualFrom(500, "weird")).toBe(500);
  });

  it("names what each field asks for", () => {
    expect(premiumFieldLabel("quarterly")).toMatch(/each quarter/);
    expect(premiumFieldLabel("annual")).toMatch(/Annual/);
    expect(eachPeriod("monthly")).toBe("every month");
    expect(eachPeriod("annual")).toBeNull();
    expect(eachPeriod("single")).toBeNull();
  });
});
