import { describe, expect, it } from "vitest";
import { calculatePay, type EmployeeIn, type MonthIn } from "@/lib/payroll/calc";
import { readPayrollSettings } from "@/lib/payroll/settings";
import { OLD_REGIME, annualTax, inForce } from "@/lib/payroll/statutory";
import { effectiveDeclaration, oldRegimeDeductions, proofsApply } from "@/lib/payroll/tax";
import { PlanSchema, fiscalYearOf, planPeriod, workIncentive, type PlanShape } from "@/lib/payroll/incentive-rules";
import { variance } from "@/lib/payroll/variance";
import { ecrLine, esicRow } from "@/lib/payroll/filings";

const S = readPayrollSettings({});
const emp = (over: Partial<EmployeeIn> = {}): EmployeeIn => ({ monthlyGross: 30000, pfEnabled: true, esiMode: "auto", workState: "GJ", ...over });
const month = (over: Partial<MonthIn> = {}): MonthIn => ({ period: "2026-11-01", lopDays: 0, adjustments: [], ytd: { taxableGross: 210000, tds: 0 }, ...over });
const line = (lines: Array<{ code: string; amount: number }>, code: string) => lines.find((l) => l.code === code)?.amount;

describe("old tax regime", () => {
  const old = inForce(OLD_REGIME, "2026-11-01");
  it("nil up to ₹5 lakh taxable (₹12,500 rebate), no marginal relief above", () => {
    expect(annualTax(500000, old)).toBe(0);
    expect(annualTax(600000, old)).toBe(33800); // 12,500 + 20,000, + 4% cess
  });
  it("₹10 lakh taxable: ₹1,12,500 + cess", () => {
    expect(annualTax(1000000, old)).toBe(117000);
  });
});

describe("old-regime deductions", () => {
  const x = { annualBasic: 360000, annualHra: 144000, annualPt: 2400, annualPf: 21600 };
  it("HRA exemption is the least of the three", () => {
    expect(oldRegimeDeductions({ rentPaid: 180000 }, x).find((l) => l.label === "HRA exemption")?.amount).toBe(144000);
    expect(oldRegimeDeductions({ rentPaid: 120000, metro: true }, x).find((l) => l.label === "HRA exemption")?.amount).toBe(84000);
  });
  it("80C counts the employee's PF and stops at ₹1.5 lakh", () => {
    expect(oldRegimeDeductions({ sec80c: 100000 }, x).find((l) => l.label === "80C")?.amount).toBe(121600);
    expect(oldRegimeDeductions({ sec80c: 200000 }, x).find((l) => l.label === "80C")?.amount).toBe(150000);
  });
  it("80D, home loan and NPS have their caps", () => {
    const l = oldRegimeDeductions({ sec80dSelf: 40000, sec80dParents: 60000, seniorParents: true, homeLoanInterest: 300000, nps80ccd1b: 90000 }, x);
    expect(l.find((i) => i.label === "80D health insurance")?.amount).toBe(75000);
    expect(l.find((i) => i.label === "Home-loan interest 24(b)")?.amount).toBe(200000);
    expect(l.find((i) => i.label === "80CCD(1B) NPS")?.amount).toBe(50000);
  });
});

describe("proofs", () => {
  it("count from the month after the deadline, January–March only", () => {
    expect(proofsApply("2027-01-01", 1)).toBe(false);
    expect(proofsApply("2027-02-01", 1)).toBe(true);
    expect(proofsApply("2027-03-01", 2)).toBe(true);
    expect(proofsApply("2026-11-01", 1)).toBe(false);
  });
  it("after the deadline an unproved item counts as nil; a verified one at its verified amount", () => {
    const d = effectiveDeclaration({ sec80c: 150000, rentPaid: 180000 }, { sec80c: { status: "verified", amount: 100000 }, rentPaid: { status: "submitted", amount: 180000 } }, true);
    expect(d.sec80c).toBe(100000);
    expect(d.rentPaid).toBe(0);
  });
});

