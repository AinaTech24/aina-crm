// Copied verbatim from src/lib/calculators/stp-comprehensive.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * STP engine — every Systematic Transfer Plan calculator in the suite runs on
 * this one module (STP Comprehensive, Future Value of STP, SIP + STP, the STP /
 * SIP-STP target solvers and the two STP ready reckoners).
 *
 * A lumpsum sits in a debt fund (lower return); at the chosen frequency a slice
 * is transferred into an equity fund (higher return). Transfer rules:
 *   • "appreciation" — only the debt fund's GAIN of the period moves, so the
 *                      debt principal stays at the initial amount.
 *   • "fixed"        — a fixed transfer each period: a ₹ amount
 *                      (fixedBasis "amount") or a % of the INITIAL investment
 *                      (fixedBasis "pctOfInitial").
 *
 * CONVENTIONS — calibrated to the reference case studies to the rupee:
 *   • per-period rate = (1 + annual)^(1/periodsPerYear) − 1 (effective);
 *   • each period BOTH funds grow first, then the transfer is taken at period
 *     END (month-end for the monthly calculators — note this differs from a
 *     SIP, which is paid at the START of the month: sip360.fvSip);
 *   • a fixed transfer happens only when the debt fund (after that period's
 *     growth) holds at least one full transfer. When it holds less, NOTHING
 *     moves — the remainder is never swept and keeps earning the debt return
 *     to the horizon. (Until 2026-11 this engine swept the last partial
 *     transfer via min(T, debt); the reference sheets do not — see the
 *     ₹50,000/month case below, whose year-5 transfer is exactly ₹4,00,000.)
 *   • a cap on the number of transfers is optional; without one, transfers run
 *     for the whole period (or until the debt fund cannot cover one).
 *
 *   Worked examples (tests/ms-calc-b.test.ts):
 *     ₹25,00,000 · debt 5% · equity 12% · fixed ₹50,000 weekly × 50 · 10 yrs →
 *       debt ₹95,911 · equity ₹73,48,509 · total ₹74,44,420 · 11.53%.
 *     ₹25,00,000 · fixed ₹50,000 monthly until exhausted · 10 yrs →
 *       debt ₹1,586 · equity ₹67,21,922 · total ₹67,23,507 · 10.40%.
 *     ₹10,00,000 · appreciation · debt 5% · equity 12% · 15 yrs → ₹29,20,778.
 */

import { fvSip } from "./sip360";

export type StpTransferMode = "appreciation" | "fixed";
export type StpFixedBasis = "amount" | "pctOfInitial";
export type StpFrequency = "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "halfyearly" | "annually";

export const STP_FREQUENCIES: { value: StpFrequency; label: string; perYear: number }[] = [
  { value: "daily", label: "Daily", perYear: 365 },
  { value: "weekly", label: "Weekly", perYear: 52 },
  { value: "fortnightly", label: "Fortnightly", perYear: 26 },
  { value: "monthly", label: "Monthly", perYear: 12 },
  { value: "quarterly", label: "Quarterly", perYear: 4 },
  { value: "halfyearly", label: "Half-yearly", perYear: 2 },
  { value: "annually", label: "Annually", perYear: 1 },
];

export type StpComprehensiveInput = {
  initialInvestment: number;
  debtReturnPct: number;
  equityReturnPct: number;
  transferMode: StpTransferMode;
  frequency: StpFrequency;
  /** Cap on the number of transfers. null / undefined = no cap. */
  numInstallments?: number | null;
  /** Fixed mode: what the fixed transfer is (default "amount"). */
  fixedBasis?: StpFixedBasis;
  fixedTransferAmount: number; // fixed mode, basis "amount"
  /** Fixed mode, basis "pctOfInitial": % of the initial investment per transfer. */
  fixedTransferPct?: number;
  totalMonths: number; // total investment period in months
};

export type StpYearRow = {
  year: number;
  debtBeginning: number;
  transferredToEquity: number;
  equityBeginning: number;
  equityEnd: number;
  totalEnd: number;
  annualisedReturnPct: number;
};

export type StpComprehensiveResult = {
  periodsPerYear: number;
  totalPeriods: number;
  /** Fixed mode: each transfer (₹). Appreciation: the first period's debt gain. */
  transferAmount: number;
  transfersMade: number;
  /** Fixed mode: the first period whose transfer was skipped for want of debt (null if none). */
  exhaustedAtPeriod: number | null;
  totalTransferred: number;
  debtFinalValue: number;
  equityFinalValue: number;
  totalFinalValue: number;
  annualisedReturnPct: number;
  schedule: StpYearRow[];
};

