/**
 * SIP & lumpsum suite — math engine for the stand-alone future-value and
 * "required for a target" calculators:
 *
 *   • lumpsumFv            — FV of a one-time investment, 1–2 scenarios
 *   • lumpsumPlusSipFv     — lumpsum + monthly SIP, a return rate per leg
 *   • sipFv                — monthly SIP, optional ₹ or % yearly step-up
 *   • stepUpSipFv          — %-step-up SIP, year-wise instalments and values
 *   • limitedSipFv         — SIP for S years, then held for D more years
 *   • limitedSipNeed       — SIP needed for a target with a limited SIP + deferment
 *   • stepUpSipForTarget   — starting step-up SIP needed for a target
 *   • sipForTarget         — SIP needed for a target (+ step-up, cost of delay)
 *   • sipLumpsumForTarget  — SIP for a given lumpsum, or lumpsum for a given SIP
 *   • lumpsumForTarget     — one-time amount needed for a target, 1–2 scenarios
 *
 * CONVENTION — the same as sip360.ts (whose primitives this module reuses):
 *   effective monthly rate m = (1 + annual)^(1/12) − 1, SIPs paid at the START
 *   of each month (annuity-due), lumpsums compounding annually (identical to
 *   the effective-monthly rate over whole years). Periods are WHOLE years — the
 *   reference calculators accept whole years only, and the step-up loops count
 *   months as years × 12.
 *
 * ROUNDING — every figure is kept unrounded; only the screen rounds. Annual
 * investment and totals are built from the UNROUNDED monthly SIP (e.g.
 * ₹10,505.716 × 12 = ₹1,26,069, not ₹10,506 × 12 = ₹1,26,072). These rules
 * reproduce the reference case studies to the rupee
 * (tests/ms-calc-a2.test.ts).
 *
 * Not for the Goal Calculator's month-END SIP: that convention lives in
 * goal-planner.ts. Never import lib/goal-planning/calc (nominal r/12) here.
 */

import { fvLumpsum, fvSip, fvStepUpSip, requiredSip, stepUpInvested } from "./sip360";
import { fvStepUpAmountSip, stepUpAmountInvested } from "./stepup-reckoner";

/** Whole, non-negative years. */
export function wholeYears(years: number): number {
  return Number.isFinite(years) ? Math.max(0, Math.round(years)) : 0;
}

/** Rates of the scenarios actually in use (scenario 2 is optional). */
export function scenarioRates(r1: number, r2: number | null | undefined): number[] {
  return r2 == null || !Number.isFinite(r2) ? [r1] : [r1, r2];
}

/** FV after `years` whole years of a lumpsum at an annual rate. */
function growLumpsum(amount: number, ratePct: number, years: number): number {
  return fvLumpsum(amount, ratePct, years * 12);
}

/* ───────────────────────── #9 Lumpsum FV ───────────────────────── */

export type LumpsumFvResult = {
  years: number;
  invested: number;
  fv: number[];
  rows: { year: number; investment: number; values: number[] }[];
};

export function lumpsumFv(input: { amount: number; years: number; ratesPct: number[] }): LumpsumFvResult {
  const n = wholeYears(input.years);
  const rows: LumpsumFvResult["rows"] = [];
  for (let y = 1; y <= n; y++) {
    rows.push({
      year: y,
      investment: y === 1 ? input.amount : 0,
      values: input.ratesPct.map((r) => growLumpsum(input.amount, r, y)),
    });
  }
  return {
    years: n,
    invested: input.amount,
    fv: input.ratesPct.map((r) => growLumpsum(input.amount, r, n)),
    rows,
  };
}

/* ───────────────────── #10 Lumpsum + SIP FV ───────────────────── */

export type LegRow = {
  year: number;
  /** Money put in during the year (year 1 includes the lumpsum). */
  annual: number;
  cumulative: number;
  sipValue: number;
  lumpsumValue: number;
  total: number;
};

/** Year-wise SIP leg + lumpsum leg projection, each at its own rate. */
function legRows(monthlySip: number, sipPct: number, lumpsum: number, lumpsumPct: number, n: number): LegRow[] {
  const rows: LegRow[] = [];
  let cumulative = 0;
  for (let y = 1; y <= n; y++) {
    const annual = monthlySip * 12 + (y === 1 ? lumpsum : 0);
    cumulative += annual;
    const sipValue = fvSip(monthlySip, sipPct, y * 12);
    const lumpsumValue = lumpsum > 0 ? growLumpsum(lumpsum, lumpsumPct, y) : 0;
    rows.push({ year: y, annual, cumulative, sipValue, lumpsumValue, total: sipValue + lumpsumValue });
  }
  return rows;
}

