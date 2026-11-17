/**
 * Target-SWP engines — three calculators that share one withdrawal model:
 *
 *   • lumpsumForSwp — the one-time investment today that funds a monthly SWP
 *                     (optionally rising with inflation) and leaves a balance.
 *   • swpFromLumpsum — the exact inverse: the monthly SWP a lumpsum supports,
 *                      with an optional capital-gains-tax projection.
 *   • sipForSwp      — the corpus a target SWP needs, and the monthly SIP that
 *                      builds it (separate accumulation / distribution rates).
 *
 * CONVENTION — effective monthly rates, and the timing is stated explicitly
 * because it differs from the SIP side of the suite:
 *   m = (1+r)^(1/12) − 1          effective monthly return
 *   g = (1+i)^(1/12) − 1          effective monthly inflation; the withdrawal
 *                                 rises EVERY month, W_k = W₁·(1+g)^(k−1) — not a
 *                                 once-a-year step
 *   SWP timing: END of month (ordinary annuity) — the fund grows for the month,
 *               then that month's withdrawal is taken.
 *   SIP timing (sipForSwp only): START of month (annuity-due, sip360.requiredSip).
 *
 *   Lumpsum at SWP start = Σ_{k=1..N} W_k/(1+m)^k + B/(1+m)^N.
 *
 * Reference cases reproduced to the rupee (tests/ms-calc-c.test.ts):
 *   ₹2,00,000/mo · 25y · 9% · 5% inflation · leave ₹1 cr → lumpsum ₹3,99,24,637,
 *     total withdrawal ₹11,71,46,904.
 *   ₹1 cr · 25y · 9% · 5% inflation · leave ₹1 cr → first-year average SWP
 *     ₹46,646, total ₹2,67,15,270; tax ST 20% (≤1y) / LT 12.5% → year-1 tax ₹5,110.
 *   ₹1,00,000/mo · SIP 20y @12% · SWP 30y @7% · leave ₹50 L → corpus
 *     ₹1,60,19,597, SIP ₹17,415.
 *
 * Tax model (FIFO, one purchase lot at the investment date, t = 0): units are
 * bought at NAV 1 and the NAV after t months is (1+m)^t, so a withdrawal w at
 * month t carries a cost of w·(1+m)^−t and a gain of w·(1 − (1+m)^−t). The
 * holding year is ceil(t/12): short-term up to `stUptoYears`, long-term from
 * `ltFromYear`. No exemption, cess or surcharge. Indexation (cost × (1+idx)^(t/12)
 * on long-term gains) is an ASSUMPTION — the reference case never exercised it;
 * leave it at 0 for equity-style taxation.
 *
 * Deferment (years between investing and the first withdrawal) grows the money
 * at the same scenario rate; it is not evidenced by a reference case.
 */

import { requiredSip, fvSip } from "./sip360";

const effM = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;
const whole = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

/* ───────────────────────── shared primitives ───────────────────────── */

/**
 * Present value at SWP start of a ₹1 first withdrawal rising monthly:
 *   A = Σ_{k=1..N} (1+g)^(k−1) / (1+m)^k
 * Looped, so inflation = return (g = m) needs no special case.
 */
export function swpAnnuityFactor(months: number, ratePct: number, inflationPct: number): number {
  const m = effM(ratePct);
  const g = effM(inflationPct);
  let a = 0;
  for (let k = 1; k <= months; k++) a += Math.pow(1 + g, k - 1) / Math.pow(1 + m, k);
  return a;
}

/** Σ W_k for a first withdrawal W₁ rising monthly at the effective inflation rate. */
export function totalWithdrawalFor(firstMonthly: number, months: number, inflationPct: number): number {
  const g = effM(inflationPct);
  if (g === 0) return firstMonthly * months;
  return (firstMonthly * (Math.pow(1 + g, months) - 1)) / g;
}

/** Mean of the first 12 withdrawals (what the reports print as "year 1"). */
export function firstYearAverage(firstMonthly: number, inflationPct: number): number {
  const g = effM(inflationPct);
  if (g === 0) return firstMonthly;
  return (firstMonthly * (Math.pow(1 + g, 12) - 1)) / (12 * g);
}

export type SwpTax = {
  /** Short-term rate (%), applied while the holding year ≤ stUptoYears. */
  stPct: number;
  stUptoYears: number;
  /** Long-term rate (%), applied from this holding year on. */
  ltPct: number;
  ltFromYear: number;
  /** Assumed inflation for indexing the long-term cost (%); 0 = no indexation. */
  indexationPct: number;
};

export type SwpYearRow = {
  year: number;
  /** currentAge + year, or null when no age was given. */
  age: number | null;
  /** Average of the year's monthly withdrawals (0 in a deferment year). */
  avgMonthlySwp: number;
  /** First withdrawal of the year (0 in a deferment year). */
  firstMonthlySwp: number;
  annualWithdrawal: number;
  yearEndBalance: number;
  tax: number;
  postTax: number;
};

