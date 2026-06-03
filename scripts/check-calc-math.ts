/**
 * Calculator math regression check (no test runner is configured, so this is a
 * runnable tsx assertion script — same pattern as the other scripts/*.ts).
 *
 *   npx tsx scripts/check-calc-math.ts      # exits 0 on pass, 1 on any failure
 *
 * Focus: the flat-return (0%) limits that previously produced NaN, plus a few
 * known-good values and an inverse round-trip, so a future edit to the formulas
 * can't silently regress the client-facing numbers.
 */

import {
  fvSip,
  fvLumpsum,
  requiredSip,
  fvStepUpSip,
  requiredStepUpSip,
  cagrCalculate,
  computeGoal,
  retirementCorpus,
} from "../src/lib/goal-planning/calc";

let failures = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function approx(a: number, b: number, tolPct = 0.5): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (b === 0) return Math.abs(a) < 1e-6;
  return Math.abs((a - b) / b) * 100 <= tolPct;
}

console.log("[calc] flat-return (0%) limits — must be finite, not NaN:");
ok("fvSip(10000, 0%, 120) = 12,00,000", fvSip(10000, 0, 120) === 1_200_000, String(fvSip(10000, 0, 120)));
ok("requiredSip(12,00,000, 0, 0%, 120) = 10,000", requiredSip(1_200_000, 0, 0, 120) === 10_000, String(requiredSip(1_200_000, 0, 0, 120)));
{
  // Step-up at 0% = sum of stepped contributions (no growth).
  let flat = 0;
  for (let k = 0; k < 10; k++) flat += 10000 * Math.pow(1.1, k) * 12;
  ok("fvStepUpSip(10000, 0%, 120, 10%) = Σ contributions", approx(fvStepUpSip(10000, 0, 120, 10), flat, 0.001), `${fvStepUpSip(10000, 0, 120, 10)} vs ${flat}`);
}
ok("requiredStepUpSip(…, 0%, …) is finite", Number.isFinite(requiredStepUpSip(1_000_000, 0, 0, 120, 10)));
ok("computeGoal(0% return) status not NaN", Number.isFinite(computeGoal({ futureTarget: 5_000_000, currentValue: 0, existingMonthlySip: 0, monthsLeft: 120, expectedReturnPct: 0 }).requiredMonthlySipTotal));
ok("retirementCorpus(0% pre/post) finite", Number.isFinite(retirementCorpus({ currentAge: 30, retirementAge: 60, lifeExpectancy: 85, monthlyIncomeTodayInr: 50000, inflationPct: 6, preReturnPct: 0, postReturnPct: 0, existingFundInr: 0 }).monthlySavingsRequired));

console.log("[calc] known-good values @ 12%:");
ok("fvSip(10000, 12%, 120) ≈ 23,23,391", approx(fvSip(10000, 12, 120), 2_323_391, 0.1), String(Math.round(fvSip(10000, 12, 120))));
ok("fvLumpsum(100000, 12%, 120) ≈ 3,30,039", approx(fvLumpsum(100000, 12, 120), 330_039, 0.1), String(Math.round(fvLumpsum(100000, 12, 120))));
ok("step-up beats flat @12%", fvStepUpSip(10000, 12, 120, 10) > fvSip(10000, 12, 120));

console.log("[calc] inverse round-trip (requiredSip → fvSip):");
{
  const T = 5_000_000;
  const req = requiredSip(T, 0, 12, 120);
  ok("fvSip(requiredSip(T)) ≈ T", approx(fvSip(req, 12, 120), T, 0.1), `${Math.round(fvSip(req, 12, 120))} vs ${T}`);
}

console.log("[calc] CAGR:");
ok("cagr(100→200 over 10y) ≈ 7.177%", approx(cagrCalculate({ initialValue: 100, finalValue: 200, years: 10 }).cagrPct, 7.177, 0.5));
ok("cagr guards initial=0", cagrCalculate({ initialValue: 0, finalValue: 200, years: 10 }).cagrPct === 0);

if (failures === 0) {
  console.log("\n[calc] all checks passed ✓");
  process.exit(0);
} else {
  console.error(`\n[calc] ${failures} check(s) FAILED ✗`);
  process.exit(1);
}