describe("TDS under the declared regime", () => {
  const april = { period: "2026-04-01", ytd: { taxableGross: 0, tds: 0 } };
  it("old regime with rent and 80C taxes less than the new regime would here", () => {
    const r = calculatePay(emp({ monthlyGross: 100000 }), month({ ...april, tax: { regime: "old", declaration: { rentPaid: 300000, sec80c: 150000, sec80dSelf: 25000 }, proofsApplied: false } }), S);
    expect(r.tax.regime).toBe("old");
    expect(r.tax.exemptions.map((l) => l.label)).toContain("HRA exemption");
    expect(r.tax.yearTax).toBeGreaterThan(0);
    expect(r.tax.other.regime).toBe("new");
    expect(r.tds).toBe(Math.round(r.tax.yearTax / 12));
  });
  it("a previous employer's income and TDS count towards the year", () => {
    const base = calculatePay(emp({ monthlyGross: 150000 }), month({ ...april }), S);
    const prev = calculatePay(emp({ monthlyGross: 150000 }), month({ ...april, tax: { regime: "new", declaration: { prevIncome: 300000, prevTds: 20000 }, proofsApplied: false } }), S);
    expect(prev.tax.projectedIncome).toBe(base.tax.projectedIncome + 300000);
    expect(prev.tax.alreadyDeducted).toBe(20000);
  });
});

describe("arrears, claims, incentives and loans on the payslip", () => {
  it("arrears are paid as their own line and their Basic attracts PF", () => {
    const r = calculatePay(emp({ monthlyGross: 20000, esiMode: "off" }), month({ arrears: [{ period: "2026-10-01", amount: 3000, basic: 1500, why: "Revision" }] }), S);
    expect(line(r.earnings, "arrears")).toBe(3000);
    expect(r.gross).toBe(23000);
    expect(r.statutory.pfWages).toBe(11500);
    expect(line(r.deductions, "pf")).toBe(1380);
    expect(r.links.arrears).toEqual([{ period: "2026-10-01", amount: 3000 }]);
  });
  it("a reimbursement is paid but not taxed, and carries no ESI or PT", () => {
    const r = calculatePay(emp({ monthlyGross: 20000 }), month({ claims: [{ id: "c1", label: "Reimbursement — Fuel", amount: 2000, why: "Bill" }] }), S);
    expect(r.gross).toBe(22000);
    expect(r.taxableGross).toBe(20000);
    expect(line(r.deductions, "esi")).toBe(150);
    expect(r.links.claims).toEqual(["c1"]);
  });
  it("an incentive is taxable pay", () => {
    const r = calculatePay(emp(), month({ incentives: [{ id: "i1", label: "Incentive — Q2", amount: 10000, why: "Slab" }] }), S);
    expect(r.taxableGross).toBe(40000);
    expect(r.links.incentives).toEqual(["i1"]);
  });
  it("a loan EMI is deducted and recorded", () => {
    const r = calculatePay(emp(), month({ loans: [{ id: "l1", label: "Loan EMI", amount: 5000, why: "EMI" }] }), S);
    expect(r.net).toBe(23000);
    expect(r.links.loans).toEqual([{ id: "l1", amount: 5000 }]);
  });
  it("too little pay: the EMI is cut, never the net below nil", () => {
    const r = calculatePay(emp({ monthlyGross: 10000 }), month({ lopDays: 20, loans: [{ id: "l1", label: "Loan EMI", amount: 5000, why: "EMI" }] }), S);
    expect(r.net).toBe(0);
    expect(r.links.loans[0].amount).toBeLessThan(5000);
    expect(r.links.loans[0].amount).toBe(r.gross - r.deductions.filter((l) => l.code !== "loan").reduce((t, l) => t + l.amount, 0));
  });
});

