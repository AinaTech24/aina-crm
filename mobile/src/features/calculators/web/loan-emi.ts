// Copied verbatim from src/lib/calculators/loan-emi.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Loan EMI — the standard reducing-balance EMI used by every Indian bank and
 * NBFC for home, personal, car and education loans.
 *
 *   EMI = P · r · (1+r)^n / ((1+r)^n − 1),   r = annual rate / 12 (NOMINAL
 *   monthly rate, as lenders quote it), n = tenure in months; r = 0 → P / n.
 *
 * Each month's interest is the opening balance × r; the rest of the EMI repays
 * principal. The final instalment is trimmed to what is actually owed.
 *
 * Education loans: during the moratorium (course period + grace) SIMPLE
 * interest accrues on the amount disbursed (P × annual rate × months / 12) and
 * is added to the principal when repayment starts — the usual bank treatment
 * when the student pays nothing during the course. The tenure entered is the
 * REPAYMENT tenure, after the moratorium.
 *
 * Part-prepayment: a lump sum paid together with instalment k reduces the
 * balance after that instalment. "Reduce EMI" recomputes the EMI on the
 * remaining balance over the remaining months; "Reduce tenure" keeps the EMI
 * and the loan simply ends sooner. Interest saved = total interest without the
 * prepayment − total interest with it.
 *
 * This is NOT an effective-rate module (it never uses (1+r)^(1/12)); it is the
 * lenders' nominal monthly convention and independent of goal-planning/calc.
 */

export type LoanType = "home" | "personal" | "car" | "education";

export type LoanPreset = {
  type: LoanType;
  label: string;
  amount: number;
  ratePct: number;
  years: number;
  months: number;
  /** Moratorium months — only education loans have one. */
  moratoriumMonths: number;
};

/** Illustrative defaults (typical Indian lender pricing, late 2026). */
export const LOAN_PRESETS: Record<LoanType, LoanPreset> = {
  home: { type: "home", label: "Home loan", amount: 5_000_000, ratePct: 8.5, years: 20, months: 0, moratoriumMonths: 0 },
  personal: { type: "personal", label: "Personal loan", amount: 500_000, ratePct: 12, years: 5, months: 0, moratoriumMonths: 0 },
  car: { type: "car", label: "Car loan", amount: 800_000, ratePct: 9.5, years: 7, months: 0, moratoriumMonths: 0 },
  education: { type: "education", label: "Education loan", amount: 1_500_000, ratePct: 10, years: 10, months: 0, moratoriumMonths: 48 },
};