const perYearOf = (f: StpFrequency) => STP_FREQUENCIES.find((x) => x.value === f)?.perYear ?? 12;

/** The fixed transfer (₹) the inputs describe. */
export function fixedTransferOf(input: StpComprehensiveInput): number {
  if (input.fixedBasis === "pctOfInitial") return (Math.max(0, input.initialInvestment) * Math.max(0, input.fixedTransferPct ?? 0)) / 100;
  return Math.max(0, input.fixedTransferAmount);
}

export function computeStpComprehensive(input: StpComprehensiveInput): StpComprehensiveResult {
  const ppy = perYearOf(input.frequency);
  const totalYears = Math.max(0, input.totalMonths) / 12;
  const totalPeriods = Math.max(1, Math.round(totalYears * ppy));
  const rd = Math.pow(1 + input.debtReturnPct / 100, 1 / ppy) - 1;
  const re = Math.pow(1 + input.equityReturnPct / 100, 1 / ppy) - 1;
  const cap = input.numInstallments == null ? Infinity : Math.max(0, Math.round(input.numInstallments));
  const fixedT = fixedTransferOf(input);
  const initial = Math.max(0, input.initialInvestment);

  let debt = initial;
  let equity = 0;
  let totalTransferred = 0;
  let exhaustedAtPeriod: number | null = null;

  // Year-boundary snapshots.
  const schedule: StpYearRow[] = [];
  let yearDebtBegin = debt;
  let yearEquityBegin = equity;
  let yearTransferred = 0;
  let transfersDone = 0;

  for (let p = 1; p <= totalPeriods; p++) {
    const debtBefore = debt;
    debt = debt * (1 + rd);
    equity = equity * (1 + re);

    // Transfer at period end, only while instalments remain.
    if (transfersDone < cap && debt > 0) {
      let t: number | null;
      if (input.transferMode === "appreciation") {
        t = Math.max(0, debt - debtBefore); // the period's debt gain
      } else if (debt >= fixedT * (1 - 1e-12)) {
        // Relative tolerance: keeps the rule scale-free, so "% of initial"
        // results stay exactly linear in the initial investment.
        t = Math.min(fixedT, debt);
      } else {
        t = null; // less than one transfer left: skip it, never sweep
        if (exhaustedAtPeriod == null) exhaustedAtPeriod = p;
      }
      if (t != null) {
        debt -= t;
        equity += t;
        totalTransferred += t;
        yearTransferred += t;
        transfersDone++;
      }
    }

    // Year boundary → snapshot.
    if (p % ppy === 0 || p === totalPeriods) {
      const yr = Math.ceil(p / ppy);
      const totalEnd = debt + equity;
      const elapsedYears = p / ppy;
      const annualised =
        initial > 0 && elapsedYears > 0 ? (Math.pow(totalEnd / initial, 1 / elapsedYears) - 1) * 100 : 0;
      schedule.push({
        year: yr,
        debtBeginning: yearDebtBegin,
        transferredToEquity: yearTransferred,
        equityBeginning: yearEquityBegin,
        equityEnd: equity,
        totalEnd,
        annualisedReturnPct: annualised,
      });
      yearDebtBegin = debt;
      yearEquityBegin = equity;
      yearTransferred = 0;
    }
  }

  const totalFinalValue = debt + equity;
  const annualisedReturnPct =
    initial > 0 && totalYears > 0 ? (Math.pow(totalFinalValue / initial, 1 / totalYears) - 1) * 100 : 0;

  return {
    periodsPerYear: ppy,
    totalPeriods,
    transferAmount: input.transferMode === "appreciation" ? initial * rd : fixedT,
    transfersMade: transfersDone,
    exhaustedAtPeriod,
    totalTransferred,
    debtFinalValue: debt,
    equityFinalValue: equity,
    totalFinalValue,
    annualisedReturnPct,
    schedule,
  };
}

/* ───────────── monthly STP (the single-purpose calculators) ───────────── */

/** The three monthly transfer rules the single-purpose STP calculators offer. */
export type MonthlyStpMode = "appreciation" | "fixedAmount" | "fixedPct";

export type MonthlyStpInput = {
  initial: number;
  years: number;
  debtPct: number;
  equityPct: number;
  mode: MonthlyStpMode;
  /** ₹ per month, mode "fixedAmount". */
  fixedAmount?: number;
  /** % of the initial investment per month, mode "fixedPct". */
  fixedPct?: number;
};

/** Monthly STP, month-end transfers, no instalment cap (runs until the debt
 *  fund cannot cover a fixed transfer). */