/**
 * Month-by-month projection from the investment date: `deferMonths` of growth,
 * then `months` end-of-month withdrawals W₁·(1+g)^(k−1). Rows are one per year,
 * counted from the investment date.
 */
export function simulateSwp(opts: {
  startValue: number;
  deferMonths: number;
  firstMonthly: number;
  months: number;
  ratePct: number;
  inflationPct: number;
  startAge: number | null;
  tax: SwpTax | null;
}): { rows: SwpYearRow[]; endBalance: number; totalWithdrawal: number; totalTax: number } {
  const m = effM(opts.ratePct);
  const g = effM(opts.inflationPct);
  const idx = opts.tax ? opts.tax.indexationPct / 100 : 0;
  const totalMonths = opts.deferMonths + opts.months;
  const rows: SwpYearRow[] = [];
  let bal = opts.startValue;
  let total = 0;
  let totalTax = 0;
  let yW = 0;
  let yTax = 0;
  let yCount = 0;
  let yFirst = 0;

  for (let t = 1; t <= totalMonths; t++) {
    bal *= 1 + m;
    if (t > opts.deferMonths) {
      const k = t - opts.deferMonths;
      const w = opts.firstMonthly * Math.pow(1 + g, k - 1);
      bal -= w;
      total += w;
      yW += w;
      if (yCount === 0) yFirst = w;
      yCount++;
      if (opts.tax) {
        const holdingYear = Math.ceil(t / 12);
        const isLong = holdingYear > opts.tax.stUptoYears && holdingYear >= opts.tax.ltFromYear;
        const cost = w * Math.pow(1 + m, -t) * (isLong ? Math.pow(1 + idx, t / 12) : 1);
        const gain = Math.max(0, w - cost);
        const tx = (gain * (isLong ? opts.tax.ltPct : opts.tax.stPct)) / 100;
        yTax += tx;
        totalTax += tx;
      }
    }
    if (t % 12 === 0 || t === totalMonths) {
      const year = Math.ceil(t / 12);
      rows.push({
        year,
        age: opts.startAge != null ? opts.startAge + year : null,
        avgMonthlySwp: yCount > 0 ? yW / yCount : 0,
        firstMonthlySwp: yFirst,
        annualWithdrawal: yW,
        yearEndBalance: bal,
        tax: yTax,
        postTax: yW - yTax,
      });
      yW = 0;
      yTax = 0;
      yCount = 0;
      yFirst = 0;
    }
  }
  return { rows, endBalance: bal, totalWithdrawal: total, totalTax };
}

/* ───────────────────── Lumpsum required for a target SWP ───────────────────── */

export type LumpsumForSwpInput = {
  firstMonthlySwp: number;
  deferYears: number;
  swpYears: number;
  ratePct: number;
  /** 0 = level SWP. */
  inflationPct: number;
  endBalance: number;
  /** Optional — only labels the rows. */
  currentAge: number | null;
  tax: SwpTax | null;
};

export type LumpsumForSwpResult = {
  ratePct: number;
  lumpsumToday: number;
  corpusAtSwpStart: number;
  firstMonthSwp: number;
  firstYearAvgSwp: number;
  lastMonthSwp: number;
  totalWithdrawal: number;
  totalTax: number;
  rows: SwpYearRow[];
};

export function lumpsumForSwp(input: LumpsumForSwpInput): LumpsumForSwpResult {
  const N = whole(input.swpYears) * 12;
  const D = whole(input.deferYears) * 12;
  const m = effM(input.ratePct);
  const W1 = Math.max(0, input.firstMonthlySwp);
  const corpusAtSwpStart = W1 * swpAnnuityFactor(N, input.ratePct, input.inflationPct) + Math.max(0, input.endBalance) / Math.pow(1 + m, N);
  const lumpsumToday = corpusAtSwpStart / Math.pow(1 + m, D);
  const sim = simulateSwp({
    startValue: lumpsumToday, deferMonths: D, firstMonthly: W1, months: N,
    ratePct: input.ratePct, inflationPct: input.inflationPct, startAge: input.currentAge, tax: input.tax,
  });
  return {
    ratePct: input.ratePct,
    lumpsumToday,
    corpusAtSwpStart,
    firstMonthSwp: W1,
    firstYearAvgSwp: N > 0 ? firstYearAverage(W1, input.inflationPct) : 0,
    lastMonthSwp: N > 0 ? W1 * Math.pow(1 + effM(input.inflationPct), N - 1) : 0,
    totalWithdrawal: sim.totalWithdrawal,
    totalTax: sim.totalTax,
    rows: sim.rows,
  };
}

/* ───────────────────── Monthly SWP from a lumpsum ───────────────────── */

export type SwpFromLumpsumInput = {
  lumpsum: number;
  deferYears: number;
  swpYears: number;
  ratePct: number;
  inflationPct: number;
  endBalance: number;
  currentAge: number | null;
  tax: SwpTax | null;
};