/** The monthly instalment for a reducing-balance loan. */
export function emi(principal: number, annualRatePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRatePct / 1200;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/** Simple interest accrued on an education loan during its moratorium. */
export function moratoriumInterest(principal: number, annualRatePct: number, moratoriumMonths: number): number {
  if (principal <= 0 || moratoriumMonths <= 0) return 0;
  return (principal * annualRatePct * moratoriumMonths) / 1200;
}

export type PrepayMode = "reduce_emi" | "reduce_tenure";

export type Prepayment = {
  amount: number;
  /** Paid with this instalment number (1-based). */
  month: number;
  mode: PrepayMode;
};

export type LoanInput = {
  amount: number;
  annualRatePct: number;
  years: number;
  months: number;
  /** Education loans only; 0 elsewhere. */
  moratoriumMonths?: number;
  prepayment?: Prepayment | null;
};

export type MonthRow = {
  month: number;
  opening: number;
  emi: number;
  interest: number;
  principal: number;
  prepayment: number;
  closing: number;
};

export type YearRow = {
  year: number;
  opening: number;
  emiPaid: number;
  interest: number;
  principal: number;
  prepayment: number;
  closing: number;
};

export type Schedule = {
  monthly: MonthRow[];
  yearly: YearRow[];
  totalInterest: number;
  totalPaid: number;
  /** Instalments actually paid. */
  months: number;
  /** EMI after the prepayment (equals the original EMI when none / reduce tenure). */
  emiAfter: number;
};

/** Month-by-month amortisation of `principal` at `emiAmount`, with an optional prepayment. */
export function amortise(
  principal: number,
  annualRatePct: number,
  months: number,
  prepayment?: Prepayment | null,
): Schedule {
  const r = annualRatePct / 1200;
  let pay = emi(principal, annualRatePct, months);
  let emiAfter = pay;
  let bal = principal;
  const monthly: MonthRow[] = [];
  const pp = prepayment && prepayment.amount > 0 && prepayment.month >= 1 && prepayment.month <= months ? prepayment : null;
  // Guard against a loan that can never close (only reachable with bad input).
  const limit = months * 2 + 12;
  for (let m = 1; bal > 1e-6 && m <= limit; m++) {
    const opening = bal;
    const interest = opening * r;
    let instalment = Math.min(pay, opening + interest);
    // A schedule with a reduced EMI must still finish in the remaining months.
    if (m === months && (!pp || pp.mode === "reduce_emi")) instalment = opening + interest;
    const principalPart = instalment - interest;
    bal = opening - principalPart;
    let pre = 0;
    if (pp && m === pp.month && bal > 0) {
      pre = Math.min(pp.amount, bal);
      bal -= pre;
      if (bal <= 1e-6) emiAfter = 0; // the prepayment closed the loan
      else if (pp.mode === "reduce_emi") {
        pay = emi(bal, annualRatePct, months - m);
        emiAfter = pay;
      }
    }
    if (Math.abs(bal) < 1e-6) bal = 0;
    monthly.push({ month: m, opening, emi: instalment, interest, principal: principalPart, prepayment: pre, closing: bal });
  }

  const yearly: YearRow[] = [];
  for (let i = 0; i < monthly.length; i += 12) {
    const slice = monthly.slice(i, i + 12);
    yearly.push({
      year: i / 12 + 1,
      opening: slice[0].opening,
      emiPaid: slice.reduce((s, x) => s + x.emi, 0),
      interest: slice.reduce((s, x) => s + x.interest, 0),
      principal: slice.reduce((s, x) => s + x.principal, 0),
      prepayment: slice.reduce((s, x) => s + x.prepayment, 0),
      closing: slice[slice.length - 1].closing,
    });
  }
  const totalInterest = monthly.reduce((s, x) => s + x.interest, 0);
  const totalPaid = monthly.reduce((s, x) => s + x.emi + x.prepayment, 0);
  return { monthly, yearly, totalInterest, totalPaid, months: monthly.length, emiAfter };
}

export type LoanResult = {
  /** Months of repayment (years × 12 + months). */
  tenureMonths: number;
  /** Amount disbursed. */
  amount: number;
  /** Simple interest added during the moratorium (0 when none). */
  moratoriumInterest: number;
  /** Principal on which the EMI is computed (amount + moratorium interest). */
  repayPrincipal: number;
  emi: number;
  /** Interest over the life of the loan, moratorium interest included. */
  totalInterest: number;
  /** Everything paid: instalments + prepayment. */
  totalPayment: number;
  schedule: Schedule;
  /** Present only when a valid prepayment was entered. */
  prepay: null | {
    amount: number;
    month: number;
    mode: PrepayMode;
    /** Schedule without the prepayment, for comparison. */
    base: Schedule;
    interestSaved: number;
    monthsSaved: number;
    newEmi: number;
  };
};

export function loanEmi(input: LoanInput): LoanResult {
  const tenureMonths = Math.max(0, Math.round(input.years) * 12 + Math.round(input.months));
  const amount = Math.max(0, input.amount);
  const mi = moratoriumInterest(amount, input.annualRatePct, Math.max(0, input.moratoriumMonths ?? 0));
  const repayPrincipal = amount + mi;
  const pp = input.prepayment && input.prepayment.amount > 0 && input.prepayment.month >= 1 && input.prepayment.month <= tenureMonths
    ? input.prepayment
    : null;
  const base = amortise(repayPrincipal, input.annualRatePct, tenureMonths);
  const schedule = pp ? amortise(repayPrincipal, input.annualRatePct, tenureMonths, pp) : base;
  return {
    tenureMonths,
    amount,
    moratoriumInterest: mi,
    repayPrincipal,
    emi: emi(repayPrincipal, input.annualRatePct, tenureMonths),
    totalInterest: mi + schedule.totalInterest,
    totalPayment: amount + mi + schedule.totalInterest,
    schedule,
    prepay: pp
      ? {
          amount: schedule.monthly.reduce((s, x) => s + x.prepayment, 0),
          month: pp.month,
          mode: pp.mode,
          base,
          interestSaved: base.totalInterest - schedule.totalInterest,
          monthsSaved: base.months - schedule.months,
          newEmi: schedule.emiAfter,
        }
      : null,
  };
}