describe("incentives", () => {
  const plan: PlanShape = { measure: "net_business", slabOn: "achievement", payout: "percent", slabs: [{ from: 80, rate: 1 }, { from: 100, rate: 1.5 }], cap: null };
  it("pays the highest slab reached", () => {
    const w = workIncentive(plan, 1200000, 1000000);
    expect(w.achievementPct).toBe(120);
    expect(w.amount).toBe(18000);
    expect(w.summary).toMatch(/120%/);
  });
  it("caps, and pays nothing below the first slab", () => {
    expect(workIncentive({ ...plan, cap: 15000 }, 1200000, 1000000)).toMatchObject({ amount: 15000, capped: true });
    expect(workIncentive(plan, 700000, 1000000).amount).toBe(0);
  });
  it("no data is not zero business; no target says so", () => {
    expect(workIncentive(plan, null, 1000000).summary).toMatch(/No RTA data/);
    expect(workIncentive(plan, 1200000, null).summary).toMatch(/No target/);
  });
  it("new clients pay per client", () => {
    expect(workIncentive({ measure: "new_clients", slabOn: "value", payout: "per_unit", slabs: [{ from: 3, rate: 1000 }], cap: null }, 5, null).amount).toBe(5000);
  });
  it("periods follow the financial-year quarters", () => {
    expect(planPeriod("quarter", "2026-11")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(planPeriod("quarter", "2027-02")).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(planPeriod("month", "2027-02")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
    expect(fiscalYearOf("2027-02-01")).toBe("2026-27");
  });
  it("a plan must make sense", () => {
    const ok = { name: "RM quarterly", measure: "net_business", periodKind: "quarter", slabOn: "achievement", payout: "percent", slabs: [{ from: 80, rate: 1 }], roles: ["rm"] };
    expect(PlanSchema.safeParse(ok).success).toBe(true);
    expect(PlanSchema.safeParse({ ...ok, measure: "gross_business" }).success).toBe(false); // no target to achieve
    expect(PlanSchema.safeParse({ ...ok, measure: "new_clients" }).success).toBe(false); // % of a count
    expect(PlanSchema.safeParse({ ...ok, roles: [] }).success).toBe(false);
  });
});

describe("variance against last month", () => {
  it("flags new, left, big moves, nil and held", () => {
    const rows = variance(
      [
        { userId: "a", name: "Asha", gross: 30000, net: 28000, onHold: false },
        { userId: "b", name: "Bharat", gross: 40000, net: 45000, onHold: false },
        { userId: "c", name: "Chetan", gross: 20000, net: 0, onHold: false },
        { userId: "d", name: "Divya", gross: 25000, net: 23000, onHold: true },
      ],
      [
        { userId: "a", name: "Asha", gross: 30000, net: 27500, onHold: false },
        { userId: "b", name: "Bharat", gross: 30000, net: 28000, onHold: false },
        { userId: "e", name: "Esha", gross: 30000, net: 28000, onHold: false },
      ]
    );
    const by = Object.fromEntries(rows.map((r) => [r.userId, r.flags]));
    expect(by.a).toEqual([]);
    expect(by.b).toEqual(["up"]);
    expect(by.c).toEqual(["zero", "new"]);
    expect(by.d).toEqual(["held", "new"]);
    expect(by.e).toEqual(["left"]);
    expect(rows[rows.length - 1].userId).toBe("a");
  });
});

describe("statutory files", () => {
  it("ECR line: UAN, name, wages, contributions, NCP days", () => {
    const r = calculatePay(emp(), month({ lopDays: 2 }), S);
    expect(ecrLine("100123456789", "Asha Patel", r)).toBe(`100123456789#~#ASHA PATEL#~#${r.gross}#~#14000#~#14000#~#14000#~#1680#~#1166#~#514#~#2#~#0`);
  });
  it("no PF, no ECR line; ESIC row for someone with ESI, reason 2 when they left", () => {
    const noPf = calculatePay(emp({ pfEnabled: false }), month(), S);
    expect(ecrLine("1", "X", noPf)).toBeNull();
    const r = calculatePay(emp({ monthlyGross: 20000, exitDate: "2026-11-20" }), month(), S);
    expect(esicRow("3100123456", "Asha", r, "2026-11-20")).toEqual(["3100123456", "Asha", 20, r.gross, 2, "20/11/2026"]);
    expect(esicRow("1", "X", calculatePay(emp(), month(), S), null)).toBeNull();
  });
});
