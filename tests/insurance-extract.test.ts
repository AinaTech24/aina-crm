import { describe, expect, it } from "vitest";
import { toFreq, toPolicyType, structuredToDraft } from "@/lib/insurance/extract/to-draft";
import { cleanPolicyNumber, toIso } from "@/lib/insurance/extract/validate";
import { parseInsurancePolicy } from "@/lib/insurance/parse-policy";
import { NF } from "@/lib/insurance/extract/types";

describe("premium frequency as the document prints it", () => {
  it("half-yearly and semi-annual are semi_annual, never annual", () => {
    for (const s of ["Half Yearly", "half-yearly", "Semi Annual", "semi_annual", "Semi-Annually", "6 monthly"]) {
      expect(toFreq(s)).toBe("semi_annual");
    }
  });
  it("reads the other modes", () => {
    expect(toFreq("Quarterly")).toBe("quarterly");
    expect(toFreq("Monthly")).toBe("monthly");
    expect(toFreq("Yearly")).toBe("annual");
    expect(toFreq("Annual")).toBe("annual");
    expect(toFreq("Single Premium")).toBe("single");
    expect(toFreq("")).toBeNull();
  });
});

describe("policy type", () => {
  it("picks the specific word first", () => {
    expect(toPolicyType("Term Life Insurance", "life")).toBe("term");
    expect(toPolicyType("Critical Illness Plan", "health")).toBe("critical_illness");
    expect(toPolicyType("Unit Linked Insurance Plan", "life")).toBe("ulip");
    expect(toPolicyType("Money Back Plan", "life")).toBe("money_back");
    expect(toPolicyType("Family Floater Mediclaim", "health")).toBe("health");
    expect(toPolicyType("Private Car Package", "motor")).toBe("motor");
  });
  it("falls back to the document kind, and an empty or odd string never picks the first enum value", () => {
    expect(toPolicyType("", "life")).toBe("life_other");
    expect(toPolicyType("123", "health")).toBe("health");
    expect(toPolicyType(null, "unknown")).toBeNull();
  });
});

describe("policy number", () => {
  it("keeps the separators insurers print", () => {
    expect(cleanPolicyNumber("2805 2003 1234 5600 000")).toBe("2805 2003 1234 5600 000");
    expect(cleanPolicyNumber("P/11/2024/001234")).toBe("P/11/2024/001234");
    expect(cleanPolicyNumber("OG-24-1234-5678-0000.01")).toBe("OG-24-1234-5678-0000.01");
    expect(cleanPolicyNumber("  HD  123456789 ")).toBe("HD 123456789");
  });
  it("still refuses OCR junk", () => {
    expect(cleanPolicyNumber("Policy No: ###")).toBeNull();
    expect(cleanPolicyNumber("ABC")).toBeNull();
    expect(cleanPolicyNumber("NOTANUMBER")).toBeNull();
    expect(cleanPolicyNumber("12|34|56")).toBeNull();
  });
});

describe("dates", () => {
  it("reads the shapes a policy prints (day first)", () => {
    expect(toIso("05/03/2024")).toBe("2024-03-05");
    expect(toIso("05-03-24")).toBe("2024-03-05");
    expect(toIso("5 Mar 2024")).toBe("2024-03-05");
    expect(toIso("05-Mar-24")).toBe("2024-03-05");
    expect(toIso("5th March, 2024")).toBe("2024-03-05");
    expect(toIso("March 5, 2024")).toBe("2024-03-05");
    expect(toIso("2024-03-05")).toBe("2024-03-05");
    expect(toIso("31/02/2024")).toBeNull();
  });
});

describe("premium is filled as the document prints it", () => {
  const empty = () => ({
    policy: {
      insurer: NF(), planName: NF(), policyNumber: NF(), policyType: NF(), businessType: NF(), sumAssured: NF(),
      annualPremium: NF(), installmentPremium: NF(), premiumFrequency: NF(), commission: NF(), policyStartDate: NF(),
      policyTermYears: NF(), premiumPayingTermYears: NF(), maturityDate: NF(), renewalDate: NF(),
    },
    policyholder: {}, proposer: {}, nominee: {}, agency: {}, receipt: {}, premiumSummary: {},
    insuredMembers: [], sumInsured: [], optionalCovers: [], premiumDetails: [], exclusions: [],
    documentKind: "life", overallConfidence: 1, warnings: [],
  }) as any;
  const f = (value: any) => ({ value, confidence: 1, source: null, page: null });

  it("carries the per-payment figure through untouched", () => {
    const x = empty();
    x.policy.installmentPremium = f(2500);
    x.policy.premiumFrequency = f("Quarterly");
    const d = structuredToDraft(x);
    expect(d.installmentPremium).toBe(2500);
    expect(d.premiumFrequency).toBe("quarterly");
  });

  it("warns when the instalment and the year do not agree", () => {
    const x = empty();
    x.policy.installmentPremium = f(2500);
    x.policy.annualPremium = f(7000);
    x.policy.premiumFrequency = f("Quarterly");
    expect(structuredToDraft(x).warnings.join(" ")).toMatch(/do not match/);
    x.policy.annualPremium = f(10000);
    expect(structuredToDraft(x).warnings.join(" ")).not.toMatch(/do not match/);
  });
});

describe("the basic reader keeps an instalment apart from a year", () => {
  it("'Premium payable' is an instalment, 'Annual premium' is annual", () => {
    const a = parseInsurancePolicy("Policy No: HD123456789\nPremium Payable: Rs. 2,500\nMode: Quarterly\n");
    expect(a.installmentPremium).toBe(2500);
    expect(a.annualPremium).toBeNull();
    const b = parseInsurancePolicy("Policy No: HD123456789\nAnnual Premium: Rs. 10,000\nMode: Quarterly\n");
    expect(b.annualPremium).toBe(10000);
    expect(b.installmentPremium ?? null).toBeNull();
  });
});
