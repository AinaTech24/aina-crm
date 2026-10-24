import { describe, expect, it } from "vitest";
import {
  TypeDetailsSchema, canNominate, cleanTypeDetails, clientTypeFromTaxStatus, clientTypeOptions,
  hasPersonalDetails, majorityDate, singleHoldingOnly,
  ALL_TAX_STATUSES, defaultHouseholdType, defaultTaxStatus, taxStatusOptions, withCurrent,
} from "@/lib/investors/client-types";

describe("client types — who may nominate", () => {
  it("only individual holders nominate", () => {
    for (const t of ["individual", "nri", "sole_proprietor", "other"]) expect(canNominate(t)).toBe(true);
    for (const t of ["minor", "huf", "company", "corporate", "llp", "partnership", "trust", "aop_boi"]) expect(canNominate(t)).toBe(false);
  });

  it("everyone but an individual holds singly; only people have personal details", () => {
    expect(singleHoldingOnly("individual")).toBe(false);
    expect(singleHoldingOnly("minor")).toBe(true);
    expect(singleHoldingOnly("huf")).toBe(true);
    expect(singleHoldingOnly("trust")).toBe(true);
    expect(hasPersonalDetails("minor")).toBe(true);
    expect(hasPersonalDetails("huf")).toBe(false);
    expect(hasPersonalDetails("company")).toBe(false);
  });

  it("offers the legacy Corporate type only to a record that already has it", () => {
    expect(clientTypeOptions().some((o) => o.value === "corporate")).toBe(false);
    expect(clientTypeOptions("corporate").some((o) => o.value === "corporate")).toBe(true);
  });
});

describe("client types — the registrar's tax status", () => {
  it.each([
    ["Resident Individual", "individual"],
    ["NRI - Repatriable (NRE)", "nri"],
    ["NON RESIDENT INDIVIDUAL", "nri"],
    ["On behalf of Minor", "minor"],
    ["NRI - Minor", "minor"],
    ["HINDU UNDIVIDED FAMILY", "huf"],
    ["HUF", "huf"],
    ["Partnership Firm", "partnership"],
    ["Limited Liability Partnership", "llp"],
    ["LLP", "llp"],
    ["Sole Proprietorship", "sole_proprietor"],
    ["Private Limited Company", "company"],
    ["Body Corporate", "company"],
    ["Trust", "trust"],
    ["Society", "aop_boi"],
    ["AOP / BOI", "aop_boi"],
    ["", "individual"],
  ])("%s → %s", (text, type) => {
    expect(clientTypeFromTaxStatus(text)).toBe(type);
  });
});

describe("client types — a minor turns 18", () => {
  it("adds eighteen years", () => {
    expect(majorityDate("2010-06-15")).toBe("2028-06-15");
  });
  it("29 February lands on 1 March in a non-leap year", () => {
    expect(majorityDate("2008-02-29")).toBe("2026-03-01");
    expect(majorityDate("2012-02-29")).toBe("2030-03-01");
  });
  it("needs a date of birth", () => {
    expect(majorityDate("")).toBeNull();
    expect(majorityDate(null)).toBeNull();
  });
});

