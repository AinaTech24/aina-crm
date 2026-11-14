/**
 * Goal-planning math — a faithful RN port of src/lib/goal-planning/calc.ts.
 * Pure formulas, no DB / no React. SIPs are annuity-DUE (month-START, note the
 * trailing ×(1+m)); the 0% case is the linear limit. Keep these IN SYNC with the
 * server so on-screen numbers match the saved goal (the live calculator uses the
 * RAW expected return; the server applies the glide path — a small, intentional
 * difference, same as web).
 */

export const DEFAULT_EXPECTED_RETURN_PCT = 12;
export const DEFAULT_INFLATION_PCT = 6;

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
  if (m === 0) return monthlySip * months;
  return monthlySip * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
}

export function requiredSip(target: number, currentValue: number, annualReturnPct: number, months: number): number {
  if (months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const shortfall = Math.max(0, target - lumpFV);
  if (shortfall === 0) return 0;
  if (m === 0) return shortfall / months;
  return (shortfall * m) / ((Math.pow(1 + m, months) - 1) * (1 + m));
}

export function requiredLumpsumToday(target: number, annualReturnPct: number, months: number): number {
  if (months <= 0) return target;
  return target / Math.pow(1 + annualReturnPct / 100 / 12, months);
}

export function fvStepUpSip(initialMonthly: number, annualReturnPct: number, months: number, stepUpPct: number): number {
  if (initialMonthly <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const s = stepUpPct / 100;
  const fullYears = Math.floor(months / 12);
  const remainderMonths = months - fullYears * 12;
  if (m === 0) {
    let flat = 0;
    for (let k = 0; k < fullYears; k++) flat += initialMonthly * Math.pow(1 + s, k) * 12;
    if (remainderMonths > 0) flat += initialMonthly * Math.pow(1 + s, fullYears) * remainderMonths;
    return flat;
  }
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

export function requiredStepUpSip(target: number, currentValue: number, annualReturnPct: number, months: number, stepUpPct: number): number {
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

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export type GoalStatus = "not_started" | "on_track" | "behind_track" | "achieved";

/**
 * Where a goal stands, from the money and the projection (web goalTier, 098b73eb):
 *   achieved   what is linked TODAY already covers the target
 *   on_track   projected value at the target date >= target
 *   behind     projected at least GOAL_BEHIND_FLOOR_PCT % of the target
 *   off_track  projected below that (including nothing linked and no SIP)
 * A projection is an assumption, not money: until the money is there the best a
 * goal can be is On track.
 */
export type GoalTier = "achieved" | "on_track" | "behind" | "off_track";

export const GOAL_TIER_LABEL: Record<GoalTier, string> = {
  achieved: "Achieved",
  on_track: "On track",
  behind: "Behind",
  off_track: "Off track",
};

/** Below this share of the target (projected), a goal is Off track, not Behind. */
export const GOAL_BEHIND_FLOOR_PCT = 75;

export function goalTier(currentValue: number, projectedValue: number, target: number): GoalTier {
  if (target > 0 && currentValue >= target) return "achieved";
  if (projectedValue >= target) return "on_track";
  const pct = target > 0 ? (projectedValue / target) * 100 : 0;
  return pct >= GOAL_BEHIND_FLOOR_PCT ? "behind" : "off_track";
}

export interface GoalComputation {
  futureTarget: number;
  months: number;
  years: number;
  projectedTotalFV: number;
  requiredMonthlySipTotal: number;
  requiredStepUpInitialSip: number;
  requiredLumpsumToday: number;
  additionalMonthlySipNeeded: number;
  gapAmount: number;
  /** Projected value at the target date as a % of the target (can exceed 100). */
  projectedPct: number;
  /** Achieved / On track / Behind / Off track — see goalTier(). */
  tier: GoalTier;
  /** The DB enum, derived from `tier`: "behind_track" covers Behind and Off track. */
  status: GoalStatus;
}

/** The single call used everywhere — mirrors calc.ts computeGoal exactly. */
export function computeGoal(input: {
  presentTarget?: number;
  futureTarget?: number;
  currentValue: number;
  existingMonthlySip: number;
  monthsLeft: number;
  expectedReturnPct?: number;
  inflationPct?: number;
  stepUpPct?: number;
}): GoalComputation {
  const ret = input.expectedReturnPct ?? DEFAULT_EXPECTED_RETURN_PCT;
  const infl = input.inflationPct ?? DEFAULT_INFLATION_PCT;
  const stepUpPct = input.stepUpPct ?? 0;
  const months = Math.max(0, Math.round(input.monthsLeft));
  const years = months / 12;
  const fT = input.futureTarget != null ? input.futureTarget : inflatedTarget(input.presentTarget ?? 0, infl, years);
  const pv = Math.max(0, input.currentValue);
  const sip = Math.max(0, input.existingMonthlySip);

  if (months === 0) {
    const gap = Math.max(0, fT - pv);
    const tier = goalTier(pv, pv, fT);
    return {
      futureTarget: fT, months, years, projectedTotalFV: pv,
      requiredMonthlySipTotal: 0, requiredStepUpInitialSip: 0, requiredLumpsumToday: fT,
      additionalMonthlySipNeeded: 0, gapAmount: gap,
      projectedPct: fT > 0 ? (pv / fT) * 100 : 0,
      tier,
      status: tier === "achieved" ? "achieved" : "behind_track",
    };
  }

  const projectedTotalFV = fvLumpsum(pv, ret, months) + fvSip(sip, ret, months);
  const reqTotal = requiredSip(fT, pv, ret, months);
  const reqStepUp = stepUpPct > 0 ? requiredStepUpSip(fT, pv, ret, months, stepUpPct) : reqTotal;
  const reqLump = requiredLumpsumToday(fT, ret, months);
  const additional = Math.max(0, reqTotal - sip);
  const gap = Math.max(0, fT - projectedTotalFV);

  // Achieved only when the money linked today covers the target (web 098b73eb);
  // a projection that clears it is On track.
  const tier = goalTier(pv, projectedTotalFV, fT);
  let status: GoalStatus;
  if (tier === "achieved") status = "achieved";
  else if (pv === 0 && sip === 0) status = "not_started";
  else if (tier === "on_track") status = "on_track";
  else status = "behind_track";

  return {
    futureTarget: fT, months, years, projectedTotalFV,
    requiredMonthlySipTotal: reqTotal, requiredStepUpInitialSip: reqStepUp, requiredLumpsumToday: reqLump,
    additionalMonthlySipNeeded: additional, gapAmount: gap,
    projectedPct: fT > 0 ? (projectedTotalFV / fT) * 100 : 0,
    tier, status,
  };
}

export interface YearRow { year: number; monthlySip: number; contributedThisYear: number; cumulativeContributed: number; endOfYearCorpus: number }

/** Year-by-year projection — the web's projectYearly, unrounded (the screen formats). */
export function projectYearly(p: { currentValue: number; initialMonthlySip: number; annualReturnPct: number; stepUpPct?: number; months: number }): YearRow[] {
  const m = p.annualReturnPct / 100 / 12;
  const step = (p.stepUpPct ?? 0) / 100;
  const years = Math.ceil(p.months / 12);
  let corpus = p.currentValue;
  let monthlySip = p.initialMonthlySip;
  let cumulative = 0;
  const rows: YearRow[] = [];
  for (let y = 1; y <= years; y++) {
    const monthsThisYear = y === years ? p.months - (years - 1) * 12 : 12;
    if (monthsThisYear <= 0) break;
    let contributedThisYear = 0;
    for (let mo = 0; mo < monthsThisYear; mo++) {
      corpus = corpus * (1 + m) + monthlySip;
      contributedThisYear += monthlySip;
    }
    cumulative += contributedThisYear;
    rows.push({ year: y, monthlySip, contributedThisYear, cumulativeContributed: cumulative, endOfYearCorpus: corpus });
    monthlySip = monthlySip * (1 + step);
  }
  return rows;
}

export interface SensitivityRow { ratePct: number; sip: number; lumpsum: number; projectedFV: number }

/** Required SIP / lumpsum / projected FV across a set of return assumptions. */
export function sensitivitySipRates(target: number, currentValue: number, months: number, rates: number[] = [8, 10, 12, 15]): SensitivityRow[] {
  return rates.map((ratePct) => ({
    ratePct,
    sip: requiredSip(target, currentValue, ratePct, months),
    lumpsum: requiredLumpsumToday(target, ratePct, months),
    projectedFV: fvLumpsum(currentValue, ratePct, months),
  }));
}
