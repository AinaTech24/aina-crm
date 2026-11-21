// Copied verbatim from src/lib/calculators/salary-wealth.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Salary-Linked Wealth Builder — math engine.
 *
 * Invest a percentage of your monthly salary as a SIP; as the salary grows each
 * year (annual increment), the SIP grows with it. Project the wealth created by
 * retirement — or, in reverse, the saving rate required to hit a target.
 *
 * Two directions (mode):
 *   • "wealth"  — given salary, SIP %, increment → wealth created at retirement.
 *   • "saving"  — given a target wealth → the monthly SIP (and % of salary)
 *                 you must save to reach it.
 *
 * CONVENTIONS (shared with the rest of the calculators module):
 *   EFFECTIVE monthly rate m = (1+a)^(1/12)−1, BEGIN-mode SIP (a contribution at
 *   the start of a month grows that same month), step-up applied at each year
 *   boundary. After the "invest till" age the corpus is HELD (no contributions)
 *   until retirement. An optional existing lumpsum compounds annually at its OWN
 *   return (`existingReturnPct`, default = the SIP return) for the whole
 *   pre-retirement horizon.
 *
 * Verified to the reference case (32 → 60, salary ₹1,20,000, +8% a year, SIP
 * till 60, 12%, existing ₹6,00,000 @ 12%):
 *   wealth mode, 10% SIP → total salary received ₹13,72,87,915, total NEW
 *   investment ₹1,37,28,791 (the existing investment is not counted), via SIP
 *   ₹5,84,32,619, via existing ₹1,43,30,320, total ₹7,27,62,939;
 *   saving mode, ₹10 cr → starting SIP ₹17,594, 14.66% of salary, total new
 *   investment ₹2,01,28,161.
 *   Total salary received = Σ over the SIP years of 12 × salary × (1 + inc)^y.
 *   The reference also prints a "% of salary to equal the total salary
 *   received" note (4.75%) that no coherent model reproduces; ours is the
 *   stepped-SIP answer (23.50% for the case), `pctToMatchSalary`.
 */

export type SalaryWealthMode = "wealth" | "saving";

export type SalaryWealthInput = {
  mode: SalaryWealthMode;
  currentAge: number;
  retirementAge: number;
  currentMonthlySalary: number;
  sipPctOfSalary: number;
  annualIncrementPct: number;
  investTillAge: number;
  assumedReturnPct: number;
  includeExisting: boolean;
  existingInvestment: number;
  /** Return on the existing investment (default: assumedReturnPct). */
  existingReturnPct?: number;
  targetWealth: number; // used only in "saving" mode
};

export type SalaryYearRow = {
  age: number;
  phase: "invest" | "hold";
  monthlySipThatYear: number;
  investedThisYear: number;
  endCorpus: number;
};

export type SalaryWealthResult = {
  totalYears: number;
  sipYears: number;
  holdYears: number;

  monthlySip: number; // first-year monthly SIP used in the plan
  lastMonthlySip: number;
  totalInvested: number; // new SIP investment + the existing investment
  /** New money put in through the SIP only (excludes the existing investment). */
  newInvestment: number;
  /** Salary received over the SIP years (current age → invest-till age). */
  totalSalaryReceived: number;
  /** SIP corpus at retirement (excludes the existing investment). */
  sipWealth: number;
  /** % of monthly salary, stepped up with salary, whose SIP grows to the total salary received. */
  pctToMatchSalary: number;
  existingFutureValue: number;
  wealth: number; // total corpus at retirement (SIP corpus + grown existing)
  wealthGain: number;

  // reverse (saving) mode
  requiredMonthlySip?: number;
  requiredSipPct?: number;
  /** Saving mode: the one-time lumpsum today, at the assumed return, that closes
   *  the same gap (target − grown existing fund) by retirement. */
  requiredLumpsumToday?: number;
  targetWealth?: number;

  schedule: SalaryYearRow[];
};

const effM = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

/**
 * Simulate the SIP accumulation month-by-month (begin-mode), returning the
 * final SIP-only corpus, total contributed, and a per-year schedule.
 */