export function computeMonthlyStp(i: MonthlyStpInput): StpComprehensiveResult {
  return computeStpComprehensive({
    initialInvestment: i.initial,
    debtReturnPct: i.debtPct,
    equityReturnPct: i.equityPct,
    transferMode: i.mode === "appreciation" ? "appreciation" : "fixed",
    fixedBasis: i.mode === "fixedPct" ? "pctOfInitial" : "amount",
    fixedTransferAmount: i.fixedAmount ?? 0,
    fixedTransferPct: i.fixedPct ?? 0,
    frequency: "monthly",
    numInstallments: null,
    totalMonths: Math.max(0, Math.round(i.years * 12)),
  });
}

/** Total value at the horizon of a monthly STP. */
export function monthlyStpValue(i: MonthlyStpInput): number {
  if (Math.round(i.years * 12) <= 0) return Math.max(0, i.initial);
  return computeMonthlyStp(i).totalFinalValue;
}

/** Year-end total (debt + equity) for years 1..years, index 0 = year 1. */
function stpYearTotals(i: MonthlyStpInput): number[] {
  return computeMonthlyStp(i).schedule.map((r) => r.totalEnd);
}

/* ───────────── STP required for a target (#47) ───────────── */

export type StpTargetInput = Omit<MonthlyStpInput, "initial"> & { target: number };

export type StpTargetResult = {
  /** Initial investment required (unrounded); NaN when no amount can reach the target. */
  initialRequired: number;
  /** The projection run with the unrounded initial investment. */
  projection: StpComprehensiveResult | null;
};

/**
 * Initial lumpsum to park in the debt fund so the STP reaches `target`.
 *   • appreciation / fixed %: the whole projection scales with the lumpsum, so
 *     L = target ÷ FV(L = 1).
 *   • fixed ₹ amount: not linear (the number of transfers depends on L), so FV
 *     is solved by bisection on L. FV only rises with L (a larger lumpsum can
 *     only add transfers into the faster fund), so the smallest L that reaches
 *     the target is found; when the target falls in the jump an extra transfer
 *     makes, the projection lands a few rupees above it.
 */
export function stpRequiredForTarget(i: StpTargetInput): StpTargetResult {
  const target = Math.max(0, i.target);
  if (target <= 0 || i.years <= 0) return { initialRequired: 0, projection: null };
  let L: number;
  if (i.mode === "fixedAmount") {
    const fv = (x: number) => monthlyStpValue({ ...i, initial: x });
    let lo = 0;
    let hi = target;
    let guard = 0;
    while (fv(hi) < target && guard++ < 60) hi *= 2;
    if (fv(hi) < target) return { initialRequired: NaN, projection: null };
    for (let k = 0; k < 200 && hi - lo > 1e-7; k++) {
      const mid = (lo + hi) / 2;
      if (fv(mid) >= target) hi = mid;
      else lo = mid;
    }
    L = hi;
  } else {
    const unit = monthlyStpValue({ ...i, initial: 1 });
    if (!(unit > 0)) return { initialRequired: NaN, projection: null };
    L = target / unit;
  }
  return { initialRequired: L, projection: computeMonthlyStp({ ...i, initial: L }) };
}

/* ───────────── ready reckoners (#45 future value, #46 need) ───────────── */

export type StpScenario = { debtPct: number; equityPct: number };

export type StpReckonerInput = {
  /** "fv": amount = initial investment → future value.
   *  "need": amount = target → initial investment required. */
  kind: "fv" | "need";
  amount: number;
  /** Debt and equity rates are PAIRED by position into scenarios. */
  scenarios: StpScenario[];
  years: number[];
  mode: "appreciation" | "fixedPct";
  fixedPct?: number;
};

/** Grid in rupees: rows = scenarios, columns = years. Both modes are linear in
 *  the lumpsum, so "need" is the amount divided by the per-rupee FV. */
export function stpReckonerGrid(i: StpReckonerInput): number[][] {
  return i.scenarios.map((s) =>
    i.years.map((y) => {
      const unit = monthlyStpValue({
        initial: 1, years: y, debtPct: s.debtPct, equityPct: s.equityPct, mode: i.mode, fixedPct: i.fixedPct,
      });
      if (i.kind === "fv") return i.amount * unit;
      return unit > 0 ? i.amount / unit : NaN;
    })
  );
}

/* ───────────── SIP + STP (#12 future value, #42 target) ───────────── */

/*
 * A monthly SIP into an equity fund, plus a lumpsum in a debt fund whose
 * monthly gain is swept (capital appreciation STP) into an equity fund. The SIP
 * leg is sip360.fvSip — paid at month START at its own rate; the STP leg moves
 * at month END. The two timings differ on purpose (both reproduce the reference
 * sheets). Totals are summed from the unrounded legs.
 */

