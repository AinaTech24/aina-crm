import { describe, expect, it } from "vitest";
import { calculatePay, monthsLeftInFy, splitSalary, type EmployeeIn, type MonthIn } from "@/lib/payroll/calc";
import { readPayrollSettings } from "@/lib/payroll/settings";
import { NEW_REGIME, annualTax, inForce, professionalTax } from "@/lib/payroll/statutory";

const S = readPayrollSettings({});
const emp = (over: Partial<EmployeeIn> = {}): EmployeeIn => ({ monthlyGross: 30000, pfEnabled: true, esiMode: "auto", workState: "GJ", ...over });
const month = (over: Partial<MonthIn> = {}): MonthIn => ({ period: "2026-11-01", lopDays: 0, adjustments: [], ytd: { taxableGross: 210000, tds: 0 }, ...over });
const line = (r: { earnings?: { code: string; amount: number }[]; deductions?: { code: string; amount: number }[]; employer?: { code: string; amount: number }[] }, code: string) =>
  [...(r.earnings ?? []), ...(r.deductions ?? []), ...(r.employer ?? [])].find((l) => l.code === code)?.amount;

describe("settings", () => {
  it("defaults: calendar days, Basic 50%, HRA 40% of Basic, PF capped, Gujarat", () => {
    expect(S).toEqual({ payableDaysMethod: "calendar", basicPct: 0.5, hraPctOfBasic: 0.4, pfWageMode: "capped", defaultState: "GJ", payDay: 1 });
  });
});

describe("a ₹30,000 RM in Gujarat, full month", () => {
  const r = calculatePay(emp(), month(), S);
  it("splits the salary 15,000 / 6,000 / 9,000", () => {
    expect(r.structure).toEqual({ basic: 15000, hra: 6000, special: 9000, gross: 30000 });
    expect(r.gross).toBe(30000);
  });
  it("PF 12% of capped wages, employer split into EPF and EPS", () => {
    expect(line(r, "pf")).toBe(1800);
    expect(line(r, "eps")).toBe(1250);
    expect(line(r, "epf")).toBe(550);
    expect(line(r, "edli")).toBe(75);
    expect(line(r, "pf_admin")).toBe(75);
  });
  it("no ESI above ₹21,000; Gujarat PT ₹200; no TDS below the rebate", () => {
    expect(line(r, "esi")).toBeUndefined();
    expect(line(r, "pt")).toBe(200);
    expect(r.tds).toBe(0);
  });
  it("net ₹28,000; cost to the firm ₹31,950", () => {
    expect(r.net).toBe(28000);
    expect(r.employerCost).toBe(31950);
  });
  it("every line says why", () => {
    for (const l of [...r.earnings, ...r.deductions, ...r.employer]) expect(l.why.length).toBeGreaterThan(5);
  });
});

describe("days without pay and part months", () => {
  it("3 days LOP in a 30-day month pays 27/30", () => {
    const r = calculatePay(emp(), month({ lopDays: 3 }), S);
    expect(r.payableDays).toBe(27);
    expect(line(r, "basic")).toBe(13500);
    expect(line(r, "hra")).toBe(5400);
    expect(r.gross).toBe(27000);
  });
  it("joining on the 16th of a 30-day month pays half", () => {
    const r = calculatePay(emp({ joinDate: "2026-11-16" }), month(), S);
    expect(r.notEmployedDays).toBe(15);
    expect(r.gross).toBe(15000);
  });
  it("leaving on the 10th pays 10 days", () => {
    const r = calculatePay(emp({ exitDate: "2026-11-10" }), month(), S);
    expect(r.payableDays).toBe(10);
    expect(r.gross).toBe(10000);
  });
  it("fixed 26-day months divide by 26", () => {
    const r = calculatePay(emp(), month({ lopDays: 2.6 }), readPayrollSettings({ payableDaysMethod: "fixed26" }));
    expect(r.baseDays).toBe(26);
    expect(r.gross).toBe(27000);
  });
});

