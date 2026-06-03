/**
 * Financial-plan server-side compute helpers — shared by the create + update
 * routes so the persisted/printed numbers are authoritative, not whatever the
 * client posted.
 */

import { computeGoal } from "@/lib/goal-planning/calc";

/** A financial-plan goal's scoreable inputs. */
export interface PlanGoalInput {
  targetAmount: number; // present-day cost
  targetYears: number;
  inflationRate: number;
  expectedReturn: number;
  [k: string]: unknown;
}

/**
 * Recompute each goal's future value + required monthly SIP from its inputs
 * using the canonical engine (the same one the UI uses). Overrides any
 * client-supplied futureValue / requiredMonthlySip so a stale or tampered
 * client can't persist wrong advice into a SEBI document.
 */
export function recomputePlanGoals<T extends PlanGoalInput>(
  goals: T[] | undefined
): Array<T & { futureValue: number; requiredMonthlySip: number }> {
  return (goals ?? []).map((g) => {
    const calc = computeGoal({
      presentTarget: g.targetAmount,
      currentValue: 0,
      existingMonthlySip: 0,
      monthsLeft: Math.max(0, Math.round((g.targetYears ?? 0) * 12)),
      expectedReturnPct: g.expectedReturn,
      inflationPct: g.inflationRate,
    });
    return {
      ...g,
      futureValue: Math.round(calc.futureTarget),
      requiredMonthlySip: Math.round(calc.requiredMonthlySipTotal),
    };
  });
}

/**
 * numeric()-column helper: stringify a number for Drizzle's numeric columns,
 * but keep an explicit 0 (a `value ? String(value)` truthiness check would
 * drop a legitimate zero income/expense/fund value).
 */
export function numOrNull(v: number | null | undefined): string | null {
  return v != null ? String(v) : null;
}
