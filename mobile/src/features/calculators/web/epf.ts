// Copied verbatim from src/lib/calculators/epf.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Employees' Provident Fund (EPF) — corpus at retirement.
 *
 * Rules (EPF & MP Act, 1952 and the EPF Scheme, 1952):
 *  - Employee contributes 12% of basic + DA every month (more is Voluntary PF).
 *  - Employer also contributes 12%, split: 8.33% to the Employees' Pension
 *    Scheme (EPS), capped on a ₹15,000 wage ceiling — at most ₹1,250 a month —
 *    and 3.67% to the EPF account. EPS is a pension, not part of this corpus.
 *    Option "full wage": an employer that contributes 12% on the full salary
 *    above ₹15,000 still sends only ₹1,250 to EPS, and the rest of its 12% goes
 *    to EPF (EPF share = 12% × wage − EPS).
 *  - Interest (8.25% for FY 2024-25, declared yearly by EPFO; editable) is
 *    worked out on the MONTHLY RUNNING BALANCE and credited once, at the end
 *    of the financial year (Para 60, EPF Scheme): each month's interest is
 *    rate/12 × the balance after that month's contribution, and the year's
 *    total is added on 31 March — so it compounds annually.
 *  - Salary rises once a year by the increase entered; retirement age 58 is
 *    the EPF superannuation age.
 *
 * Hand check: ₹10,000 basic, 12% + 3.67%, no balance, 8.25%: ₹1,567 a month;
 * running balances 1,567 × (1 + … + 12) = ₹1,22,226; interest
 * 1,22,226 × 8.25%/12 = ₹840.30; year-end balance ₹19,644.30.
 */

export const EPF_EMPLOYEE_PCT = 12;
export const EPF_EMPLOYER_SHARE_PCT = 3.67;
export const EPS_PCT = 8.33;
export const EPS_WAGE_CEILING = 15_000;
export const EPF_EMPLOYER_TOTAL_PCT = 12;
export const EPF_DEFAULT_RATE_PCT = 8.25;
export const EPF_RETIREMENT_AGE = 58;

export type EpfEmployerMode = "fixed_share" | "full_wage";

export type EpfInput = {
  currentAge: number;
  retirementAge: number;
  /** Monthly basic + DA today. */
  monthlyWage: number;
  salaryIncreasePct: number;
  employeePct: number;
  /** Employer's EPF share in "fixed_share" mode (3.67% by default). */
  employerPct: number;
  employerMode?: EpfEmployerMode;
  currentBalance: number;
  ratePct: number;
};

export type EpfRow = {
  year: number;
  age: number;
  monthlyWage: number;
  opening: number;
  employee: number;
  employer: number;
  /** Pension (EPS) contribution — shown for information, not in the corpus. */
  eps: number;
  interest: number;
  closing: number;
};

export type EpfResult = {
  years: number;
  rows: EpfRow[];
  corpus: number;
  totalEmployee: number;
  totalEmployer: number;
  totalEps: number;
  totalInterest: number;
};

/** EPS for a month's wage: 8.33% of the wage up to ₹15,000 (max ₹1,250). */
export function epsFor(monthlyWage: number): number {
  return Math.round((Math.min(Math.max(0, monthlyWage), EPS_WAGE_CEILING) * EPS_PCT) / 100);
}

/** The employer's monthly credit to EPF. */
export function employerEpfFor(monthlyWage: number, employerPct: number, mode: EpfEmployerMode = "fixed_share"): number {
  if (monthlyWage <= 0) return 0;
  if (mode === "full_wage") return Math.max(0, (monthlyWage * EPF_EMPLOYER_TOTAL_PCT) / 100 - epsFor(monthlyWage));
  return (monthlyWage * employerPct) / 100;
}

export function epfCalc(input: EpfInput): EpfResult {
  const years = Math.max(0, Math.round(input.retirementAge) - Math.round(input.currentAge));
  const mode = input.employerMode ?? "fixed_share";
  const rows: EpfRow[] = [];
  let bal = Math.max(0, input.currentBalance);
  let wage = Math.max(0, input.monthlyWage);
  for (let y = 1; y <= years; y++) {
    if (y > 1) wage *= 1 + input.salaryIncreasePct / 100;
    const ee = (wage * input.employeePct) / 100;
    const er = employerEpfFor(wage, input.employerPct, mode);
    const eps = epsFor(wage);
    const opening = bal;
    let running = opening;
    let runningSum = 0;
    for (let m = 0; m < 12; m++) {
      running += ee + er;
      runningSum += running;
    }
    const interest = (runningSum * input.ratePct) / 1200;
    bal = running + interest;
    rows.push({
      year: y,
      age: Math.round(input.currentAge) + y,
      monthlyWage: wage,
      opening,
      employee: ee * 12,
      employer: er * 12,
      eps: eps * 12,
      interest,
      closing: bal,
    });
  }
  return {
    years,
    rows,
    corpus: bal,
    totalEmployee: rows.reduce((s, r) => s + r.employee, 0),
    totalEmployer: rows.reduce((s, r) => s + r.employer, 0),
    totalEps: rows.reduce((s, r) => s + r.eps, 0),
    totalInterest: rows.reduce((s, r) => s + r.interest, 0),
  };
}
