// Copied verbatim from src/lib/calculators/insurance-irr.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Insurance Return Analyzer — math engine (renamed "Insurance IRR Calculator").
 *
 * Computes the true IRR of a traditional/guaranteed insurance policy from its
 * actual cashflows (premiums out, periodic payouts + maturity in), and compares
 * it with investing the same premiums in a mutual fund.
 *
 * Annual cashflow timeline (begin-of-year premiums). The IRR is the annual rate
 * that zeroes the NPV. Verified to the reference case study (₹1L premium × 10y,
 * 15y term, ₹17.5L maturity → IRR 5.36%; same premiums in MF @12% → ₹34.63L;
 * MF contribution to match the ₹17.5L maturity → ₹50,522/yr).
 *
 * Year-wise tables (premiums at the START of a year, payouts at the END):
 *   • the policy's cash flows (year, premium, payout incl. maturity);
 *   • the MF instalment that matches the policy, ROUNDED TO 2 DECIMALS before
 *     the table is built (₹50,522.41 — with the unrounded instalment year 5
 *     prints ₹3,59,477 instead of the reference ₹3,59,476);
 *   • the same premium in the MF: V(y) = (V(y−1) + premium·[y ≤ PPT]) · (1 + r).
 */

export type ScheduleRow = { year: number; investment: number; yearEndValue: number };
export type PolicyCashflowRow = { year: number; premium: number; payout: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

function mfSchedule(instalment: number, ppt: number, term: number, r: number): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let v = 0;
  for (let y = 1; y <= term; y++) {
    const investment = y <= ppt ? instalment : 0;
    v = (v + investment) * (1 + r);
    rows.push({ year: y, investment, yearEndValue: v });
  }
  return rows;
}

export type PayoutMode = "maturity" | "periodic" | "annuity";

export type Payout = { year: number; amount: number };

export type InsuranceIrrInput = {
  annualPremium: number;
  premiumPaymentTerm: number; // years premiums are paid
  policyTerm: number; // total policy duration (maturity year)
  payoutMode: PayoutMode;
  payouts: Payout[]; // periodic / annuity payouts (year + amount)
  maturityAmount: number; // lump sum at end of policy term
  expectedReturnPct: number; // for the MF comparison
};

/* ───────────────────────── NPV / IRR ───────────────────────── */

export function npv(cashflows: number[], rate: number): number {
  let v = 0;
  for (let t = 0; t < cashflows.length; t++) v += cashflows[t] / Math.pow(1 + rate, t);
  return v;
}

/** Annual IRR of a yearly cashflow array (index = year). null if none exists. */
export function irr(cashflows: number[]): number | null {
  const hasPos = cashflows.some((c) => c > 0);
  const hasNeg = cashflows.some((c) => c < 0);
  if (!hasPos || !hasNeg) return null;

  let lo = -0.9999;
  let hi = 1.0;
  let fLo = npv(cashflows, lo);
  let fHi = npv(cashflows, hi);
  let guard = 0;
  while (fLo * fHi > 0 && hi < 1000 && guard < 300) {
    hi *= 1.5;
    fHi = npv(cashflows, hi);
    guard++;
  }
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(cashflows, mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

/* ───────────────────────── Aggregate ───────────────────────── */

export type InsuranceIrrResult = {
  totalPremiums: number;
  totalPayouts: number;
  maturityAmount: number;
  totalBenefit: number; // payouts + maturity
  netGain: number; // benefit − premiums
  irrPct: number | null;
  cashflows: number[]; // yearly, for an optional schedule view
  // MF comparison (same premiums invested at expectedReturnPct)
  benefitAtMaturity: number; // maturity + payouts reinvested at expectedReturnPct to the term
  mfMaturity: number;
  mfWealthAdvantage: number; // mfMaturity − benefitAtMaturity
  mfAdvantagePct: number | null; // advantage as % of benefitAtMaturity
  mfContributionToMatch: number; // annual MF contribution to reach benefitAtMaturity
  /** The instalment used in the "MF for a similar payout" table (2 decimals). */
  mfContributionRounded: number;
  policySchedule: PolicyCashflowRow[];
  mfMatchSchedule: ScheduleRow[];
  mfSameSchedule: ScheduleRow[];
};

export function computeInsuranceIrr(input: InsuranceIrrInput): InsuranceIrrResult {
  const ppt = Math.max(0, Math.round(input.premiumPaymentTerm));
  const term = Math.max(ppt, Math.round(input.policyTerm));
  const R = input.expectedReturnPct / 100;

  const usePayouts = input.payoutMode !== "maturity";
  const payouts = usePayouts
    ? (input.payouts ?? []).filter((p) => p.year > 0 && p.year <= term && p.amount > 0)
    : [];

  // Build the yearly cashflow timeline (t = 0 … term).
  const cashflows = new Array(term + 1).fill(0);
  for (let t = 0; t < ppt; t++) cashflows[t] -= input.annualPremium; // begin-of-year premiums
  for (const p of payouts) cashflows[p.year] += p.amount;
  cashflows[term] += input.maturityAmount;

  const totalPremiums = input.annualPremium * ppt;
  const totalPayouts = payouts.reduce((s, p) => s + p.amount, 0);
  const totalBenefit = totalPayouts + input.maturityAmount;
  const netGain = totalBenefit - totalPremiums;
  const irrPct = irr(cashflows);

  // MF: invest the same premiums at R (begin-of-year), grow to maturity year.
  let mfMaturity = 0;
  let fvFactorPerRupee = 0;
  for (let t = 0; t < ppt; t++) {
    const growth = Math.pow(1 + R, term - t);
    mfMaturity += input.annualPremium * growth;
    fvFactorPerRupee += growth;
  }

  // Like-for-like: mid-term payouts reinvested at R until maturity, so the
  // policy's value sits on the same date as the MF's.
  const benefitAtMaturity =
    input.maturityAmount + payouts.reduce((s, p) => s + p.amount * Math.pow(1 + R, term - p.year), 0);

  const mfWealthAdvantage = mfMaturity - benefitAtMaturity;
  const mfAdvantagePct = benefitAtMaturity > 0 ? (mfWealthAdvantage / benefitAtMaturity) * 100 : null;
  const mfContributionToMatch = fvFactorPerRupee > 0 ? benefitAtMaturity / fvFactorPerRupee : 0;

  const mfContributionRounded = round2(mfContributionToMatch);
  const policySchedule: PolicyCashflowRow[] = [];
  for (let y = 1; y <= term; y++) {
    policySchedule.push({
      year: y,
      premium: y <= ppt ? input.annualPremium : 0,
      payout: payouts.filter((p) => p.year === y).reduce((s, p) => s + p.amount, 0) + (y === term ? input.maturityAmount : 0),
    });
  }

  return {
    totalPremiums,
    totalPayouts,
    maturityAmount: input.maturityAmount,
    totalBenefit,
    netGain,
    irrPct: irrPct === null ? null : irrPct * 100,
    cashflows,
    benefitAtMaturity,
    mfMaturity,
    mfWealthAdvantage,
    mfAdvantagePct,
    mfContributionToMatch,
    mfContributionRounded,
    policySchedule,
    mfMatchSchedule: mfSchedule(mfContributionRounded, ppt, term, R),
    mfSameSchedule: mfSchedule(input.annualPremium, ppt, term, R),
  };
}