describe("client types — details follow the type", () => {
  const all = {
    guardian: { name: "Ravi Shah", pan: "ABCDE1234F", relation: "father" as const },
    karta: { name: "Mahesh Shah" },
    coparceners: [{ name: "Anil Shah", relation: "Son" }, { name: "  " }],
    entity: { formedOn: "2001-04-01", registrationNo: "U12345MH2001PTC000001", netWorth: "" as const },
    signatories: [{ name: "Director One", pan: "" as const }],
    ubos: [{ name: "Owner One", holdingPct: 60 }],
    nri: { countryOfResidence: "UAE", accountType: "nre" as const },
    businessName: "Shah Traders",
    nominationOptOut: true,
  };

  it("a minor keeps only the guardian", () => {
    expect(cleanTypeDetails("minor", all)).toEqual({ guardian: { name: "Ravi Shah", pan: "ABCDE1234F", relation: "father" } });
  });
  it("an HUF keeps the Karta, the coparceners with a name, and its formation date", () => {
    expect(cleanTypeDetails("huf", all)).toEqual({
      karta: { name: "Mahesh Shah" },
      coparceners: [{ name: "Anil Shah", relation: "Son" }],
      entity: { formedOn: "2001-04-01" },
    });
  });
  it("an entity keeps incorporation, signatories and owners — blanks dropped", () => {
    expect(cleanTypeDetails("partnership", all)).toEqual({
      entity: { formedOn: "2001-04-01", registrationNo: "U12345MH2001PTC000001" },
      signatories: [{ name: "Director One" }],
      ubos: [{ name: "Owner One", holdingPct: 60 }],
    });
  });
  it("an NRI keeps overseas details and its nomination opt-out", () => {
    expect(cleanTypeDetails("nri", all)).toEqual({ nri: { countryOfResidence: "UAE", accountType: "nre" }, nominationOptOut: true });
  });
  it("a sole proprietorship keeps its business name", () => {
    expect(cleanTypeDetails("sole_proprietor", all)).toEqual({ businessName: "Shah Traders", nominationOptOut: true });
  });
  it("rejects a malformed guardian PAN", () => {
    expect(TypeDetailsSchema.safeParse({ guardian: { pan: "ABC123" } }).success).toBe(false);
    expect(TypeDetailsSchema.safeParse({ guardian: { pan: "abcde1234f" } }).success).toBe(true);
  });
});

describe("client types — dropdowns follow the type", () => {
  it("offers the tax statuses that fit the type, all of them for Other", () => {
    expect(taxStatusOptions("huf")).toEqual(["HUF"]);
    expect(taxStatusOptions("minor")).toContain("On behalf of minor");
    expect(taxStatusOptions("other")).toEqual(ALL_TAX_STATUSES);
    expect(defaultTaxStatus("individual")).toBe("Resident Individual");
    expect(defaultTaxStatus("other")).toBe("");
  });

  it("every status a type offers maps back to a type of the same kind", () => {
    for (const t of ["individual", "nri", "minor", "sole_proprietor", "huf", "company", "llp", "partnership", "trust", "aop_boi"]) {
      for (const s of taxStatusOptions(t)) {
        const back = clientTypeFromTaxStatus(s);
        // Company and Corporate share a list; every other type maps to itself.
        expect(back, `${t}: ${s}`).toBe(t);
      }
    }
  });

  it("offers the registrar statuses for institutions, funds and foreign investors", () => {
    expect(taxStatusOptions("company")).toEqual(expect.arrayContaining(["Bank", "Insurance Company", "Mutual Fund", "Foreign Portfolio Investor (FPI)"]));
    expect(taxStatusOptions("trust")).toEqual(expect.arrayContaining(["Provident Fund", "Pension Fund"]));
    expect(taxStatusOptions("nri")).toEqual(expect.arrayContaining(["NRI – Others", "Person of Indian Origin (PIO)"]));
    expect(ALL_TAX_STATUSES).toContain("Others");
  });

  it("derives the household type from the type and the family", () => {
    expect(defaultHouseholdType("huf", false)).toBe("HUF");
    expect(defaultHouseholdType("llp", true)).toBe("Company");
    expect(defaultHouseholdType("individual", true)).toBe("Family");
    expect(defaultHouseholdType("minor", false)).toBe("Individual");
  });

  it("keeps a value on file that the list lacks", () => {
    expect(withCurrent(["A", "B"], "Z")).toEqual(["A", "B", "Z"]);
    expect(withCurrent(["A", "B"], "A")).toEqual(["A", "B"]);
    expect(withCurrent(["A", "B"], "")).toEqual(["A", "B"]);
  });
});
