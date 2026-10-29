import { describe, expect, it } from "vitest";
import { unclassifiedSchemes } from "@/lib/comms/client-links";

describe("naming the schemes that cannot be classified", () => {
  it("lists only valued schemes that are neither equity, hybrid nor debt, with their category", () => {
    const msg = unclassifiedSchemes([
      { aum: 14000, schemes: [
        { schemeName: "Mystery Fund A", category: "", value: 5000 },
        { schemeName: "Gold FoF", category: "Other Scheme - FoF Domestic", value: 3000 },
        { schemeName: "Known Equity Fund", category: "Equity: Large Cap", value: 9000 },
        { schemeName: "Empty Fund", category: "", value: 0 },
      ] },
    ]);
    expect(msg).toContain("Mystery Fund A (no category)");
    expect(msg).toContain("Gold FoF (category: Other Scheme - FoF Domestic)");
    expect(msg).not.toContain("Known Equity Fund");
    expect(msg).not.toContain("Empty Fund");
  });

  it("counts a folio whose schemes carry no value of their own, as the exposure maths does", () => {
    const msg = unclassifiedSchemes([
      { aum: 100000, schemes: [{ schemeName: "Fund X", category: null }, { schemeName: "Fund Y", category: null }] },
    ]);
    expect(msg).toContain("Fund X");
    expect(msg).toContain("Fund Y");
  });

  it("says nothing for a folio with no value at all", () => {
    expect(unclassifiedSchemes([{ aum: 0, schemes: [{ schemeName: "Fund X", category: null }] }])).toBeNull();
  });

  it("says nothing when every valued scheme is classified", () => {
    expect(unclassifiedSchemes([{ schemes: [{ schemeName: "X", category: "Debt: Liquid", value: 100 }] }])).toBeNull();
  });

  it("caps a long list", () => {
    const schemes = Array.from({ length: 7 }, (_, i) => ({ schemeName: `Fund ${i}`, category: null, value: 10 }));
    expect(unclassifiedSchemes([{ schemes }])).toContain("and 3 more");
  });
});