export type SipStpRow = {
  year: number;
  annualInvestment: number;
  cumulativeInvestment: number;
  sipValue: number;
  stpValue: number;
  total: number;
};

export type SipStpFvInput = {
  monthlySip: number;
  sipRatePct: number;
  stpLumpsum: number;
  debtPct: number;
  equityPct: number;
  years: number;
};

export type SipStpFvResult = {
  sipValue: number;
  stpDebtValue: number;
  stpEquityValue: number;
  stpValue: number;
  total: number;
  totalInvested: number;
  /** The STP's monthly transfer (the debt fund's monthly gain). */
  monthlyTransfer: number;
  rows: SipStpRow[];
};

export function computeSipStpFv(i: SipStpFvInput): SipStpFvResult {
  const years = Math.max(0, Math.round(i.years));
  const S = Math.max(0, i.monthlySip);
  const L = Math.max(0, i.stpLumpsum);
  const stpInput: MonthlyStpInput = { initial: L, years, debtPct: i.debtPct, equityPct: i.equityPct, mode: "appreciation" };
  const stp = computeMonthlyStp(stpInput);
  const stpTotals = years > 0 ? stp.schedule.map((r) => r.totalEnd) : [];

  const rows: SipStpRow[] = [];
  let cumulative = 0;
  for (let y = 1; y <= years; y++) {
    const annualInvestment = 12 * S + (y === 1 ? L : 0);
    cumulative += annualInvestment;
    const sipValue = fvSip(S, i.sipRatePct, y * 12);
    const stpValue = stpTotals[y - 1] ?? L;
    rows.push({ year: y, annualInvestment, cumulativeInvestment: cumulative, sipValue, stpValue, total: sipValue + stpValue });
  }

  const sipValue = fvSip(S, i.sipRatePct, years * 12);
  const stpValue = years > 0 ? stp.totalFinalValue : L;
  return {
    sipValue,
    stpDebtValue: years > 0 ? stp.debtFinalValue : L,
    stpEquityValue: years > 0 ? stp.equityFinalValue : 0,
    stpValue,
    total: sipValue + stpValue,
    totalInvested: L + 12 * S * years,
    monthlyTransfer: stp.transferAmount,
    rows,
  };
}

export type SipStpTargetInput = {
  target: number;
  years: number;
  /** "sip": solve the monthly SIP for a given STP lumpsum; "stp": the reverse. */
  solve: "sip" | "stp";
  stpLumpsum: number;
  monthlySip: number;
  debtPct: number;
  equityPct: number;
  sipRatePct: number;
};

export type SipStpTargetResult = {
  /** Monthly SIP required (solve "sip") or the given SIP. */
  monthlySip: number;
  /** STP lumpsum required (solve "stp") or the given lumpsum. */
  stpLumpsum: number;
  /** The given leg alone already reaches the target (the solved one is 0). */
  overshoots: boolean;
  projection: SipStpFvResult;
};

export function computeSipStpForTarget(i: SipStpTargetInput): SipStpTargetResult {
  const years = Math.max(0, Math.round(i.years));
  const months = years * 12;
  const target = Math.max(0, i.target);
  let S = Math.max(0, i.monthlySip);
  let L = Math.max(0, i.stpLumpsum);
  let overshoots = false;
  if (i.solve === "sip") {
    const stpN = years > 0 ? stpYearTotals({ initial: L, years, debtPct: i.debtPct, equityPct: i.equityPct, mode: "appreciation" })[years - 1] : L;
    const perRupee = fvSip(1, i.sipRatePct, months);
    const raw = perRupee > 0 ? (target - stpN) / perRupee : NaN;
    overshoots = raw < 0;
    S = Number.isFinite(raw) ? Math.max(0, raw) : NaN;
  } else {
    const perRupee = monthlyStpValue({ initial: 1, years, debtPct: i.debtPct, equityPct: i.equityPct, mode: "appreciation" });
    const raw = perRupee > 0 ? (target - fvSip(S, i.sipRatePct, months)) / perRupee : NaN;
    overshoots = raw < 0;
    L = Number.isFinite(raw) ? Math.max(0, raw) : NaN;
  }
  const projection = computeSipStpFv({
    monthlySip: Number.isFinite(S) ? S : 0,
    sipRatePct: i.sipRatePct,
    stpLumpsum: Number.isFinite(L) ? L : 0,
    debtPct: i.debtPct,
    equityPct: i.equityPct,
    years,
  });
  return { monthlySip: S, stpLumpsum: L, overshoots, projection };
}