describe("ESI", () => {
  it("applies at ₹20,000: 0.75% and 3.25%, rounded up", () => {
    const r = calculatePay(emp({ monthlyGross: 20000 }), month(), S);
    expect(line(r, "esi")).toBe(150);
    expect(line(r, "esi_er")).toBe(650);
    expect(line(r, "pf")).toBe(1200);
  });
  it("is skipped when switched off on the profile", () => {
    expect(line(calculatePay(emp({ monthlyGross: 20000, esiMode: "off" }), month(), S), "esi")).toBeUndefined();
  });
});

describe("PF on full Basic", () => {
  it("12% of the whole Basic when the firm chooses full wages", () => {
    const r = calculatePay(emp({ monthlyGross: 60000 }), month(), readPayrollSettings({ pfWageMode: "full" }));
    expect(line(r, "pf")).toBe(3600);
    expect(line(r, "eps")).toBe(1250); // pension stays on ₹15,000
  });
});

describe("income tax (new regime, tax year 2026-27)", () => {
  const regime = inForce(NEW_REGIME, "2026-11-01");
  it("nil up to ₹12 lakh taxable (rebate)", () => {
    expect(annualTax(1200000, regime)).toBe(0);
  });
  it("marginal relief just above ₹12 lakh: never more than the excess", () => {
    expect(annualTax(1210000, regime)).toBe(10400); // ₹10,000 + 4% cess
  });
  it("₹17.25 lakh taxable: ₹1,45,000 + cess", () => {
    expect(annualTax(1725000, regime)).toBe(150800);
  });
  it("₹1.5 lakh a month from April: ₹12,567 TDS a month", () => {
    const r = calculatePay(emp({ monthlyGross: 150000 }), month({ period: "2026-04-01", ytd: { taxableGross: 0, tds: 0 } }), S);
    expect(r.tds).toBe(12567);
  });
  it("counts months left in the financial year", () => {
    expect(monthsLeftInFy("2026-04-01")).toBe(12);
    expect(monthsLeftInFy("2026-11-01")).toBe(5);
    expect(monthsLeftInFy("2027-03-01")).toBe(1);
  });
  it("a one-time bonus raises this month's TDS, not the projection for every month", () => {
    const base = calculatePay(emp({ monthlyGross: 150000 }), month({ period: "2026-04-01", ytd: { taxableGross: 0, tds: 0 } }), S);
    const bonus = calculatePay(
      emp({ monthlyGross: 150000 }),
      month({ period: "2026-04-01", ytd: { taxableGross: 0, tds: 0 }, adjustments: [{ label: "Bonus", amount: 120000, kind: "earning", taxable: true }] }),
      S
    );
    expect(bonus.tds).toBeGreaterThan(base.tds);
    expect(bonus.gross).toBe(270000);
  });
});

describe("Professional Tax", () => {
  it("Maharashtra: women below ₹25,000 pay nil; February ₹300", () => {
    expect(professionalTax("MH", 20000, "2026-11-01", "female").amount).toBe(0);
    expect(professionalTax("MH", 30000, "2027-02-01", "female").amount).toBe(300);
    expect(professionalTax("MH", 9000, "2026-11-01", "male").amount).toBe(175);
  });
  it("Gujarat below ₹12,000 nil; Delhi none; Tamil Nadu flagged", () => {
    expect(professionalTax("GJ", 11999, "2026-11-01", null).amount).toBe(0);
    expect(professionalTax("DL", 90000, "2026-11-01", null).amount).toBe(0);
    expect(professionalTax("TN", 90000, "2026-11-01", null).why).toMatch(/half-yearly/);
  });
});

describe("checks", () => {
  it("warns when Basic is under half of pay (Code on Wages)", () => {
    const r = calculatePay(emp(), month(), readPayrollSettings({ basicPct: 0.4 }));
    expect(r.warnings.join(" ")).toMatch(/Code on Wages/);
  });
  it("never pays a negative salary", () => {
    const r = calculatePay(emp({ monthlyGross: 10000 }), month({ adjustments: [{ label: "Advance recovery", amount: 50000, kind: "deduction", taxable: false }] }), S);
    expect(r.net).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/net pay is set to nil/);
  });
  it("an override for Basic is honoured", () => {
    expect(splitSalary({ monthlyGross: 40000, basicOverride: 25000 }, S)).toEqual({ basic: 25000, hra: 10000, special: 5000, gross: 40000 });
  });
});
