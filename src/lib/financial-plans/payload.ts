/**
 * The Financial Health Check form's save payload: cleaned before it is sent,
 * checked for what the user has to fix (and on which step), and — if the API
 * still rejects it — the API's validation issues turned into plain English.
 *
 * Before 2026-10-09 the form sent rows as the user left them (an asset or
 * recommendation added and never filled in, a goal imported from a fact-find
 * with no years, an EMI ratio above 100%) and the page could only show the
 * API's "invalid body".
 */

export type PlanStep = 1 | 2 | 3 | 4 | 5;
export const STEP_NAMES: Record<PlanStep, string> = {
  1: "Profiling",
  2: "Cash & Assets",
  3: "Protection",
  4: "Goals Calc",
  5: "Roadmap",
};

export interface PlanProblem {
  step: PlanStep;
  message: string;
}

const ASSET_LABEL: Record<string, string> = {
  equity: "Equity",
  debt: "Debt",
  gold: "Gold",
  cash: "Cash",
  real_estate: "Real estate",
  other: "Other asset",
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Drop rows the user added but never filled in, name a filled row that has no
 * name, and coerce every number into the shape the API accepts. Never changes
 * a value the user actually entered, except to round a whole-number field.
 */
export function cleanPlanPayload<T extends Record<string, any>>(p: T): T {
  const out: Record<string, any> = { ...p };

  out.clientAge = intOrNull(p.clientAge);
  out.spouseAge = intOrNull(p.spouseAge);
  out.childrenDetails = (Array.isArray(p.childrenDetails) ? p.childrenDetails : [])
    .filter((c: any) => text(c?.name) || num(c?.age) > 0)
    .map((c: any) => ({ name: text(c.name).slice(0, 100), age: Math.round(clamp(num(c.age), 0, 120)) }));

  out.monthlyIncome = numOrNull(p.monthlyIncome);
  out.monthlyExpenses = numOrNull(p.monthlyExpenses);

  out.assets = (Array.isArray(p.assets) ? p.assets : [])
    .filter((a: any) => text(a?.name) || num(a?.value) > 0)
    .map((a: any) => ({
      ...a,
      name: (text(a.name) || ASSET_LABEL[a.category] || "Asset").slice(0, 200),
      value: Math.max(0, num(a.value)),
    }));
  out.liabilities = (Array.isArray(p.liabilities) ? p.liabilities : [])
    .filter((l: any) => text(l?.name) || num(l?.value) > 0 || num(l?.monthlyEmi) > 0)
    .map((l: any) => ({
      ...l,
      name: (text(l.name) || "Loan").slice(0, 200),
      value: Math.max(0, num(l.value)),
      ...(l.monthlyEmi !== undefined && l.monthlyEmi !== null && l.monthlyEmi !== "" ? { monthlyEmi: Math.max(0, num(l.monthlyEmi)) } : {}),
      ...(l.tenureMonths !== undefined && l.tenureMonths !== null && l.tenureMonths !== "" ? { tenureMonths: Math.max(0, Math.round(num(l.tenureMonths))) } : {}),
    }));

  out.emergencyFundTargetMonths = Math.round(num(p.emergencyFundTargetMonths) || 6);
  out.emergencyFundCurrentValue = Math.max(0, num(p.emergencyFundCurrentValue));

  out.goals = (Array.isArray(p.goals) ? p.goals : [])
    .filter((g: any) => text(g?.name) || num(g?.targetAmount) > 0)
    .map((g: any) => {
      const goal: Record<string, any> = {
        ...g,
        name: text(g.name).slice(0, 200),
        targetAmount: Math.max(0, num(g.targetAmount)),
        targetYears: Math.round(num(g.targetYears)),
        inflationRate: num(g.inflationRate),
        expectedReturn: num(g.expectedReturn),
      };
      // Derived figures: a non-finite or negative result is not sent at all.
      for (const k of ["currentValue", "existingMonthlySip", "futureValue", "requiredMonthlySip", "additionalMonthlySip", "gapAmount"]) {
        const v = numOrNull(g[k]);
        if (v === null) delete goal[k];
        else goal[k] = Math.max(0, v);
      }
      return goal;
    });

  for (const k of ["recommendedEquityPct", "recommendedDebtPct", "recommendedGoldPct", "recommendedCashPct"]) {
    out[k] = Math.round(clamp(num(p[k]), 0, 100));
  }
  out.recommendations = (Array.isArray(p.recommendations) ? p.recommendations : [])
    .filter((r: any) => text(r?.action))
    .map((r: any) => ({ ...r, action: text(r.action).slice(0, 1000) }));

  // Ratios are display figures; the column holds up to 999.99.
  const sr = numOrNull(p.savingsRate);
  out.savingsRate = sr === null ? null : clamp(sr, 0, 100);
  const emi = numOrNull(p.emiToIncomePct);
  out.emiToIncomePct = emi === null ? null : clamp(emi, 0, 999);

  return out as T;
}

/** What the user must fix before the plan can be saved, in step order. */
export function planProblems(p: Record<string, any>): PlanProblem[] {
  const probs: PlanProblem[] = [];
  const age = (v: unknown, who: string) => {
    const n = numOrNull(v);
    if (n !== null && (n < 0 || n > 120)) probs.push({ step: 1, message: `${who}'s age must be between 0 and 120.` });
  };
  age(p.clientAge, "The client");
  age(p.spouseAge, "The spouse");
  (p.childrenDetails ?? []).forEach((c: any, i: number) => {
    if (!text(c?.name)) probs.push({ step: 1, message: `Child ${i + 1} needs a name.` });
  });

  const months = num(p.emergencyFundTargetMonths);
  if (months < 1 || months > 36) probs.push({ step: 3, message: "Emergency fund target must be between 1 and 36 months." });

  (p.goals ?? []).forEach((g: any, i: number) => {
    const label = text(g?.name) ? `Goal "${text(g.name)}"` : `Goal ${i + 1}`;
    if (!text(g?.name)) probs.push({ step: 4, message: `${label} needs a name.` });
    const y = num(g?.targetYears);
    if (y < 1 || y > 100) probs.push({ step: 4, message: `${label} needs the number of years to the goal (1–100).` });
    if (num(g?.inflationRate) < 0 || num(g?.inflationRate) > 100) probs.push({ step: 4, message: `${label}: inflation must be 0–100%.` });
    if (num(g?.expectedReturn) < 0 || num(g?.expectedReturn) > 100) probs.push({ step: 4, message: `${label}: expected return must be 0–100%.` });
  });

  const alloc = ["recommendedEquityPct", "recommendedDebtPct", "recommendedGoldPct", "recommendedCashPct"].reduce((s, k) => s + num(p[k]), 0);
  if (alloc !== 0 && alloc !== 100) probs.push({ step: 5, message: `Recommended asset allocation must add up to 100% (it is ${alloc}%).` });

  return probs.sort((a, b) => a.step - b.step);
}

const FIELD_STEP: Record<string, PlanStep> = {
  investorId: 1, leadId: 1, clientAge: 1, spouseAge: 1, childrenDetails: 1, riskProfile: 1,
  monthlyIncome: 2, monthlyExpenses: 2, assets: 2, liabilities: 2, savingsRate: 2, emiToIncomePct: 2,
  emergencyFundTargetMonths: 3, emergencyFundCurrentValue: 3,
  lifeInsuranceSumAssured: 3, lifeInsuranceAnnualPremium: 3, healthInsuranceSumAssured: 3, healthInsuranceAnnualPremium: 3,
  goals: 4,
  recommendedEquityPct: 5, recommendedDebtPct: 5, recommendedGoldPct: 5, recommendedCashPct: 5,
  recommendations: 5, notes: 5, mfdValueAddText: 5, status: 5,
};
const ROW_NAME: Record<string, string> = {
  childrenDetails: "Child", assets: "Asset", liabilities: "Liability", goals: "Goal", recommendations: "Recommendation",
};
const humanField = (f: string) => f.replace(/([A-Z])/g, " $1").replace(/ Pct$/, " %").replace(/^./, (c) => c.toUpperCase()).trim();

/** The API's validation issues ({ path, message }) as one readable sentence that names the step. */
export function describeIssues(issues: unknown): { step: PlanStep | null; message: string } | null {
  if (!Array.isArray(issues) || !issues.length) return null;
  const parts: string[] = [];
  let first: PlanStep | null = null;
  for (const is of issues.slice(0, 3) as any[]) {
    const path: (string | number)[] = Array.isArray(is?.path) ? is.path : [];
    const top = String(path[0] ?? "");
    const step = FIELD_STEP[top] ?? null;
    if (first === null && step) first = step;
    let where = top ? humanField(top) : "The form";
    if (ROW_NAME[top] && typeof path[1] === "number") {
      where = `${ROW_NAME[top]} ${Number(path[1]) + 1}${path[2] !== undefined ? ` · ${humanField(String(path[2]))}` : ""}`;
    }
    parts.push(`${step ? `Step ${step} (${STEP_NAMES[step]}) — ` : ""}${where}: ${String(is?.message ?? "invalid")}`);
  }
  const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
  return { step: first, message: `Couldn't save: ${parts.join("; ")}${more}` };
}