function simulate(
  monthly0: number,
  incrementPct: number,
  sipYears: number,
  holdYears: number,
  returnPct: number,
  startAge: number
): { corpus: number; invested: number; schedule: SalaryYearRow[] } {
  const m = effM(returnPct);
  const s = incrementPct / 100;
  const nSip = Math.round(sipYears);
  const nHold = Math.round(holdYears);
  let corpus = 0;
  let invested = 0;
  const schedule: SalaryYearRow[] = [];

  for (let y = 0; y < nSip; y++) {
    const monthly = monthly0 * Math.pow(1 + s, y);
    let yearInvest = 0;
    for (let mo = 0; mo < 12; mo++) {
      // Begin-mode: add the contribution, then grow the whole balance.
      corpus = (corpus + monthly) * (1 + m);
      invested += monthly;
      yearInvest += monthly;
    }
    schedule.push({ age: startAge + y + 1, phase: "invest", monthlySipThatYear: monthly, investedThisYear: yearInvest, endCorpus: corpus });
  }
  for (let y = 0; y < nHold; y++) {
    for (let mo = 0; mo < 12; mo++) corpus = corpus * (1 + m);
    schedule.push({ age: startAge + nSip + y + 1, phase: "hold", monthlySipThatYear: 0, investedThisYear: 0, endCorpus: corpus });
  }
  return { corpus, invested, schedule };
}

export function computeSalaryWealth(input: SalaryWealthInput): SalaryWealthResult {
  const totalYears = Math.max(0, input.retirementAge - input.currentAge);
  const sipYears = Math.max(0, Math.min(input.investTillAge, input.retirementAge) - input.currentAge);
  const holdYears = Math.max(0, totalYears - sipYears);
  const s = input.annualIncrementPct / 100;

  const existingFutureValue = input.includeExisting
    ? input.existingInvestment * Math.pow(1 + effM(input.existingReturnPct ?? input.assumedReturnPct), Math.round(totalYears * 12))
    : 0;

  let monthly0: number;
  let requiredMonthlySip: number | undefined;
  let requiredSipPct: number | undefined;
  let requiredLumpsumToday: number | undefined;
  let targetWealth: number | undefined;

  if (input.mode === "wealth") {
    monthly0 = (input.currentMonthlySalary * input.sipPctOfSalary) / 100;
  } else {
    // Reverse: required SIP for the target, net of the grown existing fund.
    targetWealth = input.targetWealth;
    const factor = simulate(1, input.annualIncrementPct, sipYears, holdYears, input.assumedReturnPct, input.currentAge).corpus;
    const need = Math.max(0, input.targetWealth - existingFutureValue);
    // No investing years (invest-till age ≤ current age) ⇒ no SIP can close a
    // gap: NaN renders "—" (was ₹0). nSip = 0 then, so nothing below sums it.
    requiredMonthlySip = factor > 0 ? need / factor : need > 0 ? NaN : 0;
    // Same need, same effective monthly rate, invested today and held to retirement.
    requiredLumpsumToday = need / Math.pow(1 + effM(input.assumedReturnPct), Math.round(totalYears * 12));
    requiredSipPct = input.currentMonthlySalary > 0 ? (requiredMonthlySip / input.currentMonthlySalary) * 100 : 0;
    monthly0 = requiredMonthlySip;
  }

  const sim = simulate(monthly0, input.annualIncrementPct, sipYears, holdYears, input.assumedReturnPct, input.currentAge);
  const wealth = sim.corpus + existingFutureValue;
  const totalInvested = sim.invested + (input.includeExisting ? input.existingInvestment : 0);
  const lastMonthlySip = sipYears > 0 ? monthly0 * Math.pow(1 + s, Math.round(sipYears) - 1) : 0;

  const nSip = Math.round(sipYears);
  let totalSalaryReceived = 0;
  for (let y = 0; y < nSip; y++) totalSalaryReceived += 12 * input.currentMonthlySalary * Math.pow(1 + s, y);
  const perSalary = simulate(input.currentMonthlySalary, input.annualIncrementPct, sipYears, holdYears, input.assumedReturnPct, input.currentAge).corpus;
  const pctToMatchSalary = perSalary > 0 ? (totalSalaryReceived / perSalary) * 100 : NaN;

  return {
    totalYears,
    sipYears,
    holdYears,
    monthlySip: monthly0,
    lastMonthlySip,
    totalInvested,
    newInvestment: sim.invested,
    totalSalaryReceived,
    sipWealth: sim.corpus,
    pctToMatchSalary,
    existingFutureValue,
    wealth,
    wealthGain: wealth - totalInvested,
    requiredMonthlySip,
    requiredSipPct,
    requiredLumpsumToday,
    targetWealth,
    schedule: sim.schedule,
  };
}
