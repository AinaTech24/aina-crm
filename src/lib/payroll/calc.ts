/**
 * One employee's pay for one month — gross to net, with a plain-English "why"
 * on every line (the payslip's working; no silent numbers). Pure: no database,
 * so it is tested on its own and the salary form previews it live.
 *
 * Order (docs/PAYROLL_MODULE_DESIGN.md §3.5): payable days → the month's
 * components pro-rated → one-time earnings → the Code on Wages check → PF →
 * ESI → Professional Tax → TDS (annual projection less what was already
 * deducted, over the months left) → one-time deductions → net pay.
 */

import type { PayrollSettings } from "./settings";
import { ESI, NEW_REGIME, PF, WAGES_MIN_SHARE, annualTax, inForce, professionalTax } from "./statutory";

export type Line = { code: string; label: string; amount: number; why: string };

export type EmployeeIn = {
  monthlyGross: number;
  basicOverride?: number | null;
  hraOverride?: number | null;
  pfEnabled: boolean;
  esiMode: "auto" | "off";
  workState: string | null;
  gender?: string | null;
  joinDate?: string | null; // yyyy-mm-dd
  exitDate?: string | null;
};

export type MonthIn = {
  /** First day of the month, yyyy-mm-dd. */
  period: string;
  lopDays: number;
  adjustments: Array<{ label: string; amount: number; kind: "earning" | "deduction"; taxable: boolean }>;
  /** This financial year before this month: taxable gross paid and TDS deducted. */
  ytd: { taxableGross: number; tds: number };
};

export type PayResult = {
  period: string;
  daysInMonth: number;
  baseDays: number;
  payableDays: number;
  lopDays: number;
  notEmployedDays: number;
  structure: { basic: number; hra: number; special: number; gross: number };
  earnings: Line[];
  deductions: Line[];
  employer: Line[];
  gross: number;
  /** Gross less one-time payments marked not taxable — what TDS is worked on. */
  taxableGross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  tds: number;
  /** Things the payroll admin should look at (not errors). */
  warnings: string[];
};

