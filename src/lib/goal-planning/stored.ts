/**
 * computeGoal() for a SAVED goal: the one place that turns a goals row into
 * calculator inputs, so the Goals list and the nightly recompute can never
 * disagree about a goal's status, required SIP or gap.
 *
 * The cached columns (status, required_monthly_sip, gap_amount) are refreshed
 * nightly; a screen that must be right NOW (a rule changed, a month ticked
 * over) computes from the inputs with this instead of trusting the cache.
 *
 * Plain module — no DB, no React.
 */
import { computeGoal, monthsBetween, type GoalCalcResult } from "./calc";
import { effectiveGlideReturn, type GlidePath } from "./glide-path";

export type StoredGoalInputs = {
  targetAmount: string | number;
  targetDate: string | Date;
  currentValue?: string | number | null;
  existingMonthlySip?: string | number | null;
  monthlyContribution?: string | number | null;
  expectedReturn?: string | number | null;
  inflationPct?: string | number | null;
  stepUpPct?: string | number | null;
  glidePath?: string | null;
};

const GLIDE_PATHS: readonly GlidePath[] = ["none", "conservative", "moderate", "aggressive"];

export function computeStoredGoal(
  g: StoredGoalInputs,
  opts: {
    /** Live values when the caller re-derived them (linked folios / SIPs). */
    currentValue?: number;
    existingMonthlySip?: number;
    now?: Date;
  } = {}
): GoalCalcResult {
  const now = opts.now ?? new Date();
  const monthsLeft = Math.max(0, monthsBetween(now, new Date(g.targetDate)));
  // Glide path tapers the effective return as the target nears.
  const baseReturn = g.expectedReturn != null ? Number(g.expectedReturn) : 12;
  const glide = GLIDE_PATHS.find((p) => p === g.glidePath) ?? "none";
  const effReturn = effectiveGlideReturn(baseReturn, monthsLeft / 12, glide);

  return computeGoal({
    futureTarget: Number(g.targetAmount),
    currentValue: opts.currentValue ?? Number(g.currentValue ?? 0),
    existingMonthlySip: opts.existingMonthlySip ?? Number(g.existingMonthlySip ?? g.monthlyContribution ?? 0),
    monthsLeft,
    expectedReturnPct: effReturn,
    inflationPct: g.inflationPct != null ? Number(g.inflationPct) : undefined,
    stepUpPct: g.stepUpPct != null ? Number(g.stepUpPct) : undefined,
  });
}
