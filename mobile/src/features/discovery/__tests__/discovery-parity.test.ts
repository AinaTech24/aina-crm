/**
 * The fact-find rules the app copies from the CRM must give the CRM's answers.
 * The first four blocks are the web suite (tests/discovery-fact-find.test.ts)
 * run against the app's copies; the last checks the app-only pieces.
 */

import { annualIncomeOf, computeDiscovery, goalReturnPct } from "../calc";
import { checkDiscovery } from "../checks";
import { forClientLink, isMasked } from "../mask";
import { cleanSections, keepServerFields, DiscoveryTooLarge } from "../validate";
import { recordDiffs, recordFromApi } from "../record-diff";
import { indiaToday } from "../today";

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

describe("app-only pieces", () => {
  it("dates today in India as YYYY-MM-DD", () => {
    expect(indiaToday(new Date("2026-11-14T20:00:00Z"))).toBe("2026-11-15");
    expect(indiaToday(new Date("2026-11-14T10:00:00Z"))).toBe("2026-11-14");
  });

  it("compares the fact-find with the client record as the CRM does", () => {
    const rec = recordFromApi("investor", {
      phone: "+91 98765 43210", email: "A@B.IN", dob: "1985-03-01", address: { city: "Surat" },
      occupation: null, nomineeName: "Ravi", nomineeRelation: "Son", pan: "ABCDE1234F",
    });
    const diffs = recordDiffs(rec, "investor", {
      identification: { mobile: "9876543210", email: "a@b.in", city: "Vadodara", nomineeName: "", pan: "ABCDE1234G", occupation: "Doctor" },
    });
    expect(diffs.map((d) => d.field)).toEqual(["city", "occupation", "pan"]);
    expect(diffs.find((d) => d.field === "pan")?.applicable).toBe(false);
  });

  it("never treats a masked or blank value as a change", () => {
    const rec = recordFromApi("lead", { phone: "9876543210", email: null, city: "Pune", pan: "ABCDE1234F" });
    expect(recordDiffs(rec, "lead", { identification: { mobile: "******3210", pan: "AB*****34F", city: "" } })).toEqual([]);
  });
});