const r = (n: number) => Math.round(n);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function daysIn(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Months of the financial year (April–March) still to be paid, this month included. */
export function monthsLeftInFy(period: string): number {
  const m = Number(period.slice(5, 7));
  return m >= 4 ? 16 - m : 4 - m;
}

/** The month's full salary split into Basic, HRA and Special Allowance. */
export function splitSalary(e: Pick<EmployeeIn, "monthlyGross" | "basicOverride" | "hraOverride">, s: PayrollSettings) {
  const gross = Math.max(0, e.monthlyGross);
  const basic = Math.min(gross, e.basicOverride != null ? e.basicOverride : r(gross * s.basicPct));
  const hra = Math.min(gross - basic, e.hraOverride != null ? e.hraOverride : r(basic * s.hraPctOfBasic));
  return { basic, hra, special: gross - basic - hra, gross };
}

export function calculatePay(e: EmployeeIn, m: MonthIn, s: PayrollSettings): PayResult {
  const warnings: string[] = [];
  const dim = daysIn(m.period);
  const monthEnd = `${m.period.slice(0, 8)}${String(dim).padStart(2, "0")}`;

  // ── Days ──────────────────────────────────────────────────────────────────
  let notEmployed = 0;
  if (e.joinDate && e.joinDate > m.period && e.joinDate <= monthEnd) notEmployed += Number(e.joinDate.slice(8, 10)) - 1;
  if (e.exitDate && e.exitDate >= m.period && e.exitDate < monthEnd) notEmployed += dim - Number(e.exitDate.slice(8, 10));
  const baseDays = s.payableDaysMethod === "fixed30" ? 30 : s.payableDaysMethod === "fixed26" ? 26 : dim;
  const lop = Math.max(0, m.lopDays);
  // Days outside employment are calendar days; scale them onto the base.
  const unpaid = Math.min(baseDays, lop + (notEmployed * baseDays) / dim);
  const payableDays = Math.round((baseDays - unpaid) * 10) / 10;
  const factor = baseDays ? payableDays / baseDays : 0;
  const dayWhy =
    factor < 1
      ? `${payableDays} of ${baseDays} days${lop ? ` (${lop} without pay)` : ""}${notEmployed ? ` (${notEmployed} days before joining or after leaving)` : ""}`
      : "Full month";

  // ── Earnings ──────────────────────────────────────────────────────────────
  const st = splitSalary(e, s);
  const earnings: Line[] = [];
  const add = (code: string, label: string, full: number, why: string) => {
    const amount = r(full * factor);
    if (amount > 0) earnings.push({ code, label, amount, why: factor < 1 ? `${inr(full)} × ${dayWhy}` : why });
  };
  add("basic", "Basic", st.basic, e.basicOverride != null ? "Set on this employee's salary" : `${Math.round(s.basicPct * 100)}% of monthly gross ${inr(st.gross)}`);
  add("hra", "House Rent Allowance", st.hra, e.hraOverride != null ? "Set on this employee's salary" : `${Math.round(s.hraPctOfBasic * 100)}% of Basic`);
  add("special", "Special Allowance", st.special, "The rest of the monthly gross");
  for (const a of m.adjustments.filter((x) => x.kind === "earning" && x.amount > 0)) {
    earnings.push({ code: "adj", label: a.label, amount: r(a.amount), why: a.taxable ? "One-time payment this month" : "One-time payment, not taxed" });
  }
  const gross = earnings.reduce((t, l) => t + l.amount, 0);
  const basicEarned = earnings.find((l) => l.code === "basic")?.amount ?? 0;
  const taxableGross = gross - m.adjustments.filter((a) => a.kind === "earning" && !a.taxable).reduce((t, a) => t + r(a.amount), 0);

  // Code on Wages: wages (Basic) at least half of total pay.
  const minShare = inForce(WAGES_MIN_SHARE, m.period);
  if (st.gross > 0 && st.basic / st.gross < minShare) {
    warnings.push(`Basic is ${Math.round((st.basic / st.gross) * 100)}% of pay — the Code on Wages counts wages as at least ${minShare * 100}%, so PF and gratuity are worked on more than Basic. Raise Basic or check with your CA.`);
  }

  // ── Deductions and employer contributions ────────────────────────────────
  const deductions: Line[] = [];
  const employer: Line[] = [];

  if (e.pfEnabled && basicEarned > 0) {
    const pf = inForce(PF, m.period);
    const pfWages = s.pfWageMode === "capped" ? Math.min(basicEarned, pf.ceiling) : basicEarned;
    const ceilWages = Math.min(pfWages, pf.ceiling);
    const emp = r(pfWages * pf.employee);
    const eps = r(ceilWages * pf.eps);
    const epf = r(pfWages * pf.employer) - eps;
    const wagesWhy = s.pfWageMode === "capped" && basicEarned > pf.ceiling ? `12% of PF wages ${inr(pfWages)} (Basic, capped at ${inr(pf.ceiling)})` : `12% of PF wages ${inr(pfWages)}`;
    deductions.push({ code: "pf", label: "Provident Fund", amount: emp, why: wagesWhy });
    employer.push({ code: "epf", label: "Employer PF", amount: epf, why: `12% of ${inr(pfWages)}, less the pension share` });
    employer.push({ code: "eps", label: "Employer pension (EPS)", amount: eps, why: `8.33% of ${inr(ceilWages)}` });
    employer.push({ code: "edli", label: "EDLI", amount: r(ceilWages * pf.edli), why: `0.5% of ${inr(ceilWages)}` });
    employer.push({ code: "pf_admin", label: "PF admin charges", amount: r(pfWages * pf.admin), why: `0.5% of ${inr(pfWages)}` });
  }

  const esi = inForce(ESI, m.period);
  if (e.esiMode === "auto" && st.gross > 0 && st.gross <= esi.ceiling && gross > 0) {
    deductions.push({ code: "esi", label: "ESI", amount: Math.ceil(gross * esi.employee), why: `0.75% of gross ${inr(gross)} (monthly salary within ${inr(esi.ceiling)})` });
    employer.push({ code: "esi_er", label: "Employer ESI", amount: Math.ceil(gross * esi.employer), why: `3.25% of gross ${inr(gross)}` });
  }

  const pt = professionalTax(e.workState, gross, m.period, e.gender);
  if (pt.amount > 0) deductions.push({ code: "pt", label: "Professional Tax", amount: pt.amount, why: pt.why });
  else if (e.workState && /enter it as a deduction/.test(pt.why)) warnings.push(pt.why);

  // TDS: project the year — what was paid, this month, and the regular salary
  // for the months after — tax it, take off what was already deducted, and
  // spread the rest over the months left.
  const regime = inForce(NEW_REGIME, m.period);
  const left = monthsLeftInFy(m.period);
  const projected = m.ytd.taxableGross + taxableGross + st.gross * (left - 1);
  const taxable = Math.max(0, projected - regime.standardDeduction);
  const yearTax = annualTax(taxable, regime);
  const tds = Math.max(0, r((yearTax - m.ytd.tds) / left));
  if (tds > 0) {
    deductions.push({
      code: "tds", label: "Income Tax (TDS)", amount: tds,
      why: `Year's tax ${inr(yearTax)} on projected taxable salary ${inr(taxable)} (new regime, after the ${inr(regime.standardDeduction)} standard deduction), less ${inr(m.ytd.tds)} already deducted, over ${left} month${left === 1 ? "" : "s"}`,
    });
  }

  for (const a of m.adjustments.filter((x) => x.kind === "deduction" && x.amount > 0)) {
    deductions.push({ code: "adj", label: a.label, amount: r(a.amount), why: "One-time deduction this month" });
  }

  let totalDeductions = deductions.reduce((t, l) => t + l.amount, 0);
  let net = gross - totalDeductions;
  if (net < 0) {
    warnings.push(`Deductions (${inr(totalDeductions)}) are more than the pay (${inr(gross)}) — net pay is set to nil; recover the rest next month.`);
    net = 0;
    totalDeductions = gross;
  }
  const employerCost = gross + employer.reduce((t, l) => t + l.amount, 0);

  return {
    period: m.period,
    daysInMonth: dim,
    baseDays,
    payableDays,
    lopDays: lop,
    notEmployedDays: notEmployed,
    structure: st,
    earnings,
    deductions,
    employer,
    gross,
    taxableGross,
    totalDeductions,
    net,
    employerCost,
    tds,
    warnings,
  };
}
