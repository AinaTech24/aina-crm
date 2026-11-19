/**
 * One employee's pay for one month — gross to net, with a plain-English "why"
 * on every line (the payslip's working; no silent numbers). Pure: no database,
 * so it is tested on its own and the salary form previews it live.
 *
 * Order (docs/PAYROLL_MODULE_DESIGN.md §3.5): payable days → the month's
 * components pro-rated → arrears, incentives, claims and one-time earnings →
 * the Code on Wages check → PF → ESI → Professional Tax → TDS (annual
 * projection less what was already deducted, over the months left; new or old
 * regime) → loan EMIs → one-time deductions → net pay.
 */

import type { PayrollSettings } from "./settings";
import { ESI, NEW_REGIME, OLD_REGIME, PF, WAGES_MIN_SHARE, annualTax, inForce, professionalTax } from "./statutory";
import { oldRegimeDeductions, type Declaration, type ExemptLine, type TaxRegimeKey } from "./tax";

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

/** Pay owed for an earlier month because a salary revision was dated back. */
export type ArrearIn = { period: string; amount: number; basic: number; why: string };
/** An approved incentive statement or reimbursement claim paid this month. */
export type PaidInput = { id: string; label: string; amount: number; why: string };
/** A loan or advance instalment recovered this month. */
export type LoanIn = { id: string; label: string; amount: number; why: string };

export type MonthIn = {
  /** First day of the month, yyyy-mm-dd. */
  period: string;
  lopDays: number;
  adjustments: Array<{ label: string; amount: number; kind: "earning" | "deduction"; taxable: boolean }>;
  /** This financial year before this month: taxable gross paid and TDS deducted. */
  ytd: { taxableGross: number; tds: number };
  arrears?: ArrearIn[];
  incentives?: PaidInput[];
  claims?: PaidInput[];
  loans?: LoanIn[];
  /** The employee's regime and declaration for the year (new regime, nothing declared, when absent). */
  tax?: { regime: TaxRegimeKey; declaration: Declaration; proofsApplied: boolean };
};