export type SwpFromLumpsumResult = {
  ratePct: number;
  corpusAtSwpStart: number;
  /** First month's withdrawal. Negative when the balance asked for is out of reach. */
  firstMonthSwp: number;
  firstYearAvgSwp: number;
  lastMonthSwp: number;
  totalWithdrawal: number;
  totalTax: number;
  /** False when the balance required exceeds what the lumpsum grows to. */
  feasible: boolean;
  /** Balance at the end if nothing were withdrawn. */
  maxEndBalance: number;
  rows: SwpYearRow[];
};

export function swpFromLumpsum(input: SwpFromLumpsumInput): SwpFromLumpsumResult {
  const N = whole(input.swpYears) * 12;
  const D = whole(input.deferYears) * 12;
  const m = effM(input.ratePct);
  const P = Math.max(0, input.lumpsum);
  const corpusAtSwpStart = P * Math.pow(1 + m, D);
  const A = swpAnnuityFactor(N, input.ratePct, input.inflationPct);
  const B = Math.max(0, input.endBalance);
  const W1 = A > 0 ? (corpusAtSwpStart - B / Math.pow(1 + m, N)) / A : 0;
  const sim = simulateSwp({
    startValue: P, deferMonths: D, firstMonthly: W1, months: N,
    ratePct: input.ratePct, inflationPct: input.inflationPct, startAge: input.currentAge, tax: input.tax,
  });
  return {
    ratePct: input.ratePct,
    corpusAtSwpStart,
    firstMonthSwp: W1,
    firstYearAvgSwp: N > 0 ? firstYearAverage(W1, input.inflationPct) : 0,
    lastMonthSwp: N > 0 ? W1 * Math.pow(1 + effM(input.inflationPct), N - 1) : 0,
    totalWithdrawal: sim.totalWithdrawal,
    totalTax: sim.totalTax,
    feasible: W1 >= 0,
    maxEndBalance: corpusAtSwpStart * Math.pow(1 + m, N),
    rows: sim.rows,
  };
}

/* ───────────────────── SIP required for a target SWP ───────────────────── */

export type SipForSwpInput = {
  firstMonthlySwp: number;
  sipYears: number;
  /** Years between the last SIP and the first withdrawal (corpus grows at the accumulation rate). */
  deferYears: number;
  swpYears: number;
  accPct: number;
  distPct: number;
  inflationPct: number;
  endBalance: number;
  currentAge: number | null;
};

export type SipAccRow = { year: number; age: number | null; annualInvestment: number; yearEndValue: number };

export type SipForSwpResult = {
  accPct: number;
  distPct: number;
  /** Corpus needed when the SWP starts. */
  corpus: number;
  /** Value the SIP must reach on its last month (corpus discounted over the deferment). */
  targetAtSipEnd: number;
  monthlySip: number;
  annualInvestment: number;
  totalInvested: number;
  totalWithdrawal: number;
  accRows: SipAccRow[];
  swpRows: SwpYearRow[];
};

export function sipForSwp(input: SipForSwpInput): SipForSwpResult {
  const sipYears = whole(input.sipYears);
  const deferYears = whole(input.deferYears);
  const M = whole(input.swpYears) * 12;
  const md = effM(input.distPct);
  const W1 = Math.max(0, input.firstMonthlySwp);
  const corpus = W1 * swpAnnuityFactor(M, input.distPct, input.inflationPct) + Math.max(0, input.endBalance) / Math.pow(1 + md, M);
  const targetAtSipEnd = corpus / Math.pow(1 + input.accPct / 100, deferYears);
  const monthlySip = requiredSip(targetAtSipEnd, input.accPct, sipYears * 12);
  const age = input.currentAge;

  const accRows: SipAccRow[] = [];
  const atSipEnd = fvSip(monthlySip, input.accPct, sipYears * 12);
  for (let y = 1; y <= sipYears + deferYears; y++) {
    const value = y <= sipYears
      ? fvSip(monthlySip, input.accPct, y * 12)
      : atSipEnd * Math.pow(1 + input.accPct / 100, y - sipYears);
    accRows.push({ year: y, age: age != null ? age + y : null, annualInvestment: y <= sipYears ? monthlySip * 12 : 0, yearEndValue: value });
  }

  const sim = simulateSwp({
    startValue: corpus, deferMonths: 0, firstMonthly: W1, months: M,
    ratePct: input.distPct, inflationPct: input.inflationPct,
    startAge: age != null ? age + sipYears + deferYears : null, tax: null,
  });
  const swpRows = sim.rows.map((r) => ({ ...r, year: r.year + sipYears + deferYears }));

  return {
    accPct: input.accPct,
    distPct: input.distPct,
    corpus,
    targetAtSipEnd,
    monthlySip,
    annualInvestment: monthlySip * 12,
    totalInvested: monthlySip * 12 * sipYears,
    totalWithdrawal: sim.totalWithdrawal,
    accRows,
    swpRows,
  };
}