export type LumpsumPlusSipResult = {
  years: number;
  invested: number;
  sipFv: number;
  lumpsumFv: number;
  total: number;
  rows: LegRow[];
};

export function lumpsumPlusSipFv(input: {
  monthlySip: number;
  sipPct: number;
  lumpsum: number;
  lumpsumPct: number;
  years: number;
}): LumpsumPlusSipResult {
  const n = wholeYears(input.years);
  const sip = Math.max(0, input.monthlySip);
  const ls = Math.max(0, input.lumpsum);
  const sipFvValue = fvSip(sip, input.sipPct, n * 12);
  const lsFv = ls > 0 ? growLumpsum(ls, input.lumpsumPct, n) : 0;
  return {
    years: n,
    invested: ls + sip * 12 * n,
    sipFv: sipFvValue,
    lumpsumFv: lsFv,
    total: sipFvValue + lsFv,
    rows: legRows(sip, input.sipPct, ls, input.lumpsumPct, n),
  };
}

/* ───────────────────── #11 / #13 SIP FV (+ step-up) ───────────────────── */

export type StepUp = { mode: "pct"; pct: number } | { mode: "amount"; amount: number };

export type SipRow = {
  year: number;
  /** Monthly instalment in this year (unrounded). */
  monthly: number;
  /** 12 × the unrounded monthly instalment. */
  annual: number;
  /** Year-end value per scenario. */
  values: number[];
};

export type SipProjection = { invested: number; fv: number[]; rows: SipRow[] };

function monthlyInYear(monthly: number, stepUp: StepUp | null, year: number): number {
  if (!stepUp) return monthly;
  return stepUp.mode === "pct"
    ? monthly * Math.pow(1 + stepUp.pct / 100, year - 1)
    : monthly + stepUp.amount * (year - 1);
}

function fvFor(monthly: number, stepUp: StepUp | null, ratePct: number, years: number): number {
  if (!stepUp) return fvSip(monthly, ratePct, years * 12);
  return stepUp.mode === "pct"
    ? fvStepUpSip(monthly, stepUp.pct, ratePct, years)
    : fvStepUpAmountSip(monthly, stepUp.amount, ratePct, years);
}

function investedFor(monthly: number, stepUp: StepUp | null, years: number): number {
  if (!stepUp) return monthly * 12 * years;
  return stepUp.mode === "pct"
    ? stepUpInvested(monthly, stepUp.pct, years)
    : stepUpAmountInvested(monthly, stepUp.amount, years);
}

/** Year-wise projection of a SIP (flat, %-step-up or ₹-step-up). Year-end
 *  value of year y = the FV of the same SIP run for y years (it is still
 *  running; payments to date compounded to the end of year y). */
export function sipProjection(monthly: number, stepUp: StepUp | null, years: number, ratesPct: number[]): SipProjection {
  const n = wholeYears(years);
  const rows: SipRow[] = [];
  for (let y = 1; y <= n; y++) {
    const m = monthlyInYear(monthly, stepUp, y);
    rows.push({ year: y, monthly: m, annual: m * 12, values: ratesPct.map((r) => fvFor(monthly, stepUp, r, y)) });
  }
  return {
    invested: investedFor(monthly, stepUp, n),
    fv: ratesPct.map((r) => fvFor(monthly, stepUp, r, n)),
    rows,
  };
}

export type SipFvResult = { years: number; normal: SipProjection; stepUp: SipProjection | null };

/** #11 — Future value of a SIP, with an optional ₹ / % step-up comparison. */
export function sipFv(input: { monthly: number; years: number; ratesPct: number[]; stepUp: StepUp | null }): SipFvResult {
  const n = wholeYears(input.years);
  return {
    years: n,
    normal: sipProjection(input.monthly, null, n, input.ratesPct),
    stepUp: input.stepUp ? sipProjection(input.monthly, input.stepUp, n, input.ratesPct) : null,
  };
}

/** #13 — Future value of a SIP raised by a fixed % every year. */
export function stepUpSipFv(input: { monthly: number; stepUpPct: number; years: number; ratesPct: number[] }): SipProjection {
  return sipProjection(input.monthly, { mode: "pct", pct: input.stepUpPct }, input.years, input.ratesPct);
}

/* ───────────────────── #8 / #20 Limited-period SIP ───────────────────── */

