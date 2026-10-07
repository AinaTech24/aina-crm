import { describe, expect, it } from "vitest";
import { annualIncomeOf, computeDiscovery, goalReturnPct } from "@/lib/discovery/calc";
import { checkDiscovery } from "@/lib/discovery/checks";
import { forClientLink, isMasked } from "@/lib/discovery/mask";
import { cleanSections, keepServerFields, DiscoveryTooLarge } from "@/lib/discovery/validate";

const TODAY = { today: "2026-10-07", currentYear: 2026 };

describe("fact-find health score", () => {
  it("claims no score for a blank form", () => {
    const c = computeDiscovery({}, TODAY);
    expect(c.healthScore).toBeNull();
    expect(c.healthBand).toBe("Incomplete");
  });

  it("reads income per its own frequency; legacy rows stay yearly", () => {
    expect(annualIncomeOf({ amount: 100000, frequency: "Monthly" })).toBe(1_200_000);
    expect(annualIncomeOf({ annualAmount: 1_200_000, frequency: "Monthly" })).toBe(1_200_000);
    expect(computeDiscovery({ income: [{ amount: 100000, frequency: "Monthly" }] }, TODAY).grossAnnualIncome).toBe(1_200_000);
  });

  it("counts a premium once — from the policy, not again from expenses", () => {
    const c = computeDiscovery({
      income: [{ amount: 100000, frequency: "Monthly" }],
      expenses: { insurance: 5000 },
      lifeInsurance: [{ sumAssured: 10_000_000, premium: 20000 }],
    }, TODAY);
    expect(c.premiumSource).toBe("policies");
    expect(c.annualInsurancePremiums).toBe(20000);
    expect(c.annualExpenses).toBe(0);
  });

  it("takes EMIs from the liabilities, monthly × 12", () => {
    const c = computeDiscovery({ liabilities: [{ outstanding: 2_000_000, emi: 25000 }], surplusInputs: { annualLoanEmis: 999 } }, TODAY);
    expect(c.emiSource).toBe("liabilities");
    expect(c.annualLoanEmis).toBe(300000);
  });

  it("assumes lower returns for near goals", () => {
    expect(goalReturnPct(2)).toBe(7);
    expect(goalReturnPct(4)).toBe(9);
    expect(goalReturnPct(10)).toBe(11);
  });
});

describe("fact-find risk", () => {
  it("gives no band and no suitability for a half-answered questionnaire", () => {
    const c = computeDiscovery({ riskProfile: { horizon: "> 10 years" } }, TODAY);
    expect(c.risk.complete).toBe(false);
    expect(c.risk.suitabilityReady).toBe(false);
    expect(c.risk.missing.length).toBeGreaterThan(0);
  });

  it("uses the profile on record and asks nothing", () => {
    const c = computeDiscovery({ recordedRisk: { category: "moderate", score: null, date: null, provisional: false, responseId: null } }, TODAY);
    expect(c.risk.source).toBe("record");
    expect(c.risk.bandId).toBe("moderate");
    expect(c.risk.score).toBeNull();
    expect(c.risk.missing).toEqual([]);
  });
});

describe("fact-find field checks", () => {
  it("accepts good values and masked ones", () => {
    expect(checkDiscovery({ identification: { pan: "ABCDE1234F", mobile: "+91 98765 43210", email: "a@b.in", dob: "1985-03-01" } }, TODAY)).toEqual({});
    expect(checkDiscovery({ identification: { pan: "AB*****4F", mobile: "******3210" } }, TODAY)).toEqual({});
  });

  it("flags bad PAN, mobile, email, future DOB and negatives", () => {
    const e = checkDiscovery({
      identification: { pan: "ABC123", mobile: "12345", email: "x@", dob: "2030-01-01" },
      income: [{ amount: -5 }],
    }, TODAY);
    expect(Object.keys(e).sort()).toEqual([
      "identification.dob", "identification.email", "identification.mobile", "identification.pan", "income.0.amount",
    ]);
  });
});

describe("client link", () => {
  it("masks PAN and mobile and drops the advisor's notes", () => {
    const out = forClientLink({
      identification: { pan: "ABCDE1234F", mobile: "9876543210", fullName: "A" },
      assessment: { note: "x" },
      recommendations: [{}],
    });
    expect(isMasked(out.identification.pan)).toBe(true);
    expect(isMasked(out.identification.mobile)).toBe(true);
    expect(out.identification.fullName).toBe("A");
    expect(out.assessment).toBeUndefined();
    expect(out.recommendations).toBeUndefined();
  });

  it("keeps server-owned fields and ignores unknown sections", () => {
    const stored = { recordedRisk: { category: "moderate", score: 20, date: null, provisional: false, responseId: null }, existingSipMonthly: 5000 };
    const next = keepServerFields(stored as any, cleanSections({ income: [{ amount: 1 }], recordedRisk: { category: "aggressive" }, evil: 1 }));
    expect(next.recordedRisk?.category).toBe("moderate");
    expect(next.existingSipMonthly).toBe(5000);
    expect((next as any).evil).toBeUndefined();
  });

  it("refuses an oversized body", () => {
    expect(() => cleanSections({ identification: { fullName: "x".repeat(300_000) } })).toThrow(DiscoveryTooLarge);
  });
});
