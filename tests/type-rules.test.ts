/**
 * Every client type sees only its own fields — and is never counted as
 * "missing" one it cannot have (lib/investors/type-rules.ts).
 */
import { describe, expect, it } from "vitest";
import { needsNominee, typeHas } from "@/lib/investors/type-rules";
import { clientCompleteness } from "@/lib/investors/completeness";
import { clientHealth } from "@/lib/investors/health";

describe("needsNominee", () => {
  it("only a type that can nominate, without a nominee or an opt-out", () => {
    expect(needsNominee({ investorCategory: "individual" })).toBe(true);
    expect(needsNominee({ investorCategory: "nri", nominees: [] })).toBe(true);
    for (const t of ["minor", "huf", "company", "llp", "partnership", "trust", "aop_boi", "corporate"]) {
      expect(needsNominee({ investorCategory: t })).toBe(false);
    }
    expect(needsNominee({ investorCategory: "individual", nomineeName: "Asha" })).toBe(false);
    expect(needsNominee({ investorCategory: "individual", nominees: [{ name: "Asha" }] })).toBe(false);
    expect(needsNominee({ investorCategory: "individual", typeDetails: { nominationOptOut: true } })).toBe(false);
  });

  it("date of birth for a person or a minor; adult fields for an individual", () => {
    expect(typeHas.dob("minor")).toBe(true);
    expect(typeHas.dob("huf")).toBe(false);
    expect(typeHas.adultFields("minor")).toBe(false);
    expect(typeHas.adultFields("individual")).toBe(true);
  });
});

describe("completeness and health follow the type", () => {
  it("an HUF is not asked for gender, birthday, occupation, PAN–Aadhaar or a nominee", () => {
    const keys = clientCompleteness({ investorCategory: "huf", name: "Shah HUF" }).missing.map((m) => m.key);
    for (const k of ["dob", "gender", "occupation", "pan_aadhaar", "nominee"]) expect(keys).not.toContain(k);
    const ind = clientCompleteness({ investorCategory: "individual", name: "Asha Shah" }).missing.map((m) => m.key);
    for (const k of ["dob", "gender", "occupation", "pan_aadhaar", "nominee"]) expect(ind).toContain(k);
  });

  it("health deducts for a missing nominee or an unlinked PAN only where they apply", () => {
    const f = (t: string) => clientHealth({ investorCategory: t, panAadhaarLinkStatus: "not_linked" }).factors.map((x) => x.key);
    expect(f("company")).not.toContain("nominee");
    expect(f("company")).not.toContain("pan_aadhaar");
    expect(f("minor")).not.toContain("nominee");
    expect(f("individual")).toContain("nominee");
    expect(f("individual")).toContain("pan_aadhaar");
  });
});
