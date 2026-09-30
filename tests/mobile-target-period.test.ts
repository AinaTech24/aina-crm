import { describe, it, expect } from "vitest";
import { targetPeriod } from "../src/lib/mobile/targets";
describe("mobile monthly targets", () => {
  it("keeps Indian fiscal years and December rollover correct", () => {
    expect(targetPeriod("2026-03")).toMatchObject({ fiscalYear: "2025-26", end: "2026-04-01" });
    expect(targetPeriod("2026-04")).toMatchObject({ fiscalYear: "2026-27" });
    expect(targetPeriod("2026-12")).toMatchObject({ end: "2027-01-01" });
  });
  it("rejects malformed or non-existent months", () => {
    for (const month of ["2026-00", "2026-13", "2026-1", "bad"]) expect(() => targetPeriod(month)).toThrow();
  });
});
