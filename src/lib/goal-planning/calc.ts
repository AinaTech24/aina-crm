/**
 * Goal-planning math — pure formulas, no DB / no React.
 *
 * Conventions:
 *   r        annual return rate, decimal (e.g. 0.12 for 12 % p.a.)
 *   m        monthly rate, r/12
 *   n        number of months
 *   π        annual inflation, decimal (e.g. 0.06 for 6 % p.a.)
 *
 * Compounding: monthly. SIPs paid at month-end (ordinary annuity).
 *
 * Formulas
 *   Inflation-adjusted (future) target:
 *     T_future = T_today × (1 + π)^years
 *
 *   FV of an existing lumpsum:
 *     FV_lump = PV × (1 + m)^n
 *
 *   FV of a constant monthly SIP:
 *     FV_sip = P × ((1 + m)^n − 1) / m × (1 + m)
 *
 *   Constant SIP needed to reach Target (with no PV):
 *     P_req = Target × m / (((1 + m)^n − 1) × (1 + m))
 *
 *   Lumpsum needed today to reach Target (with no SIP):
 *     L_req = Target / (1 + m)^n
 *
 *   Step-up SIP — initial monthly P0 increased by g % each year. We solve for P0
 *   numerically (closed form is awkward with annual step-ups).
 */

export const DEFAULT_EXPECTED_RETURN_PCT = 12;
export const DEFAULT_INFLATION_PCT = 6;
export const DEFAULT_STEP_UP_PCT = 0;

/* ───────────────────────── Core formulas ───────────────────────── */

export function inflatedTarget(presentTarget: number, inflationPct: number, years: number): number {
  return presentTarget * Math.pow(1 + inflationPct / 100, years);
}

export function fvLumpsum(pv: number, annualReturnPct: number, months: number): number {
  const m = annualReturnPct / 100 / 12;
  return pv * Math.pow(1 + m, months);
}

