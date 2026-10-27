import { describe, expect, it } from "vitest";
import { categoryFromName } from "@/lib/investors/scheme-categories";
import { assetClassOf, assetClassExposure } from "@/lib/investors/asset-class";
import { unclassifiedSchemes } from "@/lib/comms/client-links";

describe("category from the scheme name", () => {
  it("reads the class a name states and nothing it does not", () => {
    expect(categoryFromName("HDFC Liquid Fund - Direct Plan - Growth")).toMatch(/^Debt/);
    expect(categoryFromName("Parag Parikh Flexi Cap Fund - Regular")).toMatch(/^Equity/);
    expect(categoryFromName("ICICI Prudential Balanced Advantage Fund")).toMatch(/^Hybrid/);
    expect(categoryFromName("Some Opportunities Fund")).toBeNull();
    expect(categoryFromName("")).toBeNull();
    expect(categoryFromName(null)).toBeNull();
  });

  it("gives a category the exposure maths understands", () => {
    expect(assetClassOf(categoryFromName("Axis Liquid Fund") ?? undefined)).toBe("defensive");
    expect(assetClassOf(categoryFromName("Mirae Asset Large Cap Fund") ?? undefined)).toBe("equity");
    expect(assetClassOf(categoryFromName("SBI Equity Hybrid Fund") ?? undefined)).toBe("hybrid");
  });

  it("lets a book of unknown-category schemes be classified from names", () => {
    const folios = [
      { aum: 100, schemes: [
        { category: categoryFromName("Mirae Asset Large Cap Fund") ?? undefined, value: 60 },
        { category: categoryFromName("Axis Liquid Fund") ?? undefined, value: 40 },
      ] },
    ];
    const e = assetClassExposure(folios);
    expect(Math.round(e.equityPct ?? -1)).toBe(60);
    expect(e.classifiedPct).toBe(100);
  });
});

describe("naming the schemes that cannot be classified", () => {
  it("lists only valued schemes with no usable category", () => {
    const msg = unclassifiedSchemes([
      { schemes: [
        { schemeName: "Mystery Fund A", category: "", value: 5000 },
        { schemeName: "Known Equity Fund", category: "Equity: Large Cap", value: 9000 },
        { schemeName: "Empty Fund", category: "", value: 0 },
      ] },
    ]);
    expect(msg).toContain("Mystery Fund A");
    expect(msg).not.toContain("Known Equity Fund");
    expect(msg).not.toContain("Empty Fund");
  });

  it("says nothing when every valued scheme is classified", () => {
    expect(unclassifiedSchemes([{ schemes: [{ schemeName: "X", category: "Debt: Liquid", value: 100 }] }])).toBeNull();
  });

  it("caps a long list", () => {
    const schemes = Array.from({ length: 7 }, (_, i) => ({ schemeName: `Fund ${i}`, category: null, value: 10 }));
    expect(unclassifiedSchemes([{ schemes }])).toContain("and 3 more");
  });
});
