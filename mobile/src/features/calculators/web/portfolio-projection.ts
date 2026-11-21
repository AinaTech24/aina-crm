// Copied verbatim from src/lib/calculators/portfolio-projection.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Portfolio Projection — math engine.
 *
 * Projects a client's existing portfolio, a lumpsum added every year and a
 * running monthly SIP over N years at one assumed return. Two scenarios:
 *   • Current      — today's amounts kept flat.
 *   • Incremental  — the yearly lumpsum is raised by a fixed amount and the SIP
 *                    is raised by a fixed amount every year.
 *
 * CONVENTIONS (verified to the reference case: ₹25,00,000 portfolio, ₹2,00,000
 * a year (+₹50,000), SIP ₹25,000 (+₹5,000), 12%, 20 yrs → ₹6,32,51,914 vs
 * ₹9,95,74,779, every cell of the year table):
 *   • Existing portfolio: P0 · (1 + r)^y (annual compounding).
 *   • Yearly lumpsum: invested at the START of each year, annual compounding.
 *   • SIP: EFFECTIVE monthly rate m = (1 + r)^(1/12) − 1, paid at the START of
 *     each month (sip360 convention), computed month by month.
 *   • Incremental scenario — copied exactly from the reference behaviour:
 *       – the lumpsum is a FLAT A + ΔA every year (raised once, not each year);
 *       – the monthly SIP in year k (k = 1…N) is S + ΔS·k, i.e. the first
 *         raise already applies in year 1.
 *   • Annual investment: year 1 includes the existing portfolio.
 */

import { monthlyRate } from "./sip360";

export type PortfolioProjectionMode = "current" | "incremental";

export type PortfolioProjectionInput = {
  portfolioValue: number;
  annualLumpsum: number;
  annualLumpsumIncrease: number;
  monthlySip: number;
  sipIncrease: number;
  ratePct: number;
  years: number;
  mode: PortfolioProjectionMode;
};

export type PortfolioProjectionRow = {
  year: number;
  annualInvestment: number;
  cumulativeInvestment: number;
  fundValue: number;
  monthlySip: number;
};

export type PortfolioProjectionScenario = {
  components: { portfolio: number; annualLumpsum: number; sip: number; total: number };
  totalInvested: number;
  rows: PortfolioProjectionRow[];
};

export type PortfolioProjectionResult = {
  current: PortfolioProjectionScenario;
  incremental: PortfolioProjectionScenario | null;
  extraInvested: number;
  extraValue: number;
};

function project(
  p0: number,
  lumpsum: number,
  sipForYear: (k: number) => number,
  ratePct: number,
  years: number
): PortfolioProjectionScenario {
  const r = ratePct / 100;
  const m = monthlyRate(ratePct);
  let portfolio = p0;
  let lump = 0;
  let sip = 0;
  let cumulative = 0;
  const rows: PortfolioProjectionRow[] = [];
  for (let k = 1; k <= years; k++) {
    const monthly = sipForYear(k);
    portfolio = p0 * Math.pow(1 + r, k);
    lump = (lump + lumpsum) * (1 + r);
    for (let mo = 0; mo < 12; mo++) sip = (sip + monthly) * (1 + m);
    const annualInvestment = (k === 1 ? p0 : 0) + lumpsum + 12 * monthly;
    cumulative += annualInvestment;
    rows.push({ year: k, annualInvestment, cumulativeInvestment: cumulative, fundValue: portfolio + lump + sip, monthlySip: monthly });
  }
  if (years === 0) cumulative = p0;
  return {
    components: { portfolio, annualLumpsum: lump, sip, total: portfolio + lump + sip },
    totalInvested: cumulative,
    rows,
  };
}

export function portfolioProjection(input: PortfolioProjectionInput): PortfolioProjectionResult {
  const n = Math.max(0, Math.round(input.years));
  const p0 = Math.max(0, input.portfolioValue);
  const current = project(p0, input.annualLumpsum, () => input.monthlySip, input.ratePct, n);
  const incremental =
    input.mode === "incremental"
      ? project(
          p0,
          input.annualLumpsum + input.annualLumpsumIncrease,
          (k) => input.monthlySip + input.sipIncrease * k,
          input.ratePct,
          n
        )
      : null;
  return {
    current,
    incremental,
    extraInvested: incremental ? incremental.totalInvested - current.totalInvested : 0,
    extraValue: incremental ? incremental.components.total - current.components.total : 0,
  };
}