export type TaxWorking = {
  regime: TaxRegimeKey;
  /** Salary for the year: earlier months, this month, the months left at today's salary, and a previous employer's. */
  projectedIncome: number;
  standardDeduction: number;
  exemptions: ExemptLine[];
  taxable: number;
  yearTax: number;
  alreadyDeducted: number;
  monthsLeft: number;
  proofsApplied: boolean;
  /** The year's tax under the other regime, for comparison. */
  other: { regime: TaxRegimeKey; yearTax: number };
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
  /** Gross less claims and one-time payments marked not taxable — what TDS is worked on. */
  taxableGross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  tds: number;
  tax: TaxWorking;
  /** Wages the PF ECR and ESIC files report. */
  statutory: { pfWages: number; epsWages: number; edliWages: number; esiWages: number; ncpDays: number };
  /** What this month paid or recovered, so the run can mark it done. */
  links: { incentives: string[]; claims: string[]; loans: Array<{ id: string; amount: number }>; arrears: Array<{ period: string; amount: number }> };
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

/** The year's tax under one regime. */
export function yearTaxUnder(
  regimeKey: TaxRegimeKey,
  period: string,
  projectedIncome: number,
  declaration: Declaration,
  annual: { basic: number; hra: number; pt: number; pf: number }
): { standardDeduction: number; exemptions: ExemptLine[]; taxable: number; yearTax: number } {
  const regime = inForce(regimeKey === "old" ? OLD_REGIME : NEW_REGIME, period);
  const exemptions =
    regimeKey === "old" ? oldRegimeDeductions(declaration, { annualBasic: annual.basic, annualHra: annual.hra, annualPt: annual.pt, annualPf: annual.pf }) : [];
  const taxable = Math.max(0, projectedIncome - regime.standardDeduction - exemptions.reduce((t, l) => t + l.amount, 0));
  return { standardDeduction: regime.standardDeduction, exemptions, taxable, yearTax: annualTax(taxable, regime) };
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

  const links: PayResult["links"] = { incentives: [], claims: [], loans: [], arrears: [] };
  let arrearsBasic = 0;
  for (const a of m.arrears ?? []) {
    if (a.amount <= 0) continue;
    earnings.push({ code: "arrears", label: `Arrears — ${monthName(a.period)}`, amount: r(a.amount), why: a.why });
    arrearsBasic += r(a.basic);
    links.arrears.push({ period: a.period, amount: r(a.amount) });
  }
  for (const i of m.incentives ?? []) {
    if (i.amount <= 0) continue;
    earnings.push({ code: "incentive", label: i.label, amount: r(i.amount), why: i.why });
    links.incentives.push(i.id);
  }
  let claimsTotal = 0;
  for (const c of m.claims ?? []) {
    if (c.amount <= 0) continue;
    earnings.push({ code: "claim", label: c.label, amount: r(c.amount), why: c.why });
    claimsTotal += r(c.amount);
    links.claims.push(c.id);
  }
  for (const a of m.adjustments.filter((x) => x.kind === "earning" && x.amount > 0)) {
    earnings.push({ code: "adj", label: a.label, amount: r(a.amount), why: a.taxable ? "One-time payment this month" : "One-time payment, not taxed" });
  }
  const gross = earnings.reduce((t, l) => t + l.amount, 0);
  const basicEarned = (earnings.find((l) => l.code === "basic")?.amount ?? 0) + arrearsBasic;
  const untaxed = claimsTotal + m.adjustments.filter((a) => a.kind === "earning" && !a.taxable).reduce((t, a) => t + r(a.amount), 0);
  const taxableGross = gross - untaxed;
  // Reimbursements of expenses are not wages: no ESI or PT on them.
  const wageGross = gross - claimsTotal;

  // Code on Wages: wages (Basic) at least half of total pay.
  const minShare = inForce(WAGES_MIN_SHARE, m.period);
  if (st.gross > 0 && st.basic / st.gross < minShare) {
    warnings.push(`Basic is ${Math.round((st.basic / st.gross) * 100)}% of pay — the Code on Wages counts wages as at least ${minShare * 100}%, so PF and gratuity are worked on more than Basic. Raise Basic or check with your CA.`);
  }

  // ── Deductions and employer contributions ────────────────────────────────
  const deductions: Line[] = [];
  const employer: Line[] = [];
  const statutory = { pfWages: 0, epsWages: 0, edliWages: 0, esiWages: 0, ncpDays: Math.round(lop + notEmployed) };

  if (e.pfEnabled && basicEarned > 0) {
    const pf = inForce(PF, m.period);
    const pfWages = s.pfWageMode === "capped" ? Math.min(basicEarned, pf.ceiling) : basicEarned;
    const ceilWages = Math.min(pfWages, pf.ceiling);
    const emp = r(pfWages * pf.employee);
    const eps = r(ceilWages * pf.eps);
    const epf = r(pfWages * pf.employer) - eps;
    const basisWhy = arrearsBasic ? `Basic ${inr(basicEarned - arrearsBasic)} + Basic arrears ${inr(arrearsBasic)}` : "Basic";
    const wagesWhy = s.pfWageMode === "capped" && basicEarned > pf.ceiling ? `12% of PF wages ${inr(pfWages)} (${basisWhy}, capped at ${inr(pf.ceiling)})` : `12% of PF wages ${inr(pfWages)}${arrearsBasic ? ` (${basisWhy})` : ""}`;
    deductions.push({ code: "pf", label: "Provident Fund", amount: emp, why: wagesWhy });
    employer.push({ code: "epf", label: "Employer PF", amount: epf, why: `12% of ${inr(pfWages)}, less the pension share` });
    employer.push({ code: "eps", label: "Employer pension (EPS)", amount: eps, why: `8.33% of ${inr(ceilWages)}` });
    employer.push({ code: "edli", label: "EDLI", amount: r(ceilWages * pf.edli), why: `0.5% of ${inr(ceilWages)}` });
    employer.push({ code: "pf_admin", label: "PF admin charges", amount: r(pfWages * pf.admin), why: `0.5% of ${inr(pfWages)}` });
    Object.assign(statutory, { pfWages, epsWages: ceilWages, edliWages: ceilWages });
  }

  const esi = inForce(ESI, m.period);
  if (e.esiMode === "auto" && st.gross > 0 && st.gross <= esi.ceiling && wageGross > 0) {
    deductions.push({ code: "esi", label: "ESI", amount: Math.ceil(wageGross * esi.employee), why: `0.75% of wages ${inr(wageGross)} (monthly salary within ${inr(esi.ceiling)})` });
    employer.push({ code: "esi_er", label: "Employer ESI", amount: Math.ceil(wageGross * esi.employer), why: `3.25% of wages ${inr(wageGross)}` });
    statutory.esiWages = wageGross;
  }

  const pt = professionalTax(e.workState, wageGross, m.period, e.gender);
  if (pt.amount > 0) deductions.push({ code: "pt", label: "Professional Tax", amount: pt.amount, why: pt.why });
  else if (e.workState && /enter it as a deduction/.test(pt.why)) warnings.push(pt.why);

  // TDS: project the year — what was paid (here and at a previous employer),
  // this month, and the regular salary for the months after — tax it under
  // the employee's regime, take off what was already deducted, and spread the
  // rest over the months left.
  const decl = m.tax?.declaration ?? {};
  const regimeKey: TaxRegimeKey = m.tax?.regime ?? "new";
  const left = monthsLeftInFy(m.period);
  const prevIncome = decl.prevIncome ?? 0;
  const prevTds = decl.prevTds ?? 0;
  const projectedIncome = m.ytd.taxableGross + taxableGross + st.gross * (left - 1) + prevIncome;
  const empPf = deductions.find((l) => l.code === "pf")?.amount ?? 0;
  const annual = { basic: st.basic * 12, hra: st.hra * 12, pt: pt.amount * 12, pf: empPf * 12 };
  const chosen = yearTaxUnder(regimeKey, m.period, projectedIncome, decl, annual);
  const otherKey: TaxRegimeKey = regimeKey === "old" ? "new" : "old";
  const other = yearTaxUnder(otherKey, m.period, projectedIncome, decl, annual);
  const alreadyDeducted = m.ytd.tds + prevTds;
  const tds = Math.max(0, r((chosen.yearTax - alreadyDeducted) / left));
  const tax: TaxWorking = {
    regime: regimeKey,
    projectedIncome,
    standardDeduction: chosen.standardDeduction,
    exemptions: chosen.exemptions,
    taxable: chosen.taxable,
    yearTax: chosen.yearTax,
    alreadyDeducted,
    monthsLeft: left,
    proofsApplied: !!m.tax?.proofsApplied,
    other: { regime: otherKey, yearTax: other.yearTax },
  };
  if (tds > 0) {
    const ded = chosen.exemptions.reduce((t, l) => t + l.amount, 0);
    deductions.push({
      code: "tds", label: "Income Tax (TDS)", amount: tds,
      why: `Year's tax ${inr(chosen.yearTax)} on projected taxable salary ${inr(chosen.taxable)} (${regimeKey} regime, after the ${inr(chosen.standardDeduction)} standard deduction${ded ? ` and ${inr(ded)} of declared deductions` : ""}), less ${inr(alreadyDeducted)} already deducted${prevTds ? " (incl. a previous employer's)" : ""}, over ${left} month${left === 1 ? "" : "s"}`,
    });
  }

  const loanLines: Array<{ line: Line; link: { id: string; amount: number } }> = [];
  for (const l of m.loans ?? []) {
    if (l.amount <= 0) continue;
    const line: Line = { code: "loan", label: l.label, amount: r(l.amount), why: l.why };
    const link = { id: l.id, amount: r(l.amount) };
    deductions.push(line);
    links.loans.push(link);
    loanLines.push({ line, link });
  }
  for (const a of m.adjustments.filter((x) => x.kind === "deduction" && x.amount > 0)) {
    deductions.push({ code: "adj", label: a.label, amount: r(a.amount), why: "One-time deduction this month" });
  }

  let totalDeductions = deductions.reduce((t, l) => t + l.amount, 0);
  let net = gross - totalDeductions;
  // Too little pay: recover less of the loans first (the balance carries on).
  if (net < 0) {
    let short = -net;
    for (const { line, link } of [...loanLines].reverse()) {
      if (short <= 0) break;
      const cut = Math.min(line.amount, short);
      line.amount -= cut;
      link.amount = line.amount;
      short -= cut;
      line.why += ` — reduced by ${inr(cut)}: pay was too low this month`;
    }
    for (let i = deductions.length - 1; i >= 0; i--) if (deductions[i].code === "loan" && deductions[i].amount <= 0) deductions.splice(i, 1);
    links.loans = links.loans.filter((x) => x.amount > 0);
    totalDeductions = deductions.reduce((t, l) => t + l.amount, 0);
    net = gross - totalDeductions;
  }
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
    tax,
    statutory,
    links,
    warnings,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
