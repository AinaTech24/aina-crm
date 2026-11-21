// Copied verbatim from src/lib/calculators/ppf.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Public Provident Fund (PPF) — maturity and year-by-year balance.
 *
 * Rules (PPF Scheme, 2019, Ministry of Finance notification G.S.R. 915(E)):
 *  - Deposits of at least ₹500 and at most ₹1,50,000 in a financial year. An
 *    excess earns no interest and is refunded, so it is left out here and
 *    flagged; a year below ₹500 is flagged (the account becomes discontinued
 *    until revived with the ₹500 arrears and a ₹50 fee).
 *  - Interest is worked out on the lowest balance between the 5th and the end
 *    of each month and credited once a year (31 March), so it compounds
 *    annually. A deposit made by 5 April earns interest for the whole year —
 *    the assumption here: interest = (opening + deposit) × rate.
 *  - The account matures after 15 full financial years and can be extended in
 *    blocks of 5 years, each WITH contributions (Form H / Form 4) or WITHOUT
 *    (the balance keeps earning interest).
 *  - The rate is set by the government each quarter; one rate (7.1%, unchanged
 *    since April 2020) is applied to every year, and it is editable.
 *
 * Annual compounding of a fixed yearly deposit D at rate i for n years is the
 * annuity-due D·((1+i)^n − 1)/i·(1+i) — ₹1,50,000 a year for 15 years at 7.1%
 * matures at ₹40,68,209.
 */

import { formatMoney } from "./format";

export const PPF_MIN_DEPOSIT = 500;
export const PPF_MAX_DEPOSIT = 150_000;
export const PPF_TERM_YEARS = 15;
export const PPF_EXTENSION_YEARS = 5;
export const PPF_DEFAULT_RATE_PCT = 7.1;

export type PpfExtension = { withContributions: boolean };

export type PpfInput = {
  mode: "fixed" | "variable";
  /** Fixed mode: the same deposit every contribution year. */
  yearlyAmount: number;
  /** Variable mode: deposit for year 1, 2, …; a missing year is ₹0. */
  amounts: number[];
  ratePct: number;
  /** 5-year extension blocks after the 15-year term, in order. */
  extensions: PpfExtension[];
};

export type PpfIssue = { year: number; kind: "below_min" | "above_max" | "zero"; message: string };

export type PpfRow = {
  year: number;
  phase: "term" | "extension";
  /** 1-based extension block number for extension years, else 0. */
  block: number;
  contributing: boolean;
  opening: number;
  deposit: number;
  interest: number;
  closing: number;
};

export type PpfResult = {
  years: number;
  rows: PpfRow[];
  totalDeposited: number;
  totalInterest: number;
  maturity: number;
  /** Balance at the end of the 15-year term (before any extension). */
  termMaturity: number;
  issues: PpfIssue[];
};

function inr(n: number): string {
  return formatMoney(n, { scale: "full" });
}

export function ppfCalc(input: PpfInput): PpfResult {
  const i = input.ratePct / 100;
  const years = PPF_TERM_YEARS + PPF_EXTENSION_YEARS * input.extensions.length;
  const rows: PpfRow[] = [];
  const issues: PpfIssue[] = [];
  let bal = 0;
  let termMaturity = 0;
  for (let y = 1; y <= years; y++) {
    const block = y > PPF_TERM_YEARS ? Math.ceil((y - PPF_TERM_YEARS) / PPF_EXTENSION_YEARS) : 0;
    const contributing = block === 0 || input.extensions[block - 1].withContributions;
    let deposit = 0;
    if (contributing) {
      const asked = Math.max(0, input.mode === "fixed" ? input.yearlyAmount : input.amounts[y - 1] ?? 0);
      deposit = Math.min(asked, PPF_MAX_DEPOSIT);
      if (asked > PPF_MAX_DEPOSIT) {
        issues.push({ year: y, kind: "above_max", message: `Year ${y}: ${inr(asked)} is above the ₹1,50,000 yearly limit — only ₹1,50,000 is counted.` });
      } else if (asked === 0) {
        issues.push({ year: y, kind: "zero", message: `Year ${y}: no deposit — the account is discontinued until revived (₹500 a year of arrears + ₹50 fee).` });
      } else if (asked < PPF_MIN_DEPOSIT) {
        issues.push({ year: y, kind: "below_min", message: `Year ${y}: ${inr(asked)} is below the ₹500 yearly minimum.` });
      }
    }
    const opening = bal;
    const interest = (opening + deposit) * i;
    bal = opening + deposit + interest;
    rows.push({ year: y, phase: block === 0 ? "term" : "extension", block, contributing, opening, deposit, interest, closing: bal });
    if (y === PPF_TERM_YEARS) termMaturity = bal;
  }
  const totalDeposited = rows.reduce((s, r) => s + r.deposit, 0);
  return { years, rows, totalDeposited, totalInterest: bal - totalDeposited, maturity: bal, termMaturity, issues };
}