export type LimitedRow = {
  year: number;
  /** Monthly / annual instalment — 0 once the SIP has stopped. */
  monthly: number;
  annual: number;
  values: number[];
};

/** Value at the end of year y of a SIP paid for the first `sipYears`. */
function limitedValue(monthly: number, sipYears: number, year: number, ratePct: number): number {
  const paid = Math.min(year, sipYears);
  const corpus = fvSip(monthly, ratePct, paid * 12);
  return year > paid ? growLumpsum(corpus, ratePct, year - paid) : corpus;
}

function limitedRows(monthlyPerRate: number[], sipYears: number, total: number, ratesPct: number[]): LimitedRow[] {
  const rows: LimitedRow[] = [];
  for (let y = 1; y <= total; y++) {
    const active = y <= sipYears;
    // The instalment column is per scenario only when the SIP differs per
    // scenario (#20); #8 passes the same amount for every rate.
    const monthly = active ? monthlyPerRate[0] ?? 0 : 0;
    rows.push({
      year: y,
      monthly,
      annual: monthly * 12,
      values: ratesPct.map((r, i) => limitedValue(monthlyPerRate[i] ?? 0, sipYears, y, r)),
    });
  }
  return rows;
}

export type LimitedSipFvResult = { sipYears: number; deferYears: number; invested: number; fv: number[]; rows: LimitedRow[] };

/** #8 — FV of a SIP paid for `sipYears`, then held for `deferYears`. */
export function limitedSipFv(input: { monthly: number; sipYears: number; deferYears: number; ratesPct: number[] }): LimitedSipFvResult {
  const s = wholeYears(input.sipYears);
  const d = wholeYears(input.deferYears);
  const total = s + d;
  const perRate = input.ratesPct.map(() => input.monthly);
  return {
    sipYears: s,
    deferYears: d,
    invested: input.monthly * 12 * s,
    fv: input.ratesPct.map((r) => limitedValue(input.monthly, s, total, r)),
    rows: limitedRows(perRate, s, total, input.ratesPct),
  };
}

export type LimitedNeedScenario = {
  ratePct: number;
  /** Unrounded monthly SIP (NaN when there is no SIP period). */
  monthlySip: number;
  /** Unrounded SIP × 12 × SIP years. */
  totalInvestment: number;
  rows: { year: number; monthly: number; annual: number; value: number }[];
};

/** #20 — monthly SIP needed when the SIP runs `sipYears` and the corpus is then
 *  held for `deferYears` to reach `target`. */
export function limitedSipNeed(input: { target: number; sipYears: number; deferYears: number; ratesPct: number[] }): LimitedNeedScenario[] {
  const s = wholeYears(input.sipYears);
  const d = wholeYears(input.deferYears);
  return input.ratesPct.map((ratePct) => {
    if (s <= 0) return { ratePct, monthlySip: NaN, totalInvestment: NaN, rows: [] };
    const atStop = input.target / Math.pow(1 + ratePct / 100, d);
    const sip = requiredSip(atStop, ratePct, s * 12);
    const rows = limitedRows([sip], s, s + d, [ratePct]).map((r) => ({
      year: r.year, monthly: r.monthly, annual: r.annual, value: r.values[0],
    }));
    return { ratePct, monthlySip: sip, totalInvestment: sip * 12 * s, rows };
  });
}

/* ───────────────────── #43 Step-up SIP for a target ───────────────────── */

export type StepUpTargetScenario = {
  ratePct: number;
  startSip: number;
  total: number;
  rows: { year: number; monthly: number; annual: number; value: number }[];
};

function stepUpTargetScenario(target: number, years: number, stepUpPct: number, ratePct: number): StepUpTargetScenario {
  const per1 = fvStepUpSip(1, stepUpPct, ratePct, years);
  const startSip = per1 > 0 ? target / per1 : NaN;
  const proj = Number.isFinite(startSip)
    ? sipProjection(startSip, { mode: "pct", pct: stepUpPct }, years, [ratePct])
    : { invested: NaN, fv: [], rows: [] };
  return {
    ratePct,
    startSip,
    total: proj.invested,
    rows: proj.rows.map((r) => ({ year: r.year, monthly: r.monthly, annual: r.annual, value: r.values[0] })),
  };
}

/** #43 — starting monthly SIP that, raised `stepUpPct` every year, reaches `target`. */
export function stepUpSipForTarget(input: { target: number; years: number; stepUpPct: number; ratesPct: number[] }): StepUpTargetScenario[] {
  const n = wholeYears(input.years);
  return input.ratesPct.map((r) => stepUpTargetScenario(input.target, n, input.stepUpPct, r));
}

