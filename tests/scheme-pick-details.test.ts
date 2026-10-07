/**
 * What a scheme pick fills on a proposal line beyond its name: the plan
 * (lib/mf/scheme-plan) and the riskometer level (lib/mf/scheme-risk).
 */

import { describe, expect, it } from "vitest";
import { schemePlan } from "@/lib/mf/scheme-plan";
import { deriveSchemeRisk, riskometerLevel, storedSchemeRisk } from "@/lib/mf/scheme-risk";

describe("scheme plan", () => {
  it("uses the Scheme Master's own plan first", () => {
    expect(schemePlan("regular", "HDFC Small Cap Fund - Direct Plan - IDCW Option")).toBe("regular");
  });

  it("reads it from the scheme name otherwise", () => {
    expect(schemePlan(null, "HDFC Small Cap Fund - Direct Plan - IDCW Option")).toBe("direct");
    expect(schemePlan(null, "Axis Liquid Fund - Regular Plan - Growth")).toBe("regular");
    expect(schemePlan(null, "SBI Blue Chip Fund - Direct Growth")).toBe("direct");
    // The stated plan wins over the same word elsewhere in the name.
    expect(schemePlan(null, "XYZ Direct Equity Fund - Regular Plan - Growth")).toBe("regular");
  });

  it("is unknown when neither says", () => {
    expect(schemePlan(null, "Some Old Fund - Growth")).toBeNull();
    expect(schemePlan("", undefined)).toBeNull();
  });
});

describe("scheme riskometer", () => {
  it("turns the derived band into the level a proposal line stores", () => {
    const small = deriveSchemeRisk("Equity Scheme - Small Cap Fund", "HDFC Small Cap Fund - Direct Plan - IDCW Option");
    expect(riskometerLevel(small?.band)).toBe("very_high");
    expect(riskometerLevel(deriveSchemeRisk("Debt Scheme - Liquid Fund", null)?.band)).toBe("low");
    expect(riskometerLevel(deriveSchemeRisk("Debt Scheme - Ultra Short Duration Fund", null)?.band)).toBe("low_to_moderate");
    expect(riskometerLevel(deriveSchemeRisk("Hybrid Scheme - Balanced Advantage", null)?.band)).toBe("moderately_high");
    expect(riskometerLevel(undefined)).toBeUndefined();
  });

  it("prefers the Risk the firm set on its Scheme Master", () => {
    expect(storedSchemeRisk("high")).toMatchObject({ band: 5, label: "High" });
    expect(storedSchemeRisk("very_low")?.band).toBe(1);
    expect(storedSchemeRisk("Moderately High")?.band).toBe(4);
    expect(riskometerLevel(storedSchemeRisk("moderate")?.band)).toBe("moderate");
    expect(storedSchemeRisk(null)).toBeNull();
    expect(storedSchemeRisk("unknown")).toBeNull();
  });
});