export function fvSip(monthlySip: number, annualReturnPct: number, months: number): number {
  if (monthlySip <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  return monthlySip * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
}

/** Constant monthly SIP needed to hit `target` starting from `currentValue`. */
export function requiredSip(
  target: number,
  currentValue: number,
  annualReturnPct: number,
  months: number
): number {
  if (months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const shortfall = Math.max(0, target - lumpFV);
  if (shortfall === 0) return 0;
  return (shortfall * m) / ((Math.pow(1 + m, months) - 1) * (1 + m));
}

/** Lumpsum needed today to hit `target` with no SIP. */
export function requiredLumpsumToday(
  target: number,
  annualReturnPct: number,
  months: number
): number {
  if (months <= 0) return target;
  return target / Math.pow(1 + annualReturnPct / 100 / 12, months);
}

/**
 * FV of a step-up SIP: P0 increases by stepUpPct every 12 months.
 */
export function fvStepUpSip(
  initialMonthly: number,
  annualReturnPct: number,
  months: number,
  stepUpPct: number
): number {
  if (initialMonthly <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const s = stepUpPct / 100;
  const fullYears = Math.floor(months / 12);
  const remainderMonths = months - fullYears * 12;
  const fv1yr = ((Math.pow(1 + m, 12) - 1) / m) * (1 + m);

  let fv = 0;
  for (let k = 0; k < fullYears; k++) {
    const yearP = initialMonthly * Math.pow(1 + s, k);
    const yearsToCompound = fullYears - 1 - k;
    const growth = Math.pow(1 + m, yearsToCompound * 12 + remainderMonths);
    fv += yearP * fv1yr * growth;
  }
  if (remainderMonths > 0) {
    const finalP = initialMonthly * Math.pow(1 + s, fullYears);
    fv += fvSip(finalP, annualReturnPct, remainderMonths);
  }
  return fv;
}

/**
 * Initial monthly SIP (P0) for a step-up plan that reaches `target` given PV.
 * Solved by bisection.
 */
export function requiredStepUpSip(
  target: number,
  currentValue: number,
  annualReturnPct: number,
  months: number,
  stepUpPct: number
): number {
  if (months <= 0) return 0;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const need = Math.max(0, target - lumpFV);
  if (need === 0) return 0;
  const flatEst = requiredSip(target, currentValue, annualReturnPct, months);
  let lo = 0;
  let hi = Math.max(flatEst * 2, 100);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fv = fvStepUpSip(mid, annualReturnPct, months, stepUpPct);
    if (fv >= need) hi = mid;
    else lo = mid;
    if (hi - lo < 0.5) break;
  }
  return (lo + hi) / 2;
}

/* ───────────────────────── Months helper ───────────────────────── */

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/* ───────────────────────── Year-by-year projection ───────────────────────── */

export type ProjectionRow = {
  year: number;
  monthlySip: number;
  contributedThisYear: number;
  cumulativeContributed: number;
  endOfYearCorpus: number;
};

export function projectYearly(input: {
  currentValue: number;
  initialMonthlySip: number;
  annualReturnPct: number;
  stepUpPct?: number;
  months: number;
}): ProjectionRow[] {
  const m = input.annualReturnPct / 100 / 12;
  const s = (input.stepUpPct ?? 0) / 100;
  const years = Math.ceil(input.months / 12);
  let corpus = input.currentValue;
  let monthlySip = input.initialMonthlySip;
  let cumulative = 0;
  const rows: ProjectionRow[] = [];

  for (let y = 1; y <= years; y++) {
    const monthsThisYear = y === years ? input.months - (years - 1) * 12 : 12;
    if (monthsThisYear <= 0) break;
    let yearContrib = 0;
    for (let mo = 0; mo < monthsThisYear; mo++) {
      corpus = corpus * (1 + m) + monthlySip;
      yearContrib += monthlySip;
    }
    cumulative += yearContrib;
    rows.push({
      year: y,
      monthlySip,
      contributedThisYear: yearContrib,
      cumulativeContributed: cumulative,
      endOfYearCorpus: corpus,
    });
    monthlySip = monthlySip * (1 + s);
  }
  return rows;
}

/* ───────────────────────── Sensitivity ───────────────────────── */

export function sensitivitySipRates(
  target: number,
  currentValue: number,
  months: number,
  rates: number[] = [8, 10, 12, 15]
): Array<{ ratePct: number; sip: number; lumpsum: number; projectedFV: number }> {
  return rates.map((rate) => ({
    ratePct: rate,
    sip: requiredSip(target, currentValue, rate, months),
    lumpsum: requiredLumpsumToday(target, rate, months),
    projectedFV: fvLumpsum(currentValue, rate, months),
  }));
}

/* ───────────────────────── Combined "compute goal" ───────────────────────── */

export type GoalCalcInput = {
  /** Target amount in TODAY's money (will be inflation-adjusted). */
  presentTarget?: number;
  /** Target amount already in FUTURE money (skips inflation). */
  futureTarget?: number;
  currentValue: number;
  existingMonthlySip: number;
  monthsLeft: number;
  expectedReturnPct?: number;
  inflationPct?: number;
  stepUpPct?: number;
};

export type GoalCalcResult = {
  monthsLeft: number;
  yearsLeft: number;
  expectedReturnPct: number;
  inflationPct: number;
  stepUpPct: number;
  presentTarget: number;
  futureTarget: number;
  projectedLumpsumFV: number;
  projectedSipFV: number;
  projectedTotalFV: number;
  gapAmount: number;
  requiredMonthlySipTotal: number;
  requiredStepUpInitialSip: number;
  requiredLumpsumToday: number;
  additionalMonthlySipNeeded: number;
  /** Same key the DB enum uses */
  status: "not_started" | "on_track" | "behind_track" | "achieved";
};

/** Backwards-compatible single-call API used everywhere in the app. */
export function computeGoal(input: GoalCalcInput & { targetAmount?: number }): GoalCalcResult {
  // The legacy callers passed `targetAmount` (already in target-date money).
  // Map it to futureTarget so we don't double-inflate.
  const futureTarget =
    input.futureTarget ?? input.targetAmount ?? null;
  const presentTarget =
    input.presentTarget ?? (futureTarget == null ? 0 : undefined);

  const months = Math.max(0, Math.round(input.monthsLeft));
  const years = Math.max(0, months / 12);
  const expectedReturnPct = input.expectedReturnPct ?? DEFAULT_EXPECTED_RETURN_PCT;
  const inflationPct = input.inflationPct ?? DEFAULT_INFLATION_PCT;
  const stepUpPct = input.stepUpPct ?? DEFAULT_STEP_UP_PCT;

  const pT = presentTarget ?? input.presentTarget ?? 0;
  const fT =
    futureTarget != null
      ? futureTarget
      : inflatedTarget(pT, inflationPct, years);

  const pv = Math.max(0, input.currentValue);
  const sip = Math.max(0, input.existingMonthlySip);

  if (months === 0) {
    const gap = Math.max(0, fT - pv);
    return {
      monthsLeft: 0,
      yearsLeft: 0,
      expectedReturnPct,
      inflationPct,
      stepUpPct,
      presentTarget: pT,
      futureTarget: fT,
      projectedLumpsumFV: pv,
      projectedSipFV: 0,
      projectedTotalFV: pv,
      gapAmount: gap,
      requiredMonthlySipTotal: 0,
      requiredStepUpInitialSip: 0,
      requiredLumpsumToday: fT,
      additionalMonthlySipNeeded: 0,
      status: pv >= fT ? "achieved" : "behind_track",
    };
  }

  const projectedLumpsumFV = fvLumpsum(pv, expectedReturnPct, months);
  const projectedSipFV = fvSip(sip, expectedReturnPct, months);
  const projectedTotalFV = projectedLumpsumFV + projectedSipFV;

  const requiredMonthlySipTotal = requiredSip(fT, pv, expectedReturnPct, months);
  const requiredStepUpInitialSip =
    stepUpPct > 0
      ? requiredStepUpSip(fT, pv, expectedReturnPct, months, stepUpPct)
      : requiredMonthlySipTotal;
  const requiredLumpsumNow = requiredLumpsumToday(fT, expectedReturnPct, months);

  const additionalMonthlySipNeeded = Math.max(0, requiredMonthlySipTotal - sip);
  const gapAmount = Math.max(0, fT - projectedTotalFV);

  let status: GoalCalcResult["status"];
  if (pv === 0 && sip === 0) status = "not_started";
  else if (projectedTotalFV >= fT) status = "achieved";
  else status = sip >= requiredMonthlySipTotal * 0.9 ? "on_track" : "behind_track";

  return {
    monthsLeft: months,
    yearsLeft: years,
    expectedReturnPct,
    inflationPct,
    stepUpPct,
    presentTarget: pT,
    futureTarget: fT,
    projectedLumpsumFV,
    projectedSipFV,
    projectedTotalFV,
    gapAmount,
    requiredMonthlySipTotal,
    requiredStepUpInitialSip,
    requiredLumpsumToday: requiredLumpsumNow,
    additionalMonthlySipNeeded,
    status,
  };
}

/* ───────────────────────── Categories (display) ───────────────────────── */

export const GOAL_CATEGORIES = [
  ["retirement", "Retirement"],
  ["child_education", "Child Education"],
  ["child_marriage", "Child Marriage"],
  ["house", "House"],
  ["car", "Car"],
  ["vacation", "Vacation"],
  ["emergency_fund", "Emergency Fund"],
  ["wealth_creation", "Wealth Creation"],
  ["other", "Other"],
] as const;

export const CATEGORY_ALIASES: Record<string, string> = {
  education: "child_education",
  vehicle: "car",
  emergency: "emergency_fund",
  wedding: "child_marriage",
  wealth: "wealth_creation",
};

export function categoryLabel(slug: string): string {
  const canon = CATEGORY_ALIASES[slug] ?? slug;
  return GOAL_CATEGORIES.find(([k]) => k === canon)?.[1] ?? slug;
}