/* ───────────────────── #39 SIP for a target (+ cost of delay) ───────────────────── */

export type SipTargetScenario = {
  ratePct: number;
  sip: number;
  total: number;
  rows: { year: number; annual: number; value: number }[];
  stepUp: StepUpTargetScenario | null;
  /** Delay d = 1…n−1 years: SIP over the n−d years left, and its total. */
  delay: { delayYears: number; sip: number; total: number }[] | null;
};

export function sipForTarget(input: {
  target: number;
  years: number;
  ratesPct: number[];
  stepUpPct: number | null;
  costOfDelay: boolean;
}): SipTargetScenario[] {
  const n = wholeYears(input.years);
  return input.ratesPct.map((ratePct) => {
    const sip = n > 0 ? requiredSip(input.target, ratePct, n * 12) : NaN;
    const rows: SipTargetScenario["rows"] = [];
    if (Number.isFinite(sip)) {
      for (let y = 1; y <= n; y++) rows.push({ year: y, annual: sip * 12, value: fvSip(sip, ratePct, y * 12) });
    }
    let delay: SipTargetScenario["delay"] = null;
    if (input.costOfDelay) {
      delay = [];
      for (let d = 1; d < n; d++) {
        const months = (n - d) * 12;
        const sd = requiredSip(input.target, ratePct, months);
        delay.push({ delayYears: d, sip: sd, total: sd * months });
      }
    }
    return {
      ratePct,
      sip,
      total: sip * 12 * n,
      rows,
      stepUp: input.stepUpPct != null ? stepUpTargetScenario(input.target, n, input.stepUpPct, ratePct) : null,
      delay,
    };
  });
}

/* ───────────────────── #41 SIP or lumpsum for a target ───────────────────── */

export type SipLumpsumTargetResult = {
  solve: "sip" | "lumpsum";
  /** Monthly SIP (solved, or the input). */
  sip: number;
  /** Lumpsum today (solved, or the input). */
  lumpsum: number;
  /** True when the given leg alone already reaches the target (solved leg is 0). */
  covered: boolean;
  rows: LegRow[];
};

export function sipLumpsumForTarget(input: {
  target: number;
  years: number;
  solve: "sip" | "lumpsum";
  lumpsum: number;
  monthlySip: number;
  sipPct: number;
  lumpsumPct: number;
}): SipLumpsumTargetResult {
  const n = wholeYears(input.years);
  let sip: number;
  let lumpsum: number;
  let covered = false;
  if (input.solve === "sip") {
    lumpsum = Math.max(0, input.lumpsum);
    const gap = input.target - growLumpsum(lumpsum, input.lumpsumPct, n);
    if (n <= 0) sip = NaN;
    else if (gap <= 0) { sip = 0; covered = true; }
    else sip = requiredSip(gap, input.sipPct, n * 12);
  } else {
    sip = Math.max(0, input.monthlySip);
    const gap = input.target - fvSip(sip, input.sipPct, n * 12);
    if (gap <= 0) { lumpsum = 0; covered = true; }
    else lumpsum = gap / Math.pow(1 + input.lumpsumPct / 100, n);
  }
  const rows = Number.isFinite(sip) && Number.isFinite(lumpsum)
    ? legRows(sip, input.sipPct, lumpsum, input.lumpsumPct, n)
    : [];
  return { solve: input.solve, sip, lumpsum, covered, rows };
}

/* ───────────────────── #24 Lumpsum for a target ───────────────────── */

export type LumpsumTargetScenario = {
  ratePct: number;
  lumpsum: number;
  rows: { year: number; investment: number; value: number }[];
};

/** #24 — one-time amount today that grows to `target`. Year-end values come
 *  from the UNROUNDED lumpsum, so the last row equals the target. */
export function lumpsumForTarget(input: { target: number; years: number; ratesPct: number[] }): LumpsumTargetScenario[] {
  const n = wholeYears(input.years);
  return input.ratesPct.map((ratePct) => {
    const lumpsum = input.target / Math.pow(1 + ratePct / 100, n);
    const rows: LumpsumTargetScenario["rows"] = [];
    for (let y = 1; y <= n; y++) {
      rows.push({ year: y, investment: y === 1 ? lumpsum : 0, value: growLumpsum(lumpsum, ratePct, y) });
    }
    return { ratePct, lumpsum, rows };
  });
}
